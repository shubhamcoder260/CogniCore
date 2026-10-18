const config = require('../config/env');
const { tokenize } = require('./sql.analyzer');

/**
 * SQL EXECUTOR
 * Executes an already-validated SELECT statement through the dataset's
 * adapter, with row limits enforced (never trust the query to self-limit).
 */
async function executeValidatedQuery(adapter, sql, { maxRows = config.query.maxRows } = {}) {
  await adapter.connect();
  try {
    // Enforce a hard row cap by wrapping in a limited outer query.
    const cappedSql = enforceLimit(sql, maxRows);
    const start = Date.now();
    const result = await adapter.executeQuery(cappedSql);
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
