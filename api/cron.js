/**
 * Vercel Cron Job — runs the fault localizer every minute.
 * Configured in vercel.json: { "crons": [{ "path": "/api/cron", "schedule": "* * * * *" }] }
 */
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const { boot }                             = require('../backend/src/app');
const { runLocalization }                  = require('../backend/src/services/localizer');
const { upsertTickets, checkRestorations } = require('../backend/src/services/ticketManager');

let booted = false;
module.exports = async (req, res) => {
  if (!booted) { await boot(); booted = true; }

  const noop = () => {};
  try {
    const boundaries = await runLocalization(noop);
    if (boundaries.length > 0) await upsertTickets(boundaries, noop);
    await checkRestorations(noop);
    res.json({ ok: true, boundaries: boundaries.length, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[Cron] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
