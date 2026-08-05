/**
 * Synthetic Network Generator
 *
 * Generates a realistic power distribution network for Karnataka (Bengaluru subdivision).
 * Matches the schemas and proportions from 02-data-and-systems.md:
 *
 *   4 substations, 31 feeders, 412 DTs, ~5,000 poles
 *   ~40% of DTs have known topology (parent_pole_id set)
 *   ~60% of DTs have only GPS + dt_id (no topology)
 *   ~9% of poles have no device
 *   ~8% of devices on firmware 1.2.x (silent on power loss)
 *   Households per DT: 50–500, median ~200
 *
 * Centre: Bengaluru 12.9716°N 77.5946°E
 * Spread: ~15km radius (one city subdivision)
 */

const CENTER_LAT = 12.9716;
const CENTER_LON = 77.5946;

// Spread ±0.12° ≈ ±13km
const SPREAD = 0.12;

let poleCounter  = 1;
let deviceCounter = 1;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function jitter(value, maxDelta) {
  return value + rand(-maxDelta, maxDelta);
}

function fmtPoleId(n) {
  return `P-${String(n).padStart(6, '0')}`;
}

function fmtDeviceId(subdivId, dtId, n) {
  return `KSPDB-${subdivId}-${dtId}-${String(n).padStart(4, '0')}`;
}

const WARDS = ['W-001','W-002','W-003','W-004','W-005','W-006','W-007','W-008',
               'W-009','W-010','W-011','W-012','W-013','W-014','W-015','W-016'];

const PINCODES = ['560001','560002','560003','560004','560005','560008','560010',
                  '560011','560012','560018','560020','560021','560029','560034',
                  '560038','560040','560050','560055','560060','560066','560078','560085'];

const POLE_TYPES = ['LT-9m-PCC','LT-9m-PCC','LT-8m-Steel','LT-11m-PSC','LT-9m-PCC'];

function randItem(arr) { return arr[randInt(0, arr.length - 1)]; }

/**
 * Walk a LT line from a starting point, placing poles ~50–100m apart.
 * Occasionally branch off a spur.
 * Returns array of { lat, lon, parent_pole_id } objects (relative positions).
 */
function walkLine(startLat, startLon, numPoles, dt, knownTopology) {
  const poles = [];
  // Direction in degrees (radians): random
  const DEG_PER_METER = 1 / 111_320;

  const branches = [];
  let lat = startLat;
  let lon = startLon;
  let parentId = null;
  let branchBudget = numPoles;

  // Build main trunk
  const trunkLen = Math.ceil(numPoles * rand(0.5, 0.85));
  const branchLen = numPoles - trunkLen;

  let angle = rand(0, 2 * Math.PI);

  for (let i = 0; i < trunkLen; i++) {
    const dist = rand(45, 100); // metres
    // Slight random walk in direction
    angle += rand(-0.3, 0.3);
    lat += dist * DEG_PER_METER * Math.cos(angle);
    lon += dist * DEG_PER_METER * Math.sin(angle) / Math.cos((lat * Math.PI) / 180);

    const poleId = fmtPoleId(poleCounter++);
    poles.push({
      pole_id: poleId,
      lat: parseFloat(lat.toFixed(7)),
      lon: parseFloat(lon.toFixed(7)),
      parent_pole_id: knownTopology ? parentId : null,
      seq_on_line: knownTopology ? i + 1 : null,
    });
    parentId = poleId;

    // Chance to start a branch
    if (branchLen > 0 && i > 2 && Math.random() < 0.3 && branches.length < 3) {
      branches.push({ branchParent: poleId, branchLat: lat, branchLon: lon });
    }
  }

  // Build branches
  let branchSeq = trunkLen + 1;
  for (const br of branches) {
    let bLat = br.branchLat;
    let bLon = br.branchLon;
    let bParent = br.branchParent;
    const bAngle = angle + rand(Math.PI / 3, (2 * Math.PI) / 3);
    const bLen = randInt(1, Math.max(1, branchLen / branches.length));

    for (let j = 0; j < bLen; j++) {
      const dist = rand(40, 90);
      bLat += dist * DEG_PER_METER * Math.cos(bAngle);
      bLon += dist * DEG_PER_METER * Math.sin(bAngle) / Math.cos((bLat * Math.PI) / 180);

      const poleId = fmtPoleId(poleCounter++);
      poles.push({
        pole_id: poleId,
        lat: parseFloat(bLat.toFixed(7)),
        lon: parseFloat(bLon.toFixed(7)),
        parent_pole_id: knownTopology ? bParent : null,
        seq_on_line: knownTopology ? branchSeq++ : null,
      });
      bParent = poleId;
    }
  }

  return poles;
}

/**
 * Main generator. Returns { substations, feeders, transformers, poles }.
 */
function generateNetwork() {
  const substations = [];
  const feeders     = [];
  const transformers = [];
  const poles       = [];

  // ── 4 Substations ───────────────────────────────────────────────────────────
  const ssPositions = [
    { lat: CENTER_LAT + 0.08, lon: CENTER_LON - 0.08 },
    { lat: CENTER_LAT + 0.08, lon: CENTER_LON + 0.08 },
    { lat: CENTER_LAT - 0.08, lon: CENTER_LON - 0.08 },
    { lat: CENTER_LAT - 0.08, lon: CENTER_LON + 0.08 },
  ];

  for (let si = 0; si < 4; si++) {
    const ssId = `SS-0${si + 1}`;
    substations.push({
      substation_id: ssId,
      name: `Substation ${String.fromCharCode(65 + si)}`,
      lat: ssPositions[si].lat,
      lon: ssPositions[si].lon,
    });

    // ── ~8 Feeders per substation (31 total) ──────────────────────────────
    const numFeeders = si < 3 ? 8 : 7; // 8+8+8+7 = 31
    for (let fi = 0; fi < numFeeders; fi++) {
      const feederId = `F-${String(si + 1).padStart(2, '0')}-${String(fi + 1).padStart(2, '0')}`;
      feeders.push({ feeder_id: feederId, substation_id: ssId, name: `Feeder ${feederId}` });

      // ── ~13 DTs per feeder (412 total) ──────────────────────────────────
      const numDts = randInt(12, 14);
      for (let di = 0; di < numDts; di++) {
        const dtId = `D-${String(transformers.length + 1).padStart(4, '0')}`;
        const dtLat = jitter(ssPositions[si].lat, SPREAD * 0.9);
        const dtLon = jitter(ssPositions[si].lon, SPREAD * 0.9);

        const knownTopology = Math.random() < 0.40;
        const households    = randInt(50, 500);
        const capacityKva   = randItem([100, 160, 250, 400, 500]);

        transformers.push({
          dt_id: dtId,
          feeder_id: feederId,
          lat: parseFloat(dtLat.toFixed(7)),
          lon: parseFloat(dtLon.toFixed(7)),
          capacity_kva: capacityKva,
          households_served: households,
          topology_known: knownTopology,
        });

        // ── Poles for this DT (~12 per DT, range 6–25) ──────────────────
        const numPoles = randInt(6, 25);
        const dtPoles  = walkLine(dtLat, dtLon, numPoles, dtId, knownTopology);

        const ward    = randItem(WARDS);
        const pincode = randItem(PINCODES);
        // ~3% of poles get no pincode
        const subdivId = `SD${String(si + 1).padStart(2, '0')}`;

        for (const p of dtPoles) {
          const hasDevice  = Math.random() > 0.09;  // ~91% have device
          const isFirmware12 = hasDevice && Math.random() < 0.08;
          const fwVersion  = isFirmware12 ? '1.2.3' : `1.${randInt(3, 5)}.${randInt(0, 9)}`;
          const deviceId   = hasDevice ? fmtDeviceId(subdivId, dtId, deviceCounter++) : null;
          const noPincode  = Math.random() < 0.03;

          poles.push({
            pole_id:        p.pole_id,
            lat:            p.lat,
            lon:            p.lon,
            feeder_id:      feederId,
            dt_id:          dtId,
            seq_on_line:    p.seq_on_line,
            parent_pole_id: p.parent_pole_id,
            pole_type:      randItem(POLE_TYPES),
            ward:           ward,
            pincode:        noPincode ? null : pincode,
            device_id:      deviceId,
            fw_version:     hasDevice ? fwVersion : null,
            topology_known: knownTopology,
          });
        }
      }
    }
  }

  console.log(`[Generator] Generated:
    Substations : ${substations.length}
    Feeders     : ${feeders.length}
    Transformers: ${transformers.length}
    Poles       : ${poles.length}
    With device : ${poles.filter((p) => p.device_id).length}
    Known topo  : ${transformers.filter((t) => t.topology_known).length} DTs`);

  return { substations, feeders, transformers, poles };
}

module.exports = { generateNetwork };
