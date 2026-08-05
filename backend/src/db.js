/**
 * Hybrid Database Adapter (PostgreSQL + SQLite Fallback)
 * 
 * Ensures the system works 100% out-of-the-box in both environments:
 * 1. PostgreSQL (when running in Docker Compose or production)
 * 2. SQLite via better-sqlite3 (when running `npm run dev` locally without Postgres)
 */

const { Pool } = require('pg');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let isPg = false;
let pgPool = null;
let sqliteDb = null;
let dbInitialized = false;

// Convert PostgreSQL $1, $2 syntax to SQLite ? syntax
function convertSqlForSqlite(sql, params = []) {
  let convertedSql = sql;

  // Replace $1, $2, etc with ?
  convertedSql = convertedSql.replace(/\$\d+/g, '?');

  // Replace Postgres-specific functions & syntax for SQLite compatibility
  convertedSql = convertedSql
    .replace(/DEFAULT\s+gen_random_uuid\(\)/gi, "")
    .replace(/DEFAULT\s+NOW\(\)/gi, "DEFAULT CURRENT_TIMESTAMP")
    .replace(/BIGSERIAL\s+PRIMARY\s+KEY/gi, "INTEGER PRIMARY KEY AUTOINCREMENT")
    .replace(/BIGSERIAL/gi, "INTEGER")
    .replace(/UUID/gi, "TEXT")
    .replace(/JSONB/gi, "TEXT")
    .replace(/NOW\(\)\s*([+-])\s*INTERVAL\s*'(\d+)\s*(minute|minutes|hour|hours|day|days)'/gi, (match, op, num, unit) => {
      const sign = op === '+' ? '+' : '-';
      const u = unit.startsWith('minute') ? 'minutes' : unit.startsWith('hour') ? 'hours' : 'days';
      return `datetime('now', '${sign}${num} ${u}')`;
    })
    .replace(/\+\s*INTERVAL\s*'(\d+)\s*(minute|minutes|hour|hours|day|days)'/gi, "+ '$1 $2'")
    .replace(/-\s*INTERVAL\s*'(\d+)\s*(minute|minutes|hour|hours|day|days)'/gi, "- '$1 $2'")
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/GREATEST\(/gi, "MAX(")
    .replace(/TIMESTAMPTZ/gi, "TEXT")
    .replace(/BOOLEAN DEFAULT false/gi, "INTEGER DEFAULT 0")
    .replace(/BOOLEAN DEFAULT true/gi, "INTEGER DEFAULT 1")
    .replace(/to_regclass\('public\.poles'\)/gi, "name FROM sqlite_master WHERE type='table' AND name='poles'")
    .replace(/::text\[\]/gi, "")
    .replace(/=\s*ANY\s*\(\s*\?\s*\)/gi, "IN (SELECT value FROM json_each(?))");

  return { sql: convertedSql, params };
}

async function initDb() {
  if (dbInitialized) return;

  // Try PostgreSQL connection with 1.5s timeout
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432');
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || 'password';
  const database = process.env.DB_NAME || 'kspdb';

  const testPool = new Pool({
    host, port, user, password, database,
    connectionTimeoutMillis: 1500,
  });

  try {
    const client = await testPool.connect();
    client.release();
    pgPool = testPool;
    isPg = true;
    console.log(`[DB] Connected to PostgreSQL at ${host}:${port}/${database}`);
  } catch (err) {
    testPool.end().catch(() => {});
    console.log(`[DB] PostgreSQL not reachable (${err.message}). Using SQLite fallback (kspdb.sqlite)...`);
    
    const dbPath = path.join(__dirname, '../kspdb.sqlite');
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
    isPg = false;
  }

  dbInitialized = true;
}

async function query(sqlText, params = []) {
  if (!dbInitialized) await initDb();

  if (isPg) {
    const start = Date.now();
    const res = await pgPool.query(sqlText, params);
    const duration = Date.now() - start;
    if (duration > 500) {
      console.warn(`[DB-PG] Slow query (${duration}ms): ${sqlText.slice(0, 80)}`);
    }
    return res;
  }

  // SQLite execution path
  try {
    const trimmed = sqlText.trim().toUpperCase();
    if (trimmed === 'BEGIN' || trimmed === 'BEGIN TRANSACTION') {
      if (!sqliteDb.inTransaction) sqliteDb.exec('BEGIN TRANSACTION');
      return { rows: [], rowCount: 0 };
    }
    if (trimmed === 'COMMIT') {
      if (sqliteDb.inTransaction) sqliteDb.exec('COMMIT');
      return { rows: [], rowCount: 0 };
    }
    if (trimmed === 'ROLLBACK') {
      if (sqliteDb.inTransaction) sqliteDb.exec('ROLLBACK');
      return { rows: [], rowCount: 0 };
    }

    let preparedParams = [...params];
    
    // Handle boolean & array parameters for SQLite compatibility
    preparedParams = preparedParams.map(p => {
      if (typeof p === 'boolean') return p ? 1 : 0;
      if (Array.isArray(p)) return JSON.stringify(p);
      return p;
    });

    const { sql, params: finalParams } = convertSqlForSqlite(sqlText, preparedParams);

    const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(sql);

    if (isSelect) {
      const stmt = sqliteDb.prepare(sql);
      const rows = stmt.all(...finalParams);
      
      // Convert SQLite 1/0 integers back to booleans for compatibility
      const processedRows = rows.map(row => {
        const copy = { ...row };
        for (const k in copy) {
          if (k === 'energized' || k === 'topology_known' || k === 'topology_inferred' || k === 'cancelled') {
            copy[k] = Boolean(copy[k]);
          }
        }
        return copy;
      });

      return { rows: processedRows, rowCount: rows.length };
    } else {
      // Execute INSERT/UPDATE/DELETE
      // Handle multi-row inserts or single statements
      const stmt = sqliteDb.prepare(sql);
      const info = stmt.run(...finalParams);
      
      // If SQL has RETURNING clause, fetch inserted/updated row
      if (/RETURNING/i.test(sql)) {
        // Simple heuristic for returning inserted/updated ticket or event
        if (/INSERT INTO fault_tickets/i.test(sql)) {
          const fetched = sqliteDb.prepare('SELECT * FROM fault_tickets ORDER BY detected_at DESC LIMIT 1').get();
          if (fetched) fetched.topology_inferred = Boolean(fetched.topology_inferred);
          return { rows: fetched ? [fetched] : [], rowCount: 1 };
        }
        if (/UPDATE fault_tickets/i.test(sql)) {
          const match = sqlText.match(/WHERE\s+id\s*=\s*\$(\d+)/i);
          if (match) {
            const idx = parseInt(match[1]) - 1;
            const targetId = params[idx];
            const fetched = sqliteDb.prepare('SELECT * FROM fault_tickets WHERE id = ?').get(targetId);
            if (fetched) fetched.topology_inferred = Boolean(fetched.topology_inferred);
            return { rows: fetched ? [fetched] : [], rowCount: 1 };
          }
        }
        if (/INSERT INTO scheduled_outages/i.test(sql)) {
          const fetched = sqliteDb.prepare('SELECT * FROM scheduled_outages ORDER BY rowid DESC LIMIT 1').get();
          return { rows: fetched ? [fetched] : [], rowCount: 1 };
        }
      }

      return { rows: [], rowCount: info.changes };
    }
  } catch (err) {
    console.error('[DB-SQLite Error]', err.message, 'SQL:', sqlText.slice(0, 100));
    throw err;
  }
}

async function getClient() {
  if (!dbInitialized) await initDb();
  if (isPg) return pgPool.connect();
  // Mock client for transaction support in SQLite
  return {
    query,
    release: () => {},
  };
}

async function withTransaction(fn) {
  if (!dbInitialized) await initDb();
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    // SQLite transaction
    sqliteDb.exec('BEGIN TRANSACTION');
    try {
      const result = await fn({ query });
      sqliteDb.exec('COMMIT');
      return result;
    } catch (err) {
      sqliteDb.exec('ROLLBACK');
      throw err;
    }
  }
}

module.exports = { query, getClient, withTransaction, initDb, isPg: () => isPg };
