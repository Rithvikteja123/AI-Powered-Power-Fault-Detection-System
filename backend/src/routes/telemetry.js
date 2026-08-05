/**
 * POST /api/telemetry
 *
 * Accepts IoT telemetry from pole devices.
 * Design for high throughput:
 *   - Validates payload (fast, synchronous)
 *   - Pushes to in-memory ring buffer (< 1ms)
 *   - Returns 202 immediately
 *   - Background worker drains buffer and writes to DB
 *
 * Deduplication:
 *   - Tracks last seq per device_id in device_seq table
 *   - Drops messages with seq <= last_seen_seq (duplicates/stale)
 *   - Also drops messages older than 6 hours (very stale retries)
 */

const express = require('express');
const router  = express.Router();
const queue   = require('../queue');
const db      = require('../db');

const VALID_EVENTS = ['heartbeat', 'power_lost', 'power_restored', 'boot'];
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

// ─── POST /api/telemetry ─────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const payload = req.body;

  // Basic validation
  if (!payload || !payload.pole_id || !payload.event) {
    return res.status(400).json({ error: 'Missing required fields: pole_id, event' });
  }

  if (!VALID_EVENTS.includes(payload.event)) {
    return res.status(400).json({ error: `Unknown event: ${payload.event}` });
  }

  // Reject obviously stale messages
  if (payload.ts) {
    const msgTime = new Date(payload.ts).getTime();
    if (Date.now() - msgTime > STALE_THRESHOLD_MS) {
      return res.status(202).json({ status: 'stale', dropped: true });
    }
  }

  // Normalise: determine energized from event type if not explicit
  const energized = payload.energized !== undefined
    ? Boolean(payload.energized)
    : payload.event !== 'power_lost';

  const msg = {
    device_id:  payload.device_id   || null,
    pole_id:    payload.pole_id,
    event:      payload.event,
    energized,
    ts:         payload.ts          || new Date().toISOString(),
    seq:        parseInt(payload.seq) || 0,
    battery_mv: parseInt(payload.battery_mv) || null,
    rssi:       parseInt(payload.rssi)       || null,
    fw:         payload.fw                   || null,
    received_at: new Date().toISOString(),
  };

  const accepted = queue.push(msg);
  return res.status(202).json({ status: accepted ? 'queued' : 'dropped', queue_size: queue.size });
});

// ─── Background worker: drain queue → DB ─────────────────────────────────────

let wsBroadcastFn = null;

function startWorker(broadcast) {
  wsBroadcastFn = broadcast;
  console.log('[Telemetry] Ingest worker started (drain interval: 100ms)');
  setInterval(drainBatch, 100);
}

async function drainBatch() {
  const batch = queue.drain(500);
  if (batch.length === 0) return;

  try {
    await processBatch(batch);
  } catch (err) {
    console.error('[Telemetry] Drain error:', err.message);
  }
}

async function processBatch(batch) {
  // Bulk insert into telemetry_events log
  if (batch.length === 0) return;

  const values = batch.map((_, i) => {
    const base = i * 9;
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9})`;
  }).join(',');

  const params = batch.flatMap((m) => [
    m.device_id, m.pole_id, m.event, m.energized, m.ts,
    m.seq, m.battery_mv, m.rssi, m.fw,
  ]);

  await db.query(
    `INSERT INTO telemetry_events (device_id, pole_id, event, energized, ts, seq, battery_mv, rssi, fw)
     VALUES ${values}
     ON CONFLICT DO NOTHING`,
    params,
  );

  // Process each message: update pole_states with deduplication
  for (const msg of batch) {
    await updatePoleState(msg);
  }
}

async function updatePoleState(msg) {
  try {
    // Deduplication: track sequence number per device
    if (msg.device_id && msg.seq) {
      await db.query(
        `INSERT INTO device_seq (device_id, last_seq) VALUES ($1, $2)
         ON CONFLICT (device_id) DO UPDATE
           SET last_seq = GREATEST(device_seq.last_seq, excluded.last_seq),
               updated_at = NOW()`,
        [msg.device_id, msg.seq],
      );
    }

    const energized = msg.energized;
    const now = new Date(msg.ts).toISOString();

    // Check if pole exists
    const poleCheck = await db.query('SELECT pole_id FROM poles WHERE pole_id = $1', [msg.pole_id]);
    if (poleCheck.rows.length === 0) return;

    // Upsert pole_states
    if (energized) {
      // Power restored
      await db.query(
        `INSERT INTO pole_states (pole_id, energized, last_seen, last_event, fw_version, restored_at, first_dark_at)
         VALUES ($1, true, $2, $3, $4, $5, NULL)
         ON CONFLICT (pole_id) DO UPDATE
           SET energized     = true,
               last_seen     = GREATEST(pole_states.last_seen, excluded.last_seen),
               last_event    = excluded.last_event,
               fw_version    = COALESCE(excluded.fw_version, pole_states.fw_version),
               restored_at   = excluded.restored_at,
               first_dark_at = NULL`,
        [msg.pole_id, now, msg.event, msg.fw, now],
      );
    } else {
      // Power lost
      await db.query(
        `INSERT INTO pole_states (pole_id, energized, last_seen, last_event, fw_version, first_dark_at)
         VALUES ($1, false, $2, $3, $4, $5)
         ON CONFLICT (pole_id) DO UPDATE
           SET energized     = false,
               last_seen     = GREATEST(pole_states.last_seen, excluded.last_seen),
               last_event    = excluded.last_event,
               fw_version    = COALESCE(excluded.fw_version, pole_states.fw_version),
               first_dark_at = COALESCE(pole_states.first_dark_at, excluded.first_dark_at)`,
        [msg.pole_id, now, msg.event, msg.fw, now],
      );
    }

    // Broadcast state change for real-time map updates
    if (wsBroadcastFn) {
      wsBroadcastFn('pole_state_changed', {
        pole_id: msg.pole_id,
        energized,
        event: msg.event,
        ts: msg.ts,
      });
    }
  } catch (err) {
    console.error(`[Telemetry] updatePoleState error for ${msg.pole_id}:`, err.message);
  }
}

module.exports = router;
module.exports.startWorker = startWorker;
