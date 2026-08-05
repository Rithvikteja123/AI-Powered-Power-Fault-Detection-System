require('dotenv').config();

const express  = require('express');
const cors     = require('cors');
const db       = require('./db');
const seeder   = require('./seed/seed');

const telemetryRouter = require('./routes/telemetry');
const ticketsRouter   = require('./routes/tickets');
const polesRouter     = require('./routes/poles');
const simulatorRouter = require('./routes/simulator');
const outagesRouter   = require('./routes/outages');
const statsRouter     = require('./routes/stats');

const { runLocalization }                  = require('./services/localizer');
const { upsertTickets, checkRestorations } = require('./services/ticketManager');
const { explainFault }                     = require('./services/aiSummary');

// ── Serverless-safe broadcast (no-op when WS unavailable) ─────────────────────
let _broadcast = () => {};
function setBroadcast(fn) { _broadcast = fn; }
function broadcast(type, data) { _broadcast(type, data); }

// ── Express app ────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// Wire routers
ticketsRouter.setWs(broadcast);
simulatorRouter.setWs(broadcast);

app.use('/api/telemetry',         telemetryRouter);
app.use('/api/tickets',           ticketsRouter);
app.use('/api/poles',             polesRouter);
app.use('/api/simulate',          simulatorRouter);
app.use('/api/scheduled-outages', outagesRouter);
app.use('/api/stats',             statsRouter);

// AI Explanation endpoint (Gemini)
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
  } catch (_) {
    res.json({ explanation: 'AI Assistant (Gemini): Fault localized using graph traversal algorithm.' });
  }
});

// Cron-trigger endpoint — called by Vercel Cron or any external scheduler
app.post('/api/cron/localizer', async (req, res) => {
  try {
    const boundaries = await runLocalization(broadcast);
    if (boundaries.length > 0) await upsertTickets(boundaries, broadcast);
    await checkRestorations(broadcast);
    res.json({ ok: true, boundaries: boundaries.length });
  } catch (err) {
    console.error('[Cron] Localizer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 404 & error handlers
app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
app.use((err, req, res, _next) => {
  console.error('[App]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Initialise DB + seed once (cached across hot reloads in serverless) ────────
let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  await seeder.run();
  // Start telemetry drain worker only in persistent node process
  if (process.env.VERCEL !== '1') {
    telemetryRouter.startWorker(broadcast);
  }
}

// Kick off boot eagerly
boot().catch(console.error);

module.exports = { app, boot, broadcast, setBroadcast };
