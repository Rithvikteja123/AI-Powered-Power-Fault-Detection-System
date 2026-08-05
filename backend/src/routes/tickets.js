const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { updateStatus, checkRestorations } = require('../services/ticketManager');

let wsBroadcast = null;
function setWs(fn) { wsBroadcast = fn; }

function toIsoUtc(val) {
  if (!val) return null;
  const str = String(val).trim();
  if (str.endsWith('Z') || str.includes('T')) return str;
  // SQLite format YYYY-MM-DD HH:MM:SS -> YYYY-MM-DDTHH:MM:SSZ
  return str.replace(' ', 'T') + 'Z';
}

// GET /api/tickets — list tickets (filter by status)
router.get('/', async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let where = '';
    const params = [];
    if (status) {
      params.push(status);
      where = `WHERE ft.status = $1`;
    } else {
      where = `WHERE ft.status NOT IN ('closed')`;
    }

    const result = await db.query(
      `SELECT ft.*,
              f.name AS feeder_name,
              t.capacity_kva, t.households_served AS dt_households
       FROM fault_tickets ft
       LEFT JOIN feeders f      ON f.feeder_id  = ft.feeder_id
       LEFT JOIN transformers t ON t.dt_id      = ft.dt_id
       ${where}
       ORDER BY
         CASE ft.status
           WHEN 'detected'      THEN 1
           WHEN 'acknowledged'  THEN 2
           WHEN 'crew_assigned' THEN 3
           WHEN 'resolved'      THEN 4
           WHEN 'verified'      THEN 5
           ELSE 6
         END,
         ft.detected_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, parseInt(limit), parseInt(offset)],
    );

    const formatted = result.rows.map((row) => ({
      ...row,
      detected_at:      toIsoUtc(row.detected_at),
      acknowledged_at:  toIsoUtc(row.acknowledged_at),
      crew_assigned_at: toIsoUtc(row.crew_assigned_at),
      resolved_at:      toIsoUtc(row.resolved_at),
      verified_at:      toIsoUtc(row.verified_at),
      closed_at:        toIsoUtc(row.closed_at),
    }));

    res.json({ tickets: formatted, total: formatted.length });
  } catch (err) {
    console.error('[Tickets] GET / error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:id — single ticket with poles
router.get('/:id', async (req, res) => {
  try {
    const ticketRes = await db.query(
      `SELECT ft.*,
              f.name AS feeder_name
       FROM fault_tickets ft
       LEFT JOIN feeders f ON f.feeder_id = ft.feeder_id
       WHERE ft.id = $1`,
      [req.params.id],
    );

    if (ticketRes.rows.length === 0) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    const ticket = ticketRes.rows[0];

    // Fetch affected poles with their states
    const polesRes = await db.query(
      `SELECT p.pole_id, p.lat, p.lon, p.ward, p.pincode,
              p.device_id, ps.energized, ps.last_seen
       FROM ticket_poles tp
       JOIN poles p       ON p.pole_id  = tp.pole_id
       LEFT JOIN pole_states ps ON ps.pole_id = tp.pole_id
       WHERE tp.ticket_id = $1`,
      [req.params.id],
    );

    // Fetch events
    const eventsRes = await db.query(
      `SELECT * FROM system_events WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [req.params.id],
    );

    res.json({ ticket, poles: polesRes.rows, events: eventsRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tickets/:id/status — update ticket status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, notes } = req.body;

    if (!status) return res.status(400).json({ error: 'status is required' });

    const VALID = ['acknowledged', 'crew_assigned', 'resolved', 'closed'];
    if (!VALID.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
    }

    if (notes) {
      await db.query('UPDATE fault_tickets SET notes = $1 WHERE id = $2', [notes, req.params.id]);
    }

    const updated = await updateStatus(req.params.id, status, wsBroadcast || (() => {}));
    res.json(updated);
  } catch (err) {
    // Expose the guard message to the frontend
    const status = err.message.startsWith('Cannot mark ticket') ? 409 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/tickets/all — include closed (for history)
router.get('/history/closed', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM fault_tickets WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 20`,
    );
    res.json({ tickets: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.setWs = setWs;
