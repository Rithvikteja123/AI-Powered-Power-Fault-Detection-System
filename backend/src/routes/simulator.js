/**
 * Fault Simulator Route
 *
 * Allows injection of realistic faults for evaluation purposes.
 * The simulator models real physics:
 *   - span fault: all downstream poles go dark
 *   - dt fault:   all poles under a DT go dark
 *   - feeder fault: all poles under all DTs on a feeder go dark
 *
 * Realistic telemetry generation:
 *   - 70% of devices send power_lost; 30% go silent (capacitor failure)
 *   - Firmware 1.2.x devices (fw_version starts with "1.2") never send power_lost
 *   - Messages are sent with random delays 0–30s (clock skew simulation)
 *   - Some duplicates (at-least-once delivery)
 *
 * Repair:
 *   - All affected poles send power_restored + boot
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db');

let wsBroadcastFn = null;
function setWs(fn) { wsBroadcastFn = fn; }

// POST /api/simulate/fault
router.post('/fault', async (req, res) => {
  try {
    const { type, target_id } = req.body;
    // type: 'span' | 'dt' | 'feeder'
    // target_id: pole_id (for span - the pole at the fault start), dt_id, or feeder_id

    if (!type || !target_id) {
      return res.status(400).json({ error: 'type and target_id are required' });
    }

    let affectedPoles = [];

    if (type === 'span') {
      // Inject fault at this pole: it and all its descendants go dark
      affectedPoles = await getDescendantPoles(target_id);
      if (affectedPoles.length === 0) {
        // If target is a leaf or unknown, just affect the pole itself
        const poleCheck = await db.query('SELECT pole_id, device_id, fw_version FROM poles WHERE pole_id = $1', [target_id]);
        if (poleCheck.rows.length === 0) return res.status(404).json({ error: 'Pole not found' });
        affectedPoles = poleCheck.rows;
      }
    } else if (type === 'dt') {
      const res2 = await db.query(
        'SELECT pole_id, device_id, fw_version FROM poles WHERE dt_id = $1',
        [target_id],
      );
      affectedPoles = res2.rows;
    } else if (type === 'feeder') {
      const res2 = await db.query(
        'SELECT pole_id, device_id, fw_version FROM poles WHERE feeder_id = $1',
        [target_id],
      );
      affectedPoles = res2.rows;
    } else {
      return res.status(400).json({ error: 'type must be span, dt, or feeder' });
    }

    if (affectedPoles.length === 0) {
      return res.status(404).json({ error: 'No poles found for target' });
    }

    // Generate realistic telemetry
    const telemetryEvents = generateFaultTelemetry(affectedPoles);

    // Fire telemetry asynchronously with realistic delays
    fireTelemetry(telemetryEvents);

    if (wsBroadcastFn) {
      wsBroadcastFn('simulation_started', {
        type,
        target_id,
        affected_count: affectedPoles.length,
        message: `Injecting ${type} fault at ${target_id} — ${affectedPoles.length} poles affected`,
      });
    }

    res.json({
      status: 'injected',
      type,
      target_id,
      affected_pole_count: affectedPoles.length,
      message: `Fault injected. Expect ${affectedPoles.length} affected poles. Ticket should appear within ~30 seconds.`,
    });
  } catch (err) {
    console.error('[Simulator] fault error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/simulate/repair
router.post('/repair', async (req, res) => {
  try {
    const { target_id, type } = req.body;

    if (!target_id || !type) {
      return res.status(400).json({ error: 'target_id and type are required' });
    }

    let affectedPoles = [];

    if (type === 'span') {
      affectedPoles = await getDescendantPoles(target_id);
      if (affectedPoles.length === 0) {
        const poleCheck = await db.query('SELECT pole_id, device_id, fw_version FROM poles WHERE pole_id = $1', [target_id]);
        affectedPoles = poleCheck.rows;
      }
    } else if (type === 'dt') {
      const r = await db.query('SELECT pole_id, device_id, fw_version FROM poles WHERE dt_id = $1', [target_id]);
      affectedPoles = r.rows;
    } else if (type === 'feeder') {
      const r = await db.query('SELECT pole_id, device_id, fw_version FROM poles WHERE feeder_id = $1', [target_id]);
      affectedPoles = r.rows;
    }

    const poleIds = affectedPoles.map((p) => p.pole_id);

    // Restore all dark poles to energised state
    await db.query(
      `UPDATE pole_states SET energized = true, restored_at = NOW(), first_dark_at = NULL WHERE energized = 0 OR energized = false`,
    );

    // Mark active tickets associated with these poles as resolved
    if (poleIds.length > 0) {
      await db.query(
        `UPDATE fault_tickets
         SET status = 'resolved', resolved_at = NOW()
         WHERE status IN ('detected', 'acknowledged', 'crew_assigned')
           AND (span_from_pole_id IN (SELECT value FROM json_each($1)) OR span_to_pole_id IN (SELECT value FROM json_each($1)))`,
        [JSON.stringify(poleIds)],
      );
    }

    // Generate restoration telemetry (all devices boot + power_restored)
    const events = generateRestorationTelemetry(affectedPoles);
    fireTelemetry(events);

    if (wsBroadcastFn) {
      wsBroadcastFn('simulation_repaired', {
        type,
        target_id,
        message: `Repair signal sent for ${type} at ${target_id} — telemetry incoming`,
      });
      wsBroadcastFn('stats_updated', {});
    }

    res.json({
      status: 'repair_injected',
      affected_pole_count: affectedPoles.length,
      message: 'Restoration telemetry sent. Ticket should auto-verify within ~30 seconds.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/simulate/noise — kill a device while power is fine
router.post('/noise', async (req, res) => {
  try {
    const { pole_id } = req.body;
    if (!pole_id) return res.status(400).json({ error: 'pole_id required' });

    // Just mark the pole as dark in pole_states without any downstream cascade
    // This simulates a dead modem, vandalism, etc.
    await db.query(
      `UPDATE pole_states
       SET energized = false, last_event = 'device_failure', first_dark_at = NOW()
       WHERE pole_id = $1`,
      [pole_id],
    );

    if (wsBroadcastFn) {
      wsBroadcastFn('pole_state_changed', { pole_id, energized: false, event: 'device_failure', ts: new Date().toISOString() });
    }

    res.json({ status: 'noise_injected', pole_id, message: 'Device failure simulated. System should classify as sensor_failure, not a fault.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/simulate/targets — get available simulation targets
router.get('/targets', async (req, res) => {
  try {
    const dts = await db.query(`
      SELECT t.dt_id, t.feeder_id, t.lat, t.lon,
             COUNT(p.pole_id) AS pole_count
      FROM transformers t
      JOIN poles p ON p.dt_id = t.dt_id
      GROUP BY t.dt_id
      ORDER BY pole_count DESC
      LIMIT 50
    `);

    const feeders = await db.query(`
      SELECT f.feeder_id, f.name, COUNT(DISTINCT t.dt_id) AS dt_count
      FROM feeders f
      JOIN transformers t ON t.feeder_id = f.feeder_id
      GROUP BY f.feeder_id
      LIMIT 20
    `);

    // Get some poles with children (good span fault targets)
    const spanTargets = await db.query(`
      SELECT p.pole_id, p.dt_id, p.lat, p.lon,
             COUNT(c.pole_id) AS child_count
      FROM poles p
      JOIN poles c ON c.parent_pole_id = p.pole_id
      GROUP BY p.pole_id
      HAVING COUNT(c.pole_id) > 0
      ORDER BY child_count DESC
      LIMIT 30
    `);

    res.json({
      dts: dts.rows,
      feeders: feeders.rows,
      span_targets: spanTargets.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getDescendantPoles(poleId) {
  // Recursive CTE to get all descendants
  const res = await db.query(
    `WITH RECURSIVE descendants AS (
       SELECT pole_id, device_id, fw_version FROM poles WHERE pole_id = $1
       UNION ALL
       SELECT p.pole_id, p.device_id, p.fw_version
       FROM poles p
       JOIN descendants d ON p.parent_pole_id = d.pole_id
     )
     SELECT pole_id, device_id, fw_version FROM descendants`,
    [poleId],
  );
  return res.rows;
}

function generateFaultTelemetry(poles) {
  const now = Date.now();
  const events = [];

  for (const pole of poles) {
    if (!pole.device_id) continue;

    const isFirmware12 = pole.fw_version && pole.fw_version.startsWith('1.2');

    if (isFirmware12) {
      // Firmware 1.2.x: just stops heartbeating — no power_lost event
      continue;
    }

    // 70% chance of sending power_lost (30% fail due to capacitor)
    if (Math.random() > 0.70) continue;

    // Immediate delivery for interactive simulation (0–2s delay)
    const delay = Math.floor(Math.random() * 2000);
    const ts = new Date(now).toISOString();

    events.push({
      delay,
      payload: {
        device_id: pole.device_id,
        pole_id:   pole.pole_id,
        event:     'power_lost',
        energized: false,
        ts,
        seq:       Math.floor(Math.random() * 100_000),
        battery_mv: Math.floor(Math.random() * 400) + 3100,
        rssi:      -Math.floor(Math.random() * 40) - 70,
        fw:        pole.fw_version,
      },
    });

    // ~10% chance of duplicate (at-least-once delivery)
    if (Math.random() < 0.10) {
      events.push({
        delay: delay + Math.floor(Math.random() * 5000),
        payload: { ...events[events.length - 1].payload },
      });
    }
  }

  return events;
}

function generateRestorationTelemetry(poles) {
  const now = Date.now();
  const events = [];

  for (const pole of poles) {
    if (!pole.device_id) continue;

    const delay = Math.floor(Math.random() * 20_000); // 0–20s staggered
    const ts = new Date(now).toISOString();

    // boot
    events.push({
      delay,
      payload: {
        device_id: pole.device_id,
        pole_id:   pole.pole_id,
        event:     'boot',
        energized: true,
        ts,
        seq:       Math.floor(Math.random() * 100_000),
        battery_mv: 4200,
        rssi:      -Math.floor(Math.random() * 30) - 65,
        fw:        pole.fw_version,
      },
    });

    // power_restored (20s after boot)
    events.push({
      delay: delay + 20_000,
      payload: {
        device_id: pole.device_id,
        pole_id:   pole.pole_id,
        event:     'power_restored',
        energized: true,
        ts:        new Date(now + 20_000).toISOString(),
        seq:       Math.floor(Math.random() * 100_000) + 1,
        battery_mv: 4200,
        rssi:      -Math.floor(Math.random() * 30) - 65,
        fw:        pole.fw_version,
      },
    });
  }

  return events;
}

function fireTelemetry(events) {
  const baseUrl = `http://localhost:${process.env.PORT || 4000}/api/telemetry`;

  for (const ev of events) {
    setTimeout(async () => {
      try {
        // Use the in-process queue directly to avoid HTTP overhead
        const queue = require('../queue');
        const payload = ev.payload;
        const energized = payload.energized !== undefined ? Boolean(payload.energized) : payload.event !== 'power_lost';
        queue.push({
          device_id:  payload.device_id,
          pole_id:    payload.pole_id,
          event:      payload.event,
          energized,
          ts:         payload.ts || new Date().toISOString(),
          seq:        payload.seq || 0,
          battery_mv: payload.battery_mv,
          rssi:       payload.rssi,
          fw:         payload.fw,
          received_at: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[Simulator] fireTelemetry error:', err.message);
      }
    }, ev.delay);
  }
}

module.exports = router;
module.exports.setWs = setWs;
