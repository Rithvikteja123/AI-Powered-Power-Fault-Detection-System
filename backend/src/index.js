/**
 * Local development entry point — starts HTTP server + WebSocket + cron.
 * In Vercel production, api/index.js is used instead.
 */
require('dotenv').config();

const http  = require('http');
const cron  = require('node-cron');

const { app, boot, setBroadcast }          = require('./app');
const ws                                    = require('./websocket');
const { runLocalization }                   = require('./services/localizer');
const { upsertTickets, checkRestorations }  = require('./services/ticketManager');
const telemetryRouter                       = require('./routes/telemetry');

const PORT = process.env.PORT || 5050;

const server    = http.createServer(app);
const wsServer  = ws.init(server);
const broadcast = ws.broadcast.bind(ws);
setBroadcast(broadcast);

let localizerRunning = false;
async function runLocalizerPass() {
  if (localizerRunning) return;
  localizerRunning = true;
  try {
    const boundaries = await runLocalization(broadcast);
    if (boundaries.length > 0) await upsertTickets(boundaries, broadcast);
    await checkRestorations(broadcast);
  } catch (err) {
    console.error('[Cron] Localizer pass error:', err.message);
  } finally {
    localizerRunning = false;
  }
}

async function start() {
  console.log('══════════════════════════════════════════════');
  console.log('  KSPDB Fault Detection System — Backend');
  console.log('══════════════════════════════════════════════');
  await boot();
  telemetryRouter.startWorker(broadcast);
  cron.schedule('*/15 * * * * *', runLocalizerPass);
  console.log('[Cron] Localizer scheduled every 15 seconds');
  server.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
    console.log(`[Server] WebSocket at ws://localhost:${PORT}/ws`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
    console.log('──────────────────────────────────────────────');
  });
}

start().catch(err => { console.error('[Boot] Fatal:', err.message); process.exit(1); });
