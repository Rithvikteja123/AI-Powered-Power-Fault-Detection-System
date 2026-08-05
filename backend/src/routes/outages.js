const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/scheduled-outages
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    const start = from ? new Date(from) : new Date();
    const end   = to   ? new Date(to)   : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await db.query(
      `SELECT * FROM scheduled_outages
       WHERE cancelled = false
         AND start_time <= $2
         AND end_time   >= $1
       ORDER BY start_time`,
      [start, end],
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/scheduled-outages — create (for simulator)
router.post('/', async (req, res) => {
  try {
    const { scope, target_id, start_time, end_time, reason } = req.body;
    if (!scope || !target_id || !start_time || !end_time) {
      return res.status(400).json({ error: 'scope, target_id, start_time, end_time required' });
    }
    const id = `SO-${Date.now()}`;
    const result = await db.query(
      `INSERT INTO scheduled_outages (id, scope, target_id, start_time, end_time, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, scope, target_id, start_time, end_time, reason || 'Manual test outage'],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
