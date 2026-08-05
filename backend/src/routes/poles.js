const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/poles — all poles with current state (supports bbox filter)
router.get('/', async (req, res) => {
  try {
    const { dt_id, feeder_id, minLat, maxLat, minLon, maxLon, limit = 2000 } = req.query;

    const conditions = [];
    const params     = [];

    if (dt_id)    { params.push(dt_id);    conditions.push(`p.dt_id = $${params.length}`); }
    if (feeder_id){ params.push(feeder_id);conditions.push(`p.feeder_id = $${params.length}`); }
    if (minLat)   { params.push(parseFloat(minLat)); conditions.push(`p.lat >= $${params.length}`); }
    if (maxLat)   { params.push(parseFloat(maxLat)); conditions.push(`p.lat <= $${params.length}`); }
    if (minLon)   { params.push(parseFloat(minLon)); conditions.push(`p.lon >= $${params.length}`); }
    if (maxLon)   { params.push(parseFloat(maxLon)); conditions.push(`p.lon <= $${params.length}`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit));

    const result = await db.query(
      `SELECT p.pole_id, p.lat, p.lon, p.feeder_id, p.dt_id,
              p.parent_pole_id, p.device_id, p.fw_version,
              p.ward, p.pincode, p.topology_known,
              ps.energized, ps.last_seen, ps.last_event
       FROM poles p
       LEFT JOIN pole_states ps ON ps.pole_id = p.pole_id
       ${where}
       LIMIT $${params.length}`,
      params,
    );

    res.json({ poles: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/poles/:id — single pole details
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, ps.energized, ps.last_seen, ps.last_event, ps.first_dark_at
       FROM poles p
       LEFT JOIN pole_states ps ON ps.pole_id = p.pole_id
       WHERE p.pole_id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Pole not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dts — all distribution transformers
router.get('/dts/all', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT t.*,
              COUNT(p.pole_id) AS pole_count,
              COUNT(p.device_id) AS device_count
       FROM transformers t
       LEFT JOIN poles p ON p.dt_id = t.dt_id
       GROUP BY t.dt_id
       ORDER BY t.dt_id`,
    );
    res.json({ dts: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/feeders — all feeders
router.get('/feeders/all', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT f.*, COUNT(DISTINCT t.dt_id) AS dt_count
       FROM feeders f
       LEFT JOIN transformers t ON t.feeder_id = f.feeder_id
       GROUP BY f.feeder_id`,
    );
    res.json({ feeders: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
