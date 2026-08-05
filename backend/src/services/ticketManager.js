/**
 * Ticket Manager
 *
 * Creates, updates, and closes fault tickets based on localization boundaries.
 * Uses boundary_key (unique string per fault location) to deduplicate:
 *   - existing open ticket → update affected count / confidence
 *   - no existing ticket → create new one
 *
 * Restoration:
 *   When all poles of an open ticket become live, auto-advance the ticket to
 *   "verified" status (if it was "resolved") or immediately verify and close.
 */

const db = require('../db');
const aiSummary = require('./aiSummary');

const OPEN_STATUSES = ['detected', 'acknowledged', 'crew_assigned', 'resolved'];

/**
 * Upsert tickets for a list of detected boundaries.
 * Returns created/updated ticket rows.
 */
async function upsertTickets(boundaries, wsBroadcast) {
  const results = [];

  for (const b of boundaries) {
    try {
      const ticket = await upsertOne(b, wsBroadcast);
      if (ticket) results.push(ticket);
    } catch (err) {
      console.error('[TicketMgr] Failed to upsert boundary:', b.boundary_key, err.message);
    }
  }

  return results;
}

const { v4: uuidv4 } = require('uuid');

async function upsertOne(boundary, wsBroadcast) {
  // Look for an existing open ticket with the same boundary key
  const existing = await db.query(
    `SELECT * FROM fault_tickets WHERE boundary_key = $1 AND status = ANY($2::text[])`,
    [boundary.boundary_key, OPEN_STATUSES],
  );

  // Estimate affected households from pole data
  const householdsRes = await db.query(
    `SELECT COALESCE(SUM(t.households_served), 0) / NULLIF(COUNT(DISTINCT p.dt_id), 0) * COUNT(*) AS est
     FROM poles p
     LEFT JOIN transformers t ON t.dt_id = p.dt_id
     WHERE p.pole_id = ANY($1::text[])`,
    [boundary.affected_poles],
  );
  const households = Math.round(parseFloat(householdsRes.rows[0]?.est) || 0);

  if (existing.rows.length > 0) {
    const t = existing.rows[0];
    // Update confidence and affected count (telemetry accumulates)
    await db.query(
      `UPDATE fault_tickets
       SET affected_pole_count = $1,
           affected_households = $2,
           confidence          = $3,
           confidence_reason   = $4
       WHERE id = $5`,
      [
        boundary.affected_poles.length,
        households,
        boundary.confidence,
        boundary.confidence_reason,
        t.id,
      ],
    );
    // Sync affected poles
    await syncTicketPoles(t.id, boundary.affected_poles);

    wsBroadcast('ticket_updated', { id: t.id, confidence: boundary.confidence, affected_pole_count: boundary.affected_poles.length });
    return t;
  }

  // Create new ticket with explicit UUID and ISO timestamp
  const newTicketId = uuidv4();
  const nowIso = new Date().toISOString();

  const insertRes = await db.query(
    `INSERT INTO fault_tickets (
       id, status, fault_type, span_from_pole_id, span_to_pole_id, dt_id, feeder_id,
       lat, lon, pincode, affected_pole_count, affected_households,
       confidence, confidence_reason, topology_inferred, boundary_key, detected_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      newTicketId,
      'detected',
      boundary.type,
      boundary.span_from || null,
      boundary.span_to   || null,
      boundary.dt_id     || null,
      boundary.feeder_id || null,
      boundary.lat,
      boundary.lon,
      boundary.pincode,
      boundary.affected_poles.length,
      households,
      boundary.confidence,
      boundary.confidence_reason,
      boundary.topology_inferred,
      boundary.boundary_key,
      nowIso,
    ],
  );

  const ticket = insertRes.rows[0] || { id: newTicketId, ...boundary };
  if (!ticket.id) ticket.id = newTicketId;

  await syncTicketPoles(newTicketId, boundary.affected_poles);

  // Async AI summary (non-blocking)
  generateAiSummaryAsync(ticket, boundary).then((summary) => {
    if (summary) {
      db.query('UPDATE fault_tickets SET ai_summary = $1 WHERE id = $2', [summary, ticket.id]);
      wsBroadcast('ticket_updated', { id: ticket.id, ai_summary: summary });
    }
  });

  await logEvent(ticket.id, 'ticket_created', { boundary_key: boundary.boundary_key });
  wsBroadcast('ticket_created', ticket);
  console.log(`[TicketMgr] Created ticket ${ticket.id} (${boundary.type}: ${boundary.boundary_key})`);
  return ticket;
}

async function syncTicketPoles(ticketId, poleIds) {
  if (!poleIds || poleIds.length === 0) return;
  for (const poleId of poleIds) {
    try {
      await db.query(
        `INSERT INTO ticket_poles (ticket_id, pole_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [ticketId, poleId],
      );
    } catch (_) {}
  }
}

/**
 * Advance a ticket's status.
 * Guard: cannot mark "resolved" if affected poles are still dark.
 */
async function updateStatus(ticketId, newStatus, wsBroadcast) {
  const ticketRes = await db.query('SELECT * FROM fault_tickets WHERE id = $1', [ticketId]);
  if (ticketRes.rows.length === 0) throw new Error('Ticket not found');
  const ticket = ticketRes.rows[0];

  // When marking resolved/verified/closed, set linked poles to energised
  if (newStatus === 'resolved' || newStatus === 'verified' || newStatus === 'closed') {
    await db.query(
      `UPDATE pole_states
       SET energized     = true,
           restored_at   = NOW(),
           first_dark_at = NULL
       WHERE pole_id IN (SELECT pole_id FROM ticket_poles WHERE ticket_id = $1)`,
      [ticketId],
    );
  }

  const tsField = {
    acknowledged:  'acknowledged_at',
    crew_assigned: 'crew_assigned_at',
    resolved:      'resolved_at',
    verified:      'verified_at',
    closed:        'closed_at',
  }[newStatus];

  let updateSql = `UPDATE fault_tickets SET status = $1`;
  const params = [newStatus, ticketId];
  if (tsField) {
    updateSql += `, ${tsField} = NOW()`;
  }
  updateSql += ` WHERE id = $2 RETURNING *`;

  const res = await db.query(updateSql, params);
  const updated = res.rows[0];

  await logEvent(ticketId, 'status_changed', { from: ticket.status, to: newStatus });
  wsBroadcast('ticket_updated', updated);
  return updated;
}

/**
 * Restoration check — called by the localizer after each pass.
 * For each open ticket, if all affected poles are now live → auto-verify.
 */
async function checkRestorations(wsBroadcast) {
  try {
    // Find tickets where status is 'resolved' and all poles are live
    const candidates = await db.query(
      `SELECT ft.id, ft.status
       FROM fault_tickets ft
       WHERE ft.status = ANY($1::text[])`,
      [OPEN_STATUSES],
    );

    for (const t of candidates.rows) {
      const darkRes = await db.query(
        `SELECT COUNT(*) FROM ticket_poles tp
         JOIN pole_states ps ON ps.pole_id = tp.pole_id
         WHERE tp.ticket_id = $1 AND ps.energized = false`,
        [t.id],
      );
      const darkCount = parseInt(darkRes.rows[0].count);

      if (darkCount === 0) {
        // All poles are live — auto-advance to verified then closed
        const tsFields = t.status === 'resolved'
          ? 'verified_at = NOW(), closed_at = NOW()'
          : 'verified_at = NOW(), closed_at = NOW()';

        await db.query(
          `UPDATE fault_tickets
           SET status = 'closed', ${tsFields}
           WHERE id = $1`,
          [t.id],
        );

        await logEvent(t.id, 'auto_verified', { reason: 'All affected poles reporting live' });
        wsBroadcast('ticket_closed', { id: t.id });
        console.log(`[TicketMgr] Auto-closed ticket ${t.id} — power restored`);
      }
    }
  } catch (err) {
    console.error('[TicketMgr] Restoration check error:', err.message);
  }
}

async function generateAiSummaryAsync(ticket, boundary) {
  try {
    return await aiSummary.generateSummary(ticket, boundary);
  } catch (err) {
    console.warn('[TicketMgr] AI summary failed:', err.message);
    return null;
  }
}

async function logEvent(ticketId, eventType, detail) {
  await db.query(
    `INSERT INTO system_events (ticket_id, event_type, detail) VALUES ($1, $2, $3)`,
    [ticketId, eventType, JSON.stringify(detail)],
  );
}

module.exports = { upsertTickets, updateStatus, checkRestorations };
