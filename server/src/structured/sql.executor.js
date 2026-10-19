const config = require('../config/env');
const { tokenize } = require('./sql.analyzer');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

function executeSqliteInWorker(dbPath, sql, params, timeoutMs, onTimeout) {
  return new Promise((resolve, reject) => {
    const workerScript = path.resolve(__dirname, 'sqlite.worker.js');
    let worker;
    let timer = null;
    let finished = false;

    try {
      worker = new Worker(workerScript, {
        workerData: { dbPath, sql, params: params || [] },
      });
    } catch (err) {
      return reject(err);
    }

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    timer = setTimeout(async () => {
      if (finished) return;
      finished = true;
      if (typeof onTimeout === 'function') onTimeout();
      try {
        await worker.terminate();
      } catch (_) {}
      reject(new Error(`Query execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer.unref) timer.unref();

    worker.on('message', (msg) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (msg.success) {
        resolve({ columns: msg.columns, rows: msg.rows });
      } else {
        const err = new Error(msg.error);
        if (msg.code) err.code = msg.code;
        reject(err);
      }
    });

    worker.on('error', (err) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(err);
    });

    worker.on('exit', (code) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (code !== 0) {
        reject(new Error(`SQLite worker stopped with exit code ${code}`));
      }
    });
  });
}

/**
 * SQL EXECUTOR
 * Executes an already-validated SELECT statement through the dataset's
 * adapter, with row limits enforced (never trust the query to self-limit).
 */
async function executeValidatedQuery(adapter, sql, { maxRows = config.query.maxRows, timeoutMs = config.query.timeoutMs } = {}) {
  let queryConnection = null;
  let didConnect = false;
  let timedOut = false;

  const isAlreadyConnected = Boolean(
    (adapter.db && adapter.db.open !== false) ||
    (adapter.pool && !adapter.pool.ended && !adapter.pool._ended) ||
    adapter.isConnected === true
  );

  try {
    if (!isAlreadyConnected && typeof adapter.connect === 'function') {
      await adapter.connect();
      didConnect = true;
    }
    const cappedSql = enforceLimit(sql, maxRows);
    const start = Date.now();
    let result;

    // For MySQL, grab a connection from the pool so we can KILL QUERY on timeout
    if (adapter.pool && typeof adapter.pool.getConnection === 'function' && adapter.database) {
      queryConnection = await adapter.pool.getConnection();
      const threadId = queryConnection.threadId;
      const queryPromise = (async () => {
        const [rows, fields] = await queryConnection.query(cappedSql);
        return {
          columns: fields ? fields.map(f => f.name) : (rows[0] ? Object.keys(rows[0]) : []),
          rows,
        };
      })();

      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(async () => {
          timedOut = true;
          try {
            if (adapter.pool && threadId) {
              const killConn = await adapter.pool.getConnection();
              await killConn.query(`KILL QUERY ${threadId}`);
              killConn.release();
            }
          } catch (_) { /* ignore kill failure */ }
          reject(new Error(`Query execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (timer.unref) timer.unref();
      });

      result = await Promise.race([queryPromise, timeoutPromise]);
    } else if (
      adapter.location &&
      typeof adapter.location === 'string' &&
      (adapter.constructor?.name === 'SQLiteAdapter' ||
        adapter.db ||
        adapter.datasetType === 'sqlite' ||
        adapter.options?.datasetType === 'sqlite')
    ) {
      // SQLite: execute in worker thread and terminate it on timeout (unblocking main event loop)
      result = await executeSqliteInWorker(adapter.location, cappedSql, [], timeoutMs, () => {
        timedOut = true;
      });
    } else {
      // Postgres or in-memory fallback
      const queryPromise = adapter.executeQuery(cappedSql);
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Query execution timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (timer.unref) timer.unref();
      });

      result = await Promise.race([queryPromise, timeoutPromise]);
    }

    const durationMs = Date.now() - start;
    return {
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.rows.length >= maxRows,
      durationMs,
      sqlExecuted: cappedSql,
    };
  } finally {
    if (queryConnection) {
      try { queryConnection.release(); } catch (_) {}
    }
    // Shared adapters are never closed per query (close only per-query connections or on timeout)
    if (didConnect || timedOut) {
      if (typeof adapter.disconnect === 'function') {
        try { await adapter.disconnect(); } catch (_) {}
      }
    }
  }
}

/** Wrap the query so it can never return more than maxRows, regardless of what the LLM wrote. */
function enforceLimit(sql, maxRows) {
  const trimmed = sql.trim().replace(/;\s*$/, '');
  const tokens = tokenize(trimmed);

  // If query starts with a CTE, keep the WITH clause at the outer level
  if (tokens.length && tokens[0].t === 'word' && tokens[0].v.toLowerCase() === 'with') {
    const mainSel = tokens.find(
      (t, i) => i > 0 && t.depth === 0 && t.t === 'word' && t.v.toLowerCase() === 'select'
    );
    if (mainSel) {
      const ctePart = trimmed.slice(0, mainSel.s).trim();
      const mainQuery = trimmed.slice(mainSel.s).trim();
      return `${ctePart} SELECT * FROM (${mainQuery}) AS __cognicore_capped LIMIT ${maxRows}`;
    }
  }

  return `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`;
}

module.exports = { executeValidatedQuery, enforceLimit };
