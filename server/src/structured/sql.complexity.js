/**
 * SQL COST / COMPLEXITY CHECK (blueprint item 6)
 * Runs after syntax/safety validation and before execution. It rejects queries that are
 * technically valid SELECTs but would be expensive or abusive on a real database:
 *   - cartesian products (CROSS JOIN, or comma-joined tables with no join condition)
 *   - too many joins, too deeply nested subqueries, enormous statements
 *   - estimated join fan-out (product of joined table row counts without a key condition)
 * Heuristic by design (no EXPLAIN dependency, works on every dialect) and configurable.
 * Returns an advisory `score` so callers can show "query cost: low/medium/high".
 */
const { tokenize } = require('./sql.analyzer');

const LIMITS = {
  maxLength: parseInt(process.env.SQL_MAX_LENGTH || '4000', 10),
  maxJoins: parseInt(process.env.SQL_MAX_JOINS || '6', 10),
  maxDepth: parseInt(process.env.SQL_MAX_SUBQUERY_DEPTH || '4', 10),
  maxEstimatedRows: parseFloat(process.env.SQL_MAX_ESTIMATED_ROWS || '5e9'),
};

class SQLComplexityError extends Error {
  constructor(message, details = {}) { super(message); this.name = 'SQLComplexityError'; this.details = details; }
}

const lc = (s) => String(s).toLowerCase();

function analyzeComplexity(sql, schema) {
  const tokens = tokenize(sql);
  const words = tokens.filter((t) => t.t === 'word').map((t) => lc(t.v));
  const joinCount = words.filter((w) => w === 'join').length;
  const crossJoin = tokens.some((t, i) => t.t === 'word' && lc(t.v) === 'cross' && lc(tokens[i + 1]?.v || '') === 'join');

  // subquery depth = number of "( select" nestings
  let depth = 0, maxDepth = 0;
  const stack = [];
  tokens.forEach((t, i) => {
    if (t.v === '(' && t.t === 'p') { const isSel = lc(tokens[i + 1]?.v || '') === 'select'; stack.push(isSel); if (isSel) { depth++; maxDepth = Math.max(maxDepth, depth); } }
    if (t.v === ')' && t.t === 'p') { if (stack.pop()) depth--; }
  });

  // 1. Count commas in FROM table list and detect comma-joined tables
  let fromCommaCount = 0;
  let unkeyedCommaJoin = false;
  const CLAUSE_WORDS = new Set(['where', 'group', 'having', 'order', 'limit', 'window', 'union', 'intersect', 'except']);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'word' && lc(t.v) === 'from') {
      const fromDepth = t.depth;
      let j = i + 1;
      const fromClauseTokens = [];
      while (j < tokens.length) {
        const tok = tokens[j];
        if (tok.depth < fromDepth) break;
        if (tok.depth === fromDepth && tok.t === 'word' && CLAUSE_WORDS.has(lc(tok.v))) break;
        fromClauseTokens.push(tok);
        j++;
      }

      const commas = fromClauseTokens.filter(tok => tok.t === 'p' && tok.v === ',' && tok.depth === fromDepth);
      if (commas.length > 0) {
        fromCommaCount += commas.length;

        const segments = [];
        let curr = [];
        for (const ft of fromClauseTokens) {
          if (ft.t === 'p' && ft.v === ',' && ft.depth === fromDepth) {
            segments.push(curr);
            curr = [];
          } else {
            curr.push(ft);
          }
        }
        if (curr.length) segments.push(curr);

        const tableAliases = [];
        for (const seg of segments) {
          const ids = seg.filter(tok => (tok.t === 'word' || tok.t === 'qid') && !['as', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural'].includes(lc(tok.v)));
          if (ids.length > 0) {
            const lastId = lc(ids[ids.length - 1].v);
            const firstId = lc(ids[0].v);
            tableAliases.push({ name: firstId, alias: lastId });
          }
        }

        let whereTokens = [];
        if (j < tokens.length && tokens[j].t === 'word' && lc(tokens[j].v) === 'where') {
          let k = j + 1;
          while (k < tokens.length) {
            const wTok = tokens[k];
            if (wTok.depth < fromDepth) break;
            if (wTok.depth === fromDepth && wTok.t === 'word' && ['group', 'having', 'order', 'limit', 'window', 'union', 'intersect', 'except'].includes(lc(wTok.v))) break;
            whereTokens.push(wTok);
            k++;
          }
        }

        if (tableAliases.length > 1) {
          if (whereTokens.length === 0) {
            unkeyedCommaJoin = true;
          } else {
            const whereWords = new Set(whereTokens.filter(wt => wt.t === 'word' || wt.t === 'qid').map(wt => lc(wt.v)));
            for (const ta of tableAliases) {
              const referenced = whereWords.has(ta.alias) || whereWords.has(ta.name);
              if (!referenced) {
                unkeyedCommaJoin = true;
                break;
              }
            }
          }
        }
      }
    }
  }

  // 2. Detect constant-true / no-column-reference ON clauses
  let hasConstantOrNoColOn = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === 'word' && lc(t.v) === 'on') {
      const onDepth = t.depth;
      let j = i + 1;
      const onTokens = [];
      while (j < tokens.length) {
        const tok = tokens[j];
        if (tok.depth < onDepth) break;
        if (tok.depth === onDepth && tok.t === 'word' && (CLAUSE_WORDS.has(lc(tok.v)) || lc(tok.v) === 'join')) break;
        onTokens.push(tok);
        j++;
      }

      if (onTokens.length === 0) {
        hasConstantOrNoColOn = true;
      } else {
        const nonColWords = new Set([
          'and', 'or', 'not', 'is', 'null', 'true', 'false', 'case', 'when', 'then', 'else', 'end',
          'between', 'in', 'like', 'glob', 'match', 'regexp'
        ]);
        const idTokens = onTokens.filter(tok => (tok.t === 'word' && !nonColWords.has(lc(tok.v))) || tok.t === 'qid');
        if (idTokens.length === 0) {
          hasConstantOrNoColOn = true;
        } else {
          const onRaw = onTokens.map(tok => tok.v).join('').replace(/\s+/g, '').toLowerCase();
          if (/^(?:1=1|0=0|true=true|1|true)$/i.test(onRaw)) {
            hasConstantOrNoColOn = true;
          }
        }
      }
    }
  }

  // 3. Detect NATURAL JOIN without common columns
  let naturalJoinWithoutCommon = false;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].t === 'word' && lc(tokens[i].v) === 'natural' && lc(tokens[i + 1]?.v || '') === 'join') {
      const leftTok = tokens[i - 1];
      const rightTok = tokens[i + 2];
      if (schema?.tables && leftTok && rightTok) {
        const t1 = schema.tables.find(tbl => lc(tbl.name) === lc(leftTok.v));
        const t2 = schema.tables.find(tbl => lc(tbl.name) === lc(rightTok.v));
        if (t1 && t2 && t1.columns && t2.columns) {
          const common = t1.columns.filter(c1 => t2.columns.some(c2 => lc(c2.name) === lc(c1.name)));
          if (common.length === 0) {
            naturalJoinWithoutCommon = true;
            break;
          }
        }
      }
    }
  }

  const commaJoin = fromCommaCount > 0;
  const rawUnkeyedJoin = Boolean(crossJoin || hasConstantOrNoColOn || naturalJoinWithoutCommon || unkeyedCommaJoin);
  const totalJoins = joinCount + fromCommaCount;
  const totalTables = totalJoins > 0 ? totalJoins + 1 : 1;

  // Unkeyed cartesian join is dangerous if there is no small explicit LIMIT,
  // or if the query computes an unbounded aggregate over the cartesian product (e.g. SELECT count(*))
  const hasBoundedLimit = tokens.some((t, idx) => {
    if (t.t === 'word' && lc(t.v) === 'limit') {
      const next = tokens[idx + 1];
      if (next && next.t === 'num' && Number(next.v) <= 1000) return true;
    }
    return false;
  });
  const isAggCount = /count\s*\(/i.test(sql);
  const unkeyedJoin = rawUnkeyedJoin && (!hasBoundedLimit || isAggCount);

  // estimated fan-out: multiply row counts of referenced tables when they are joined without keys
  const rowCounts = new Map((schema?.tables || []).map((t) => [lc(t.name), Math.max(1, t.rowCount || 1)]));
  const referenced = tokens.filter((t, i) => (t.t === 'word' || t.t === 'qid') && rowCounts.has(lc(t.v)) && i > 0 && (['from', 'join'].includes(lc(tokens[i - 1].v)) || (tokens[i - 1].v === ',' && tokens[i - 1].t === 'p'))).map((t) => lc(t.v));
  const estimatedRows = unkeyedJoin ? referenced.reduce((p, n) => p * rowCounts.get(n), 1) : Math.max(...referenced.map((n) => rowCounts.get(n)), 1);

  const reasons = [];
  if (sql.length > LIMITS.maxLength) reasons.push(`the statement is ${sql.length} characters long (limit ${LIMITS.maxLength})`);
  if (totalJoins >= LIMITS.maxJoins || totalTables > LIMITS.maxJoins) reasons.push(`it joins ${totalTables} tables (limit ${LIMITS.maxJoins})`);
  if (maxDepth > LIMITS.maxDepth) reasons.push(`subqueries are nested ${maxDepth} levels deep (limit ${LIMITS.maxDepth})`);
  if (unkeyedJoin) reasons.push('it combines tables without a join condition (a cartesian product)');
  if (estimatedRows > LIMITS.maxEstimatedRows) reasons.push(`it could produce about ${estimatedRows.toExponential(1)} intermediate rows`);

  const score = Math.min(1, totalJoins / 6 + maxDepth / 6 + (unkeyedJoin ? 0.6 : 0) + Math.min(0.4, sql.length / 10000));
  return { ok: reasons.length === 0, reasons, level: score < 0.34 ? 'low' : score < 0.67 ? 'medium' : 'high', score: +score.toFixed(2), joinCount: totalJoins, maxDepth, estimatedRows };
}

function assertWithinComplexity(sql, schema) {
  const r = analyzeComplexity(sql, schema);
  if (!r.ok) throw new SQLComplexityError(`Query is too expensive to run safely: ${r.reasons.join('; ')}. Please simplify it.`, r);
  return r;
}

module.exports = { analyzeComplexity, assertWithinComplexity, SQLComplexityError, LIMITS };
