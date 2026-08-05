const express = require('express');
const router  = express.Router();
const db      = require('../db');
const ws      = require('../websocket');

// GET /api/stats — system-wide statistics for the status bar
router.get('/', async (req, res) => {
  try {
    const [ticketStats, poleStats, queueStat] = await Promise.all([
      db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN status NOT IN ('closed', 'verified', 'resolved') THEN 1 ELSE 0 END), 0) AS active_tickets,
          COALESCE(SUM(CASE WHEN status = 'detected' THEN 1 ELSE 0 END), 0) AS new_tickets,
          COALESCE(SUM(CASE WHEN status IN ('resolved', 'verified', 'closed') THEN 1 ELSE 0 END), 0) AS closed_24h,
          COALESCE(SUM(CASE WHEN status NOT IN ('closed', 'verified', 'resolved') THEN affected_households ELSE 0 END), 0) AS households_affected,
          COALESCE(SUM(CASE WHEN status NOT IN ('closed', 'verified', 'resolved') THEN affected_pole_count ELSE 0 END), 0) AS poles_affected
        FROM fault_tickets
      `),
      db.query(`
        SELECT
          COALESCE(SUM(CASE WHEN ps.energized = 0 OR ps.energized = false THEN 1 ELSE 0 END), 0) AS dark_poles,
          COUNT(*) AS total_reported_poles
        FROM pole_states ps
      `),
      Promise.resolve({ size: require('../queue').size }),
    ]);

    const t = ticketStats.rows[0];
    const p = poleStats.rows[0];

    res.json({
      active_tickets:      parseInt(t.active_tickets)     || 0,
      new_tickets:         parseInt(t.new_tickets)        || 0,
      closed_24h:          parseInt(t.closed_24h)         || 0,
      households_affected: parseInt(t.households_affected)|| 0,
      poles_affected:      parseInt(t.poles_affected)     || 0,
      dark_poles:          parseInt(p.dark_poles)         || 0,
      total_poles:         parseInt(p.total_reported_poles)|| 0,
      queue_size:          queueStat.size,
      ws_clients:          ws.getClientCount(),
      server_time:         new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
