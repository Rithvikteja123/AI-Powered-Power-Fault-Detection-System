/**
 * Topology Service
 *
 * Builds the DT→poles adjacency tree for fault localization.
 *
 * Two modes:
 *  A. KNOWN topology  — parent_pole_id is set in DB; direct tree walk
 *  B. INFERRED topology — parent_pole_id missing; we reconstruct using
 *     a geographic Minimum Spanning Tree (Prim's algorithm with Haversine distance)
 *
 * The MST approach is not perfect — it can mis-join branch points — but it
 * gives a plausible tree for ~60% of DTs that have no recorded wiring order.
 * We flag these as "topology_inferred" and cap confidence at 0.65.
 *
 * Failure modes documented:
 *  - Two physical branches may get merged into one MST branch if their
 *    endpoints are closer to each other than to the main trunk pole.
 *  - Isolated poles (no device, no neighbors) become leaf nodes.
 *  - Gaps (undeviced poles) are preserved as nodes but have no state signal.
 */

const { haversineMeters } = require('./geoUtils');

/**
 * Build a map { poleId → [childId, ...] } for a single DT's poles.
 *
 * @param {object} dt   - transformer row { dt_id, lat, lon, topology_known }
 * @param {Array}  poles - all pole rows for this DT
 * @returns {{ children: Map, roots: string[], inferred: boolean }}
 */
function buildDtTree(dt, poles) {
  const inferred = !dt.topology_known;

  if (!inferred) {
    return buildKnownTree(poles);
  } else {
    return buildInferredTree(dt, poles);
  }
}

// ─── KNOWN topology ──────────────────────────────────────────────────────────

function buildKnownTree(poles) {
  const children = new Map(); // poleId → [childId, ...]

  for (const p of poles) {
    if (!children.has(p.pole_id)) children.set(p.pole_id, []);
    if (p.parent_pole_id) {
      if (!children.has(p.parent_pole_id)) children.set(p.parent_pole_id, []);
      children.get(p.parent_pole_id).push(p.pole_id);
    }
  }

  // Roots = poles with no parent (directly connected to DT)
  const roots = poles
    .filter((p) => !p.parent_pole_id)
    .map((p) => p.pole_id);

  return { children, roots, inferred: false };
}

// ─── INFERRED topology (geographic MST via Prim's algorithm) ─────────────────

function buildInferredTree(dt, poles) {
  if (poles.length === 0) {
    return { children: new Map(), roots: [], inferred: true };
  }

  const DT_NODE = '__DT__';
  const nodeById = new Map([[DT_NODE, { pole_id: DT_NODE, lat: dt.lat, lon: dt.lon }]]);
  for (const p of poles) nodeById.set(p.pole_id, p);

  // Prim's MST:
  //   key[v]    = minimum edge weight from any MST node to v
  //   parent[v] = which MST node provides that minimum-weight edge
  //
  // We seed by computing DT → each pole distance before the main loop,
  // so DT_NODE's relaxation happens before the first iteration.

  const inMST  = new Set([DT_NODE]);
  const key    = new Map(poles.map((p) => [p.pole_id, Infinity]));
  const parent = new Map();

  // Seed: distances from DT to all poles
  for (const p of poles) {
    const d = haversineMeters(dt.lat, dt.lon, p.lat, p.lon);
    key.set(p.pole_id, d);
    parent.set(p.pole_id, DT_NODE);
  }

  // Main Prim loop: add one pole at a time
  while (key.size > 0) {
    // Pick u = non-MST pole with minimum key
    let u = null;
    let minKey = Infinity;
    for (const [id, k] of key) {
      if (k < minKey) { minKey = k; u = id; }
    }
    if (u === null) break;

    inMST.add(u);
    key.delete(u);

    const uNode = nodeById.get(u);

    // Relax edges from u to all remaining non-MST poles
    for (const [id, k] of key) {
      const v = nodeById.get(id);
      const d = haversineMeters(uNode.lat, uNode.lon, v.lat, v.lon);
      if (d < k) {
        key.set(id, d);
        parent.set(id, u);
      }
    }
  }

  // Build children adjacency map from parent relationships
  const children = new Map(poles.map((p) => [p.pole_id, []]));
  const roots = [];

  for (const p of poles) {
    const par = parent.get(p.pole_id);
    if (!par || par === DT_NODE) {
      roots.push(p.pole_id);
    } else {
      if (!children.has(par)) children.set(par, []);
      children.get(par).push(p.pole_id);
    }
  }

  return { children, roots, inferred: true };
}

/**
 * Collect all descendant pole IDs (inclusive of startId) via DFS.
 */
function collectDescendants(children, startId) {
  const visited = [];
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    visited.push(id);
    const kids = children.get(id) || [];
    stack.push(...kids);
  }
  return visited;
}

module.exports = { buildDtTree, collectDescendants };
