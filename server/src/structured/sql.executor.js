const config = require('../config/env');
const { tokenize } = require('./sql.analyzer');

/**
 * SQL EXECUTOR
 * Executes an already-validated SELECT statement through the dataset's
 * adapter, with row limits enforced (never trust the query to self-limit).
 */
async function executeValidatedQuery(adapter, sql, { maxRows = config.query.maxRows, timeoutMs = config.query.timeoutMs } = {}) {
  let queryConnection = null;

  try {
    await adapter.connect();
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
    } else {
      // Postgres / SQLite: standard query promise with timeout
      // NOTE ON SQLITE: better-sqlite3 is synchronous on the main thread and cannot be interrupted by setTimeout.
      // Runaway query protection for SQLite is provided pre-execution by the complexity gate (Domain 2.3).
      const queryPromise = adapter.executeQuery(cappedSql);
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
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
    await adapter.disconnect();
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
