/**
 * Fault Localizer — Core Algorithm
 *
 * Algorithm overview:
 *
 * For each distribution transformer (DT):
 *   1. Skip if entire DT is under a scheduled outage window (± 40 min grace).
 *   2. Load current pole states for this DT.
 *   3. Build the DT's topology tree (known or MST-inferred).
 *   4. BFS/DFS from the DT roots:
 *      - If a pole is LIVE and a child is DARK  → live/dark boundary = fault span
 *      - Collect all dark descendants of the dark child → they are symptoms of same fault
 *      - Special case: dark pole with ALL children live → sensor failure, not a fault
 *   5. For each boundary found → call ticketManager.upsert()
 *   6. Check restorations: tickets whose affected poles are all live again → auto-verify
 *
 * Simultaneous faults: two separate boundaries on the same DT produce two tickets.
 * Multiple dark descendants of one boundary → all folded into one ticket.
 *
 * DT-level fault: ALL poles under a DT are dark with no live boundary above → DT fault.
 * Feeder-level fault: ALL DTs on a feeder are fully dark → feeder fault.
 *
 * Confidence scoring:
 *   base:
 *     known topology   → 0.90
 *     inferred topology → 0.55
 *   adjustments:
 *     + 0.05 if ≥ 80% of affected poles reported dark (vs silent)
 *     - 0.10 if many gap poles (undeviced) in affected span
 *     - 0.05 if boundary pole is undeviced (fault location is uncertain)
 *     cap to [0.30, 0.97]
 */

const db = require('../db');
const { buildDtTree, collectDescendants } = require('./topology');
const { midpoint } = require('./geoUtils');

const OUTAGE_GRACE_MS = 40 * 60 * 1000; // ±40 minutes
// Minimum dark duration before we create a ticket (debounce)
const DARK_DEBOUNCE_SEC = parseInt(process.env.DARK_DEBOUNCE_SEC || '5');

/**
 * Run a full localization pass for all DTs.
 * Returns an array of detected fault boundary descriptors.
 */
async function runLocalization(wsBroadcast) {
  try {
    const start = Date.now();

    // Load everything in as few queries as possible
    const [dtRes, poleRes, stateRes, outageRes] = await Promise.all([
      db.query('SELECT * FROM transformers'),
      db.query(`
        SELECT p.pole_id, p.lat, p.lon, p.feeder_id, p.dt_id,
               p.parent_pole_id, p.device_id, p.topology_known,
               p.ward, p.pincode
        FROM poles p
      `),
      db.query(`
        SELECT ps.pole_id, ps.energized, ps.last_seen,
               ps.last_event, ps.first_dark_at, ps.fw_version
        FROM pole_states ps
      `),
      db.query(`
        SELECT * FROM scheduled_outages
        WHERE cancelled = false
          AND start_time <= NOW() + INTERVAL '40 minutes'
          AND end_time   >= NOW() - INTERVAL '40 minutes'
      `),
    ]);

    const dts       = dtRes.rows;
    const allPoles  = poleRes.rows;
    const allStates = stateRes.rows;
    const outages   = outageRes.rows;

    // Index for fast lookup
    const stateByPole = new Map(allStates.map((s) => [s.pole_id, s]));
    const polesByDt   = new Map();
    for (const p of allPoles) {
      if (!polesByDt.has(p.dt_id)) polesByDt.set(p.dt_id, []);
      polesByDt.get(p.dt_id).push(p);
    }

    // Build scheduled outage sets
    const scheduledFeeders = new Set();
    const scheduledDts     = new Set();
    for (const o of outages) {
      if (o.scope === 'feeder') scheduledFeeders.add(o.target_id);
      if (o.scope === 'dt')     scheduledDts.add(o.target_id);
    }

    // Group DTs by feeder for feeder-level detection
    const dtsByFeeder = new Map();
    for (const dt of dts) {
      if (!dtsByFeeder.has(dt.feeder_id)) dtsByFeeder.set(dt.feeder_id, []);
      dtsByFeeder.get(dt.feeder_id).push(dt);
    }

    const allBoundaries = [];

    // ── Feeder-level fault detection ─────────────────────────────────────────
    for (const [feederId, feedDts] of dtsByFeeder) {
      if (scheduledFeeders.has(feederId)) continue;
      const feederPoles = feedDts.flatMap((dt) => polesByDt.get(dt.dt_id) || []);
      if (feederPoles.length === 0) continue;

      const devicPoles = feederPoles.filter((p) => p.device_id);
      if (devicPoles.length < 3) continue; // too few sensors for confidence

      const allDark = devicPoles.every((p) => {
        const s = stateByPole.get(p.pole_id);
        return s && s.energized === false && isDebounced(s);
      });

      if (allDark) {
        allBoundaries.push({
          type: 'feeder',
          feeder_id: feederId,
          dt_id: null,
          span_from: null,
          span_to: null,
          affected_poles: feederPoles.map((p) => p.pole_id),
          confidence: 0.82,
          confidence_reason: 'All sensors on feeder reporting dark simultaneously',
          topology_inferred: false,
          lat: feedDts[0].lat,
          lon: feedDts[0].lon,
          pincode: feederPoles.find((p) => p.pincode)?.pincode || null,
          boundary_key: `feeder_${feederId}`,
        });
        // Don't process individual DTs on this feeder — they're all downstream symptoms
        for (const dt of feedDts) scheduledDts.add(`_feeder_masked_${dt.dt_id}`);
        continue;
      }
    }

    // ── Per-DT processing ────────────────────────────────────────────────────
    for (const dt of dts) {
      if (scheduledFeeders.has(dt.feeder_id)) continue;
      if (scheduledDts.has(dt.dt_id)) continue;

      const poles = polesByDt.get(dt.dt_id) || [];
      if (poles.length === 0) continue;

      const devicPoles = poles.filter((p) => p.device_id);
      if (devicPoles.length === 0) continue;

      // ── DT-level fault: all poles under DT are dark ───────────────────────
      const allDark = devicPoles.every((p) => {
        const s = stateByPole.get(p.pole_id);
        return s && s.energized === false && isDebounced(s);
      });

      if (allDark && devicPoles.length >= 2) {
        allBoundaries.push({
          type: 'dt',
          feeder_id: dt.feeder_id,
          dt_id: dt.dt_id,
          span_from: null,
          span_to: null,
          affected_poles: poles.map((p) => p.pole_id),
          confidence: 0.80,
          confidence_reason: `All ${devicPoles.length} sensors under DT ${dt.dt_id} reporting dark — likely DT or HT fuse failure`,
          topology_inferred: false,
          lat: dt.lat,
          lon: dt.lon,
          pincode: poles.find((p) => p.pincode)?.pincode || null,
          boundary_key: `dt_${dt.dt_id}`,
        });
        continue;
      }

      // ── Span-level fault: tree traversal ─────────────────────────────────
      const { children, roots, inferred } = buildDtTree(dt, poles);
      const boundaries = findSpanBoundaries(dt, poles, roots, children, stateByPole, inferred);
      allBoundaries.push(...boundaries);
    }

    console.log(`[Localizer] Pass complete in ${Date.now() - start}ms — found ${allBoundaries.length} boundaries`);
    return allBoundaries;

  } catch (err) {
    console.error('[Localizer] Error during localization pass:', err.message);
    return [];
  }
}

/**
 * Find span-level fault boundaries within a single DT's tree.
 */
function findSpanBoundaries(dt, poles, roots, children, stateByPole, inferred) {
  const boundaries = [];
  const poleById = new Map(poles.map((p) => [p.pole_id, p]));

  function getState(poleId) {
    return stateByPole.get(poleId) || { energized: true, first_dark_at: null };
  }

  function isLive(poleId) {
    const s = getState(poleId);
    // No state = assume live (conservative)
    if (!s) return true;
    return s.energized !== false;
  }

  function isEffectivelyDark(poleId) {
    const s = getState(poleId);
    if (!s || s.energized !== false) return false;
    return isDebounced(s);
  }

  /**
   * Check if a single dark pole is actually a dead sensor.
   * A pole that is dark but has live children is physically impossible
   * as a span fault — it must be a sensor failure.
   */
  function isDeadSensor(poleId) {
    const kids = children.get(poleId) || [];
    if (kids.length === 0) return false; // no children, can't tell from topology alone
    const anyLiveChild = kids.some((kid) => isLive(kid));
    const allChildrenLive = kids.every((kid) => isLive(kid));
    // If all children are live and this pole is dark → definitely dead sensor
    return allChildrenLive && kids.length > 0;
  }

  const visited = new Set();

  function dfs(poleId, parentIsLive) {
    if (visited.has(poleId)) return;
    visited.add(poleId);

    const kids = children.get(poleId) || [];
    const poleLive = isLive(poleId);
    const poleDark = isEffectivelyDark(poleId);

    // Dead sensor check
    if (poleDark && isDeadSensor(poleId)) {
      // Sensor failure — don't create a ticket, just continue to children
      for (const kid of kids) dfs(kid, true); // children see their "real" parent as live
      return;
    }

    if (parentIsLive && poleDark) {
      // ← FAULT BOUNDARY FOUND →
      // Collect all dark descendants
      const affectedIds = collectDarkDescendants(children, poleId, stateByPole);
      const affectedPoles = affectedIds.map((id) => poleById.get(id)).filter(Boolean);

      // Find the parent pole (span_from)
      const parentPole = findParentPole(poleId, poles);

      // Compute midpoint between span_from and span_to for navigation coords
      const spanFrom = poleById.get(poleId);
      const spanFromParent = parentPole;
      let faultLat, faultLon;
      if (spanFromParent && spanFrom) {
        const mid = midpoint(spanFromParent.lat, spanFromParent.lon, spanFrom.lat, spanFrom.lon);
        faultLat = mid.lat;
        faultLon = mid.lon;
      } else if (spanFrom) {
        faultLat = spanFrom.lat;
        faultLon = spanFrom.lon;
      } else {
        faultLat = dt.lat;
        faultLon = dt.lon;
      }

      // Confidence calculation
      const hasDevice = (id) => poleById.get(id)?.device_id;
      const devicAffected = affectedIds.filter(hasDevice).length;
      const totalAffected = affectedIds.length;
      const coverageFraction = totalAffected > 0 ? devicAffected / totalAffected : 0;
      const spanFromUndeviced = !poleById.get(poleId)?.device_id;

      let confidence = inferred ? 0.55 : 0.90;
      if (coverageFraction >= 0.8) confidence = Math.min(confidence + 0.05, 0.97);
      if (coverageFraction < 0.5) confidence = Math.max(confidence - 0.10, 0.30);
      if (spanFromUndeviced)      confidence = Math.max(confidence - 0.05, 0.30);

      const reasonParts = [];
      if (inferred) reasonParts.push('topology inferred from GPS (no wiring diagram on record)');
      reasonParts.push(`${devicAffected}/${totalAffected} downstream sensors reporting dark`);
      if (spanFromUndeviced) reasonParts.push('boundary pole has no sensor (location is estimated)');

      const pincode =
        affectedPoles.find((p) => p.pincode)?.pincode ||
        poles.find((p) => p.pincode)?.pincode ||
        null;

      boundaries.push({
        type: 'span',
        feeder_id: dt.feeder_id,
        dt_id: dt.dt_id,
        span_from: parentPole?.pole_id || null,
        span_to: poleId,
        affected_poles: affectedIds,
        confidence: Math.round(confidence * 1000) / 1000,
        confidence_reason: reasonParts.join('; '),
        topology_inferred: inferred,
        lat: faultLat,
        lon: faultLon,
        pincode,
        boundary_key: `span_${parentPole?.pole_id || dt.dt_id}_${poleId}`,
      });

      // Don't recurse further — dark descendants are already folded in
      return;
    }

    // Both live, or parent dark and child dark (deeper into same outage) — recurse
    for (const kid of kids) {
      dfs(kid, poleLive);
    }
  }

  // Start DFS from each root
  for (const rootId of roots) {
    // Root poles connect directly to DT — parent is "live" (DT is energised if we got here)
    dfs(rootId, true);
  }

  return boundaries;
}

/**
 * Collect all dark descendants (inclusive) via DFS.
 */
function collectDarkDescendants(children, startId, stateByPole) {
  const result = [];
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    result.push(id);
    const kids = children.get(id) || [];
    for (const kid of kids) {
      const s = stateByPole.get(kid);
      // Include both explicitly dark AND unknown (no state) poles within dark subtree
      if (!s || s.energized === false) {
        stack.push(kid);
      }
    }
  }
  return result;
}

/**
 * Find the upstream parent pole of a given pole from the pole list.
 * For known topology: use parent_pole_id.
 * For inferred: can't easily backtrack from children map, return null.
 */
function findParentPole(poleId, poles) {
  const pole = poles.find((p) => p.pole_id === poleId);
  if (!pole || !pole.parent_pole_id) return null;
  return poles.find((p) => p.pole_id === pole.parent_pole_id) || null;
}

/**
 * Has this pole been dark long enough to trigger a ticket?
 * (Debounce: avoids creating tickets for brief transients)
 */
function isDebounced(state) {
  if (!state.first_dark_at) return false;
  const darkMs = Date.now() - new Date(state.first_dark_at).getTime();
  return darkMs >= DARK_DEBOUNCE_SEC * 1000;
}

module.exports = { runLocalization, DARK_DEBOUNCE_SEC };
