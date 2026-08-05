/**
 * Database seeder — runs on container startup.
 * Idempotent: skips if data already exists.
 */

const fs   = require('fs');
const path = require('path');
const db   = require('../db');
const { generateNetwork } = require('./generateNetwork');

async function runMigration() {
  const sqlPath = path.join(__dirname, '../../migrations/001_init.sql');
  let sql = fs.readFileSync(sqlPath, 'utf8');

  // Check if poles table already exists
  try {
    const check = await db.query(`SELECT COUNT(*) as count FROM poles`);
    if (check && check.rows && check.rows.length > 0) {
      console.log('[Seed] Tables already exist — skipping migration');
      return;
    }
  } catch (_) {
    // Table doesn't exist yet, proceed to create
  }

  console.log('[Seed] Running migration...');
  
  if (!db.isPg()) {
    // Strip comments first then split by semicolon for SQLite
    const cleanedSql = sql
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.toUpperCase().startsWith('CREATE EXTENSION'));

    for (const stmt of statements) {
      try {
        await db.query(stmt);
      } catch (e) {
        if (!e.message.includes('already exists')) {
          console.warn('[Migration Warning]', e.message, 'Stmt:', stmt.slice(0, 50));
        }
      }
    }
  } else {
    await db.query(sql);
  }

  console.log('[Seed] Migration complete');
}

async function seedNetwork() {
  try {
    const existing = await db.query('SELECT COUNT(*) as count FROM poles');
    if (existing && existing.rows && parseInt(existing.rows[0].count) > 0) {
      console.log('[Seed] Poles already seeded — skipping');
      return;
    }
  } catch (err) {
    // Table might not exist or empty
  }

  console.log('[Seed] Generating synthetic network...');
  const { substations, feeders, transformers, poles } = generateNetwork();

  await db.query('BEGIN');

  try {
    // Substations
    for (const s of substations) {
      await db.query(
        `INSERT INTO substations (substation_id, name, lat, lon) VALUES ($1,$2,$3,$4)`,
        [s.substation_id, s.name, s.lat, s.lon],
      );
    }

    // Feeders
    for (const f of feeders) {
      await db.query(
        `INSERT INTO feeders (feeder_id, substation_id, name) VALUES ($1,$2,$3)`,
        [f.feeder_id, f.substation_id, f.name],
      );
    }

    // Transformers
    for (const t of transformers) {
      await db.query(
        `INSERT INTO transformers (dt_id, feeder_id, lat, lon, capacity_kva, households_served, topology_known)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [t.dt_id, t.feeder_id, t.lat, t.lon, t.capacity_kva, t.households_served, t.topology_known],
      );
    }

    // Poles
    const noParent  = poles.filter((p) => !p.parent_pole_id);
    const hasParent = poles.filter((p) =>  p.parent_pole_id);

    for (const p of [...noParent, ...hasParent]) {
      await db.query(
        `INSERT INTO poles (pole_id, lat, lon, feeder_id, dt_id, seq_on_line, parent_pole_id,
                            pole_type, ward, pincode, device_id, fw_version, topology_known)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [p.pole_id, p.lat, p.lon, p.feeder_id, p.dt_id, p.seq_on_line, p.parent_pole_id,
         p.pole_type, p.ward, p.pincode, p.device_id, p.fw_version, p.topology_known],
      );
    }

    // Initialise pole_states
    const devicePoles = poles.filter((p) => p.device_id);
    for (const p of devicePoles) {
      await db.query(
        `INSERT INTO pole_states (pole_id, energized, last_seen, last_event, fw_version)
         VALUES ($1, true, NOW(), 'boot', $2)`,
        [p.pole_id, p.fw_version],
      );
    }

    // Scheduled outages
    const now = new Date();
    const futureSched = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const futureEnd   = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    if (feeders.length > 0) {
      await db.query(
        `INSERT INTO scheduled_outages (id, scope, target_id, start_time, end_time, reason)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['SO-DEMO-001', 'feeder', feeders[0].feeder_id, futureSched.toISOString(), futureEnd.toISOString(), 'Planned maintenance - jumper replacement'],
      );
    }

    await db.query('COMMIT');

    console.log(`[Seed] Seeded successfully:
      ${substations.length} substations
      ${feeders.length} feeders
      ${transformers.length} transformers
      ${poles.length} poles (${devicePoles.length} with devices)
    `);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

async function run() {
  let retries = 5;
  while (retries > 0) {
    try {
      await runMigration();
      await seedNetwork();
      console.log('[Seed] Ready');
      return;
    } catch (err) {
      retries--;
      console.error(`[Seed] Error (${retries} retries left):`, err.message);
      if (retries === 0) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

module.exports = { run };
