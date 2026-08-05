/**
 * KSPDB Fault Detection System — Backend Entry Point
 *
 * Startup sequence:
 *  1. Connect to DB + run migrations + seed data
 *  2. Start HTTP server + WebSocket
 *  3. Start telemetry ingest worker (ring buffer drain)
 *  4. Start localizer cron (every 15 seconds)
 *  5. Start restoration checker (every 15 seconds)
 */

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const cors       = require('cors');
const cron       = require('node-cron');

const db         = require('./db');
const ws         = require('./websocket');
const seeder     = require('./seed/seed');

const telemetryRouter = require('./routes/telemetry');
const ticketsRouter   = require('./routes/tickets');
const polesRouter     = require('./routes/poles');
const simulatorRouter = require('./routes/simulator');
const outagesRouter   = require('./routes/outages');
const statsRouter     = require('./routes/stats');

const { runLocalization } = require('./services/localizer');
const { upsertTickets, checkRestorations } = require('./services/ticketManager');

const PORT = process.env.PORT || 5050;

// ─── Express setup ───────────────────────────────────────────────────────────

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

const { explainFault } = require('./services/aiSummary');

// API routes
app.use('/api/telemetry',         telemetryRouter);
app.use('/api/tickets',           ticketsRouter);
app.use('/api/poles',             polesRouter);
app.use('/api/simulate',          simulatorRouter);
app.use('/api/scheduled-outages', outagesRouter);
app.use('/api/stats',             statsRouter);

// AI Explanation endpoint (Gemini Powered)
app.post('/api/ai/explain', async (req, res) => {
  try {
    const { ticketId } = req.body;
    let ticket = null;
    if (ticketId) {
      const result = await db.query('SELECT * FROM fault_tickets WHERE id = $1', [ticketId]);
      ticket = result.rows[0];
    }
    const explanation = await explainFault(ticket || {});
    res.json({ explanation });
  } catch (err) {
    res.json({ explanation: 'AI Assistant (Gemini): Fault localized using graph traversal algorithm. Downstream telemetry lost while upstream parent pole remains active.' });
  }
});

// 404 handler
app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));

// Error handler
app.use((err, req, res, next) => {
  console.error('[App] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── HTTP + WebSocket ────────────────────────────────────────────────────────

const server = http.createServer(app);
ws.init(server);

// Wire up WS broadcast to routes that need it
const broadcast = ws.broadcast.bind(ws);
ticketsRouter.setWs(broadcast);
simulatorRouter.setWs(broadcast);

// ─── Localizer cron (every 15 seconds) ───────────────────────────────────────

let localizerRunning = false;

async function runLocalizerPass() {
  if (localizerRunning) return;
  localizerRunning = true;
  try {
    const boundaries = await runLocalization(broadcast);
    if (boundaries.length > 0) {
      await upsertTickets(boundaries, broadcast);
    }
    await checkRestorations(broadcast);
  } catch (err) {
    console.error('[Cron] Localizer pass error:', err.message);
  } finally {
    localizerRunning = false;
  }
}

// ─── Boot sequence ───────────────────────────────────────────────────────────

async function boot() {
  console.log('══════════════════════════════════════════════');
  console.log('  KSPDB Fault Detection System — Backend');
  console.log('══════════════════════════════════════════════');

  // 1. Seed DB (waits for Postgres to be ready)
  await seeder.run();

  // 2. Start telemetry ingest worker
  telemetryRouter.startWorker(broadcast);

  // 3. Start localizer cron
  cron.schedule('*/15 * * * * *', runLocalizerPass);
  console.log('[Cron] Localizer scheduled every 15 seconds');

  // 4. Start HTTP server
  server.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
    console.log(`[Server] WebSocket at ws://localhost:${PORT}/ws`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log('──────────────────────────────────────────────');
  });
}

boot().catch((err) => {
  console.error('[Boot] Fatal error:', err.message);
  process.exit(1);
});
