/**
 * CogniCore V4 Verification Oracles
 * -------------------------------------------------------------
 * Oracle 1: readonlyOracle(sql, db)
 *   Determines whether statement.readonly === true via better-sqlite3.
 *   Prepare errors are recorded as prepare_error: true with verbatim message.
 *
 * Oracle 2: mutationOracle(sql, fixtureDbPath)
 *   Executes SQL against an isolated throwaway sandbox copy of the database
 *   using a raw READ-WRITE connection (deliberately bypassing application gates).
 *   Snapshots filesystem files and logical database content before and after
 *   with a 10s child-process timeout to detect any mutations or file writes.
 *
 * Oracle 3: defenseInDepthOracle(sql, fixtureDbPath)
 *   Executes SQL against an isolated sandbox copy using the project's real
 *   executor and adapter chain (executeValidatedQuery + SQLiteAdapter).
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('../node_modules/better-sqlite3');

const SANDBOX_BASE = path.resolve(__dirname, '../sandbox');

/**
 * Oracle 1: Read-only check via driver prepare inspection.
 * @param {string} sql
 * @param {import('better-sqlite3').Database|string} db - Database instance or path
 * @returns {{readonly: boolean|null, prepare_error: boolean, error: string|null}}
 */
function readonlyOracle(sql, db) {
  let shouldClose = false;
  let activeDb = db;

  if (typeof db === 'string') {
    try {
      activeDb = new Database(db, { readonly: true, fileMustExist: true });
      shouldClose = true;
    } catch (err) {
      return { readonly: null, prepare_error: true, error: `Failed to open DB: ${err.message}` };
    }
  }

  try {
    const stmt = activeDb.prepare(sql);
    return { readonly: Boolean(stmt.readonly), prepare_error: false, error: null };
  } catch (err) {
    return { readonly: null, prepare_error: true, error: err.message };
  } finally {
    if (shouldClose && activeDb) {
      activeDb.close();
    }
  }
}

/** Snapshot all files in a directory (relative path, size, sha256). */
function snapshotDir(dirPath) {
  const snapshot = {};
  if (!fs.existsSync(dirPath)) return snapshot;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      try {
        const buf = fs.readFileSync(fullPath);
        snapshot[entry.name] = {
          size: buf.length,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        };
      } catch (_) {}
    }
  }
  return snapshot;
}

/** Compute sha256 hash of logical tables and rows in main database. */
function getLogicalDumpHash(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    let dumpStr = '';
    for (const t of tables) {
      dumpStr += `TABLE:${t.name}:${t.sql}\n`;
      try {
        const rows = db.prepare(`SELECT * FROM "${t.name}"`).all();
        dumpStr += `ROWS:${JSON.stringify(rows)}\n`;
      } catch (_) {}
    }
    return crypto.createHash('sha256').update(dumpStr).digest('hex');
  } catch (_) {
    return null;
  } finally {
    if (db) db.close();
  }
}

/** Diff two directory snapshots and logical dump hashes. */
function diffSnapshots(before, after, dumpBefore, dumpAfter) {
  const diffs = [];
  for (const [name, info] of Object.entries(after)) {
    if (!before[name]) {
      diffs.push({ type: 'file_created', file: name, size: info.size });
    } else if (before[name].sha256 !== info.sha256) {
      diffs.push({
        type: 'file_modified',
        file: name,
        old_size: before[name].size,
        new_size: info.size,
        old_sha256: before[name].sha256,
        new_sha256: info.sha256,
      });
    }
  }
  for (const name of Object.keys(before)) {
    if (!after[name]) {
      diffs.push({ type: 'file_deleted', file: name });
    }
  }
  if (dumpBefore && dumpAfter && dumpBefore !== dumpAfter) {
    diffs.push({ type: 'logical_data_modified', old_dump: dumpBefore, new_dump: dumpAfter });
  }
  return diffs;
}

/** Execute child runner in isolated directory with 10s timeout. */
function runInSandbox(mode, sql, fixtureDbPath, timeoutMs = 10000) {
  if (!fs.existsSync(SANDBOX_BASE)) {
    fs.mkdirSync(SANDBOX_BASE, { recursive: true });
  }

  const runId = `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sandboxDir = path.join(SANDBOX_BASE, runId);
  fs.mkdirSync(sandboxDir, { recursive: true });

  const targetDbName = path.basename(fixtureDbPath);
  const targetDbPath = path.join(sandboxDir, targetDbName);
  fs.copyFileSync(fixtureDbPath, targetDbPath);

  const beforeSnapshot = snapshotDir(sandboxDir);
  const beforeDump = getLogicalDumpHash(targetDbPath);

  const workerScript = path.resolve(__dirname, 'v4_worker.js');
  const sqlBase64 = Buffer.from(sql, 'utf8').toString('base64');

  let childRes;
  let timedOut = false;
  try {
    childRes = spawnSync(process.execPath, [workerScript, mode, targetDbPath, sqlBase64], {
      cwd: sandboxDir,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (childRes.error && childRes.error.code === 'ETIMEDOUT') {
      timedOut = true;
    }
  } catch (err) {
    childRes = { error: err };
  }

  const afterSnapshot = snapshotDir(sandboxDir);
  const afterDump = getLogicalDumpHash(targetDbPath);
  const diffs = diffSnapshots(beforeSnapshot, afterSnapshot, beforeDump, afterDump);

  let outputJson = null;
  if (childRes?.stdout) {
    try {
      outputJson = JSON.parse(childRes.stdout);
    } catch (_) {
      outputJson = { raw: childRes.stdout };
    }
  }

  // Cleanup sandbox directory
  try {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  } catch (_) {}

  return {
    mode,
    mutated: diffs.length > 0,
    diffs,
    timedOut,
    workerSuccess: outputJson ? outputJson.success === true : false,
    workerError: outputJson?.error || childRes?.stderr || (timedOut ? 'Execution timed out' : null),
  };
}

/**
 * Oracle 2: Raw read-write execution mutation oracle.
 * @param {string} sql
 * @param {string} fixtureDbPath
 * @param {number} [timeoutMs=10000]
 */
function mutationOracle(sql, fixtureDbPath, timeoutMs = 10000) {
  return runInSandbox('rw', sql, fixtureDbPath, timeoutMs);
}

/**
 * Oracle 3: Real executor defense-in-depth oracle.
 * @param {string} sql
 * @param {string} fixtureDbPath
 * @param {number} [timeoutMs=10000]
 */
function defenseInDepthOracle(sql, fixtureDbPath, timeoutMs = 10000) {
  return runInSandbox('real', sql, fixtureDbPath, timeoutMs);
}

/**
 * Resource watch oracle: Runs real executor in child process with 15s hard timeout
 * and memory watch tracking peak RSS.
 * @param {string} sql
 * @param {string} fixtureDbPath
 * @param {number} [timeoutMs=15000]
 */
function resourceWatchOracle(sql, fixtureDbPath, timeoutMs = 15000) {
  if (!fs.existsSync(SANDBOX_BASE)) {
    fs.mkdirSync(SANDBOX_BASE, { recursive: true });
  }
  const runId = `sb_res_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sandboxDir = path.join(SANDBOX_BASE, runId);
  fs.mkdirSync(sandboxDir, { recursive: true });

  const targetDbName = path.basename(fixtureDbPath);
  const targetDbPath = path.join(sandboxDir, targetDbName);
  fs.copyFileSync(fixtureDbPath, targetDbPath);

  const workerScript = path.resolve(__dirname, 'v4_worker.js');
  const sqlBase64 = Buffer.from(sql, 'utf8').toString('base64');

  let childRes;
  let timedOut = false;
  const t0 = Date.now();
  try {
    childRes = spawnSync(process.execPath, [workerScript, 'resource_watch', targetDbPath, sqlBase64], {
      cwd: sandboxDir,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (childRes.error && childRes.error.code === 'ETIMEDOUT') {
      timedOut = true;
    }
  } catch (err) {
    childRes = { error: err };
  }
  const elapsedMs = Date.now() - t0;

  let outputJson = null;
  if (childRes?.stdout) {
    try {
      outputJson = JSON.parse(childRes.stdout);
    } catch (_) {
      outputJson = { raw: childRes.stdout };
    }
  }

  try {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  } catch (_) {}

  return {
    timedOut,
    elapsedMs,
    peakRss: outputJson?.peakRss || null,
    workerSuccess: outputJson ? outputJson.success === true : false,
    rowCount: outputJson?.rowCount ?? null,
    truncated: outputJson?.truncated ?? false,
    workerError: outputJson?.error || childRes?.stderr || (timedOut ? '15s hard timeout fired' : null),
  };
}

module.exports = {
  readonlyOracle,
  mutationOracle,
  defenseInDepthOracle,
  resourceWatchOracle,
  snapshotDir,
  getLogicalDumpHash,
  diffSnapshots,
  SANDBOX_BASE,
};
