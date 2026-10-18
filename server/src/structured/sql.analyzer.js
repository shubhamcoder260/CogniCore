/**
 * SQL ANALYZER
 * A small, dependency-free SQL tokenizer plus three deterministic checks used by
 * the query-validation / error-recovery layers (Features 17 & 18):
 *   - findUnknownColumns  : identifiers that are not a column/alias/table
 *   - repairColumnNames   : fuzzy-fix misspelled columns ("salaryy" -> "salary")
 *   - repairMissingGroupBy: add the GROUP BY an aggregate query forgot
 * It never widens what a query can do - security validation still happens in
 * sql.validator.js; these only reduce false failures and improve error messages.
 */
const { closestMatch } = require('../utils/strings');

const KEYWORDS = new Set(`select from where group by order having limit offset join inner left right full outer cross on using as and or not in is null like glob between exists case when then else end distinct all union intersect except asc desc with recursive over partition rows range unbounded preceding following current row true false cast collate nocase escape filter nulls first last interval date time timestamp integer int real float double text numeric decimal varchar char boolean signed unsigned natural lateral current_date current_time current_timestamp year month day hour minute second bigint smallint precision values if any some window within ties others no groups fetch next only`.split(/\s+/));

const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max', 'total', 'group_concat', 'string_agg', 'stddev', 'variance', 'median']);

function tokenize(sql) {
  const tokens = [];
  let i = 0, depth = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (/\s/.test(ch)) { i++; continue; }
    const start = i;
    if (ch === "'") {
      i++;
      let v = '';
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") { v += "'"; i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        v += sql[i++];
      }
      tokens.push({ t: 'str', v, s: start, e: i, depth });
    } else if (ch === '"' || ch === '`') {
      i++;
      let v = '';
      while (i < n && sql[i] !== ch) v += sql[i++];
      i++;
      tokens.push({ t: 'qid', v, s: start, e: i, depth });
    } else if (/[0-9]/.test(ch)) {
      while (i < n && /[0-9.]/.test(sql[i])) i++;
      tokens.push({ t: 'num', v: sql.slice(start, i), s: start, e: i, depth });
    } else if (/[A-Za-z_]/.test(ch)) {
      while (i < n && /[A-Za-z0-9_$]/.test(sql[i])) i++;
      tokens.push({ t: 'word', v: sql.slice(start, i), s: start, e: i, depth });
    } else {
      const two = sql.slice(i, i + 2);
      if (['<=', '>=', '<>', '!=', '||', '::'].includes(two)) { i += 2; tokens.push({ t: 'p', v: two, s: start, e: i, depth }); continue; }
      i++;
      if (ch === '(') { tokens.push({ t: 'p', v: ch, s: start, e: i, depth }); depth++; continue; }
      if (ch === ')') { depth = Math.max(0, depth - 1); tokens.push({ t: 'p', v: ch, s: start, e: i, depth }); continue; }
      tokens.push({ t: 'p', v: ch, s: start, e: i, depth });
    }
  }
  return tokens;
}

function stripLiterals(sql) {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let out = '';
  const n = sql.length;

  for (let i = 0; i < n; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble && !inBacktick) {
      if (inSingle && sql[i + 1] === "'") { i++; out += '  '; continue; }
      inSingle = !inSingle;
      out += ' ';
      continue;
    }
    if (ch === '"' && !inSingle && !inBacktick) {
      if (inDouble && sql[i + 1] === '"') { i++; out += '  '; continue; }
      inDouble = !inDouble;
      out += ' ';
      continue;
    }
    if (ch === '`' && !inSingle && !inDouble) {
      if (inBacktick && sql[i + 1] === '`') { i++; out += '  '; continue; }
      inBacktick = !inBacktick;
      out += ' ';
      continue;
    }
    out += (inSingle || inDouble || inBacktick) ? ' ' : ch;
  }
  return out;
}

const lc = (s) => String(s).toLowerCase();
const isIdentTok = (t) => t && (t.t === 'word' || t.t === 'qid');
const isKw = (t, kw) => t && t.t === 'word' && lc(t.v) === kw;

function buildScope(tokens, schema) {
  const tableByName = new Map(schema.tables.map((t) => [lc(t.name), t]));
  const aliasMap = new Map();      // alias/table name -> table
  const usedTables = new Set();
  const consumed = new Set();      // token indexes that are table refs/aliases
  const names = new Set();         // aliases + CTE names tolerated as bare identifiers
  let hasTableValuedFunction = false;

  // NOTE: CTE column projection is currently not tracked across CTE boundaries;
  // columns of tables referenced inside a CTE populate bareColumns. For read-only
  // validation, this under-blocking behavior is fully acceptable (the DB engine
  // rejects unexposed columns), ensuring zero false-positive rejections.
  let inSelectList = false;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];

    if (isKw(tk, 'select')) inSelectList = true;
    else if (isKw(tk, 'from') || isKw(tk, 'where') || isKw(tk, 'group') || isKw(tk, 'order')) inSelectList = false;

    // Explicit alias: AS alias
    if (isKw(tk, 'as')) {
      const before = tokens[i - 1], after = tokens[i + 1];
      if (isIdentTok(after)) names.add(lc(after.v));
      if (isIdentTok(before)) names.add(lc(before.v)); // CTE name: "WITH x AS ("
    }

    // Concern 2: Implicit column alias in SELECT list: "SELECT col alias FROM t"
    if (inSelectList && tk.depth === 0) {
      const isColumnIdent = isIdentTok(tk) && !KEYWORDS.has(lc(tk.v));
      const isExprEnd = isColumnIdent || tk.v === ')';
      const next = tokens[i + 1];
      if (isExprEnd && next && isIdentTok(next) && !KEYWORDS.has(lc(next.v)) && next.v !== ',' && next.v !== '.') {
        names.add(lc(next.v));
        consumed.add(i + 1);
      }
    }

    // Table references in FROM / JOIN
    if (isKw(tk, 'from') || isKw(tk, 'join') || (tk.v === ',' && tk.t === 'p' && inFromChain(tokens, i))) {
      let j = i + 1;
      const tname = tokens[j];

      // Derived table subquery in FROM / JOIN: (SELECT ...) [AS] sub
      if (tname?.v === '(' && tname?.t === 'p') {
        const subOpenDepth = tname.depth;
        let subCloseIdx = -1;
        for (let m = j + 1; m < tokens.length; m++) {
          if (tokens[m].v === ')' && tokens[m].depth === subOpenDepth) {
            subCloseIdx = m;
            break;
          }
        }
        if (subCloseIdx > 0) {
          let k = subCloseIdx + 1;
          if (isKw(tokens[k], 'as')) k++;
          const al = tokens[k];
          if (isIdentTok(al) && !(al.t === 'word' && KEYWORDS.has(lc(al.v)))) {
            const subTokens = tokens.slice(j + 1, subCloseIdx);
            const subCols = extractProjectedColumns(subTokens, tableByName);
            const virtualTable = { name: al.v, columns: subCols };
            aliasMap.set(lc(al.v), virtualTable);
            names.add(lc(al.v));
            consumed.add(k);
          }
        }
      }

      // Concern 3: Detect table-valued function call in FROM/JOIN position: FROM generate_series(1, 10)
      if (isIdentTok(tname) && tokens[j + 1]?.v === '(' && !tableByName.has(lc(tname.v))) {
        hasTableValuedFunction = true;
      }

      if (isIdentTok(tname) && tableByName.has(lc(tname.v)) && tokens[j + 1]?.v !== '(') {
        const table = tableByName.get(lc(tname.v));
        usedTables.add(table.name);
        aliasMap.set(lc(table.name), table);
        consumed.add(j);
        let k = j + 1;
        if (isKw(tokens[k], 'as')) { k++; }
        const al = tokens[k];
        if (isIdentTok(al) && !(al.t === 'word' && KEYWORDS.has(lc(al.v)))) {
          aliasMap.set(lc(al.v), table);
          consumed.add(k);
        }
      }
    }
  }
  return { tableByName, aliasMap, usedTables, consumed, names, hasTableValuedFunction };
}

/** true when the comma at index i separates FROM-clause tables (not select-list items) */
function inFromChain(tokens, i) {
  const d = tokens[i].depth;
  for (let j = i - 1; j >= 0; j--) {
    const t = tokens[j];
    if (t.depth < d) return false;
    if (t.depth > d) continue;
    if (isKw(t, 'from') || isKw(t, 'join')) return true;
    if (isKw(t, 'select') || isKw(t, 'where') || isKw(t, 'group') || isKw(t, 'order') || isKw(t, 'on') || isKw(t, 'having')) return false;
  }
  return false;
}

function findUnknownColumns(sql, schema) {
  const tokens = tokenize(sql);
  const scope = buildScope(tokens, schema);

  // Concern 3: If query uses table-valued functions, conservatively fail open
  if (scope.hasTableValuedFunction) {
    return [];
  }

  const scopeTables = scope.usedTables.size ? [...scope.usedTables].map((n) => scope.tableByName.get(lc(n))) : schema.tables;
  const bareColumns = new Set();
  scopeTables.forEach((t) => t.columns.forEach((c) => bareColumns.add(lc(c.name))));

  const unknown = [];
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (!isIdentTok(tk) || scope.consumed.has(i)) continue;
    if (tk.t === 'word' && KEYWORDS.has(lc(tk.v))) continue;
    const next = tokens[i + 1], prev = tokens[i - 1];
    if (next && next.v === '(' && tk.t === 'word') continue;                    // function call
    if (next && next.v === '.' && next.t === 'p') continue;                     // qualifier
    if (isKw(prev, 'as')) continue;                                              // alias / cast type
    if (prev && prev.v === '::' && prev.t === 'p') continue;                     // PG cast type
    const nm = lc(tk.v);

    if (prev && prev.v === '.' && prev.t === 'p') {
      const q = tokens[i - 2];
      const table = q && scope.aliasMap.get(lc(q.v));
      if (table && !table.columns.some((c) => lc(c.name) === nm)) unknown.push({ name: tk.v, qualifier: q.v, index: i, start: tk.s, end: tk.e });
      continue;
    }
    if (tk.t === 'qid' && next && (next.v === ')' || next.v === ',') && isStringContext(tokens, i)) continue;
    if (bareColumns.has(nm) || scope.names.has(nm) || scope.aliasMap.has(nm) || scope.tableByName.has(nm)) continue;
    unknown.push({ name: tk.v, qualifier: null, index: i, start: tk.s, end: tk.e });
  }
  return unknown;
}

// SQLite lets "double quoted" text act as a string literal; treat it as unknown only if it looks like a column.
function isStringContext(tokens, i) {
  const prev = tokens[i - 1];
  return prev && ['=', 'in', '(', ','].includes(lc(prev.v)) && tokens[i].t === 'qid' && /\s/.test(tokens[i].v);
}

function repairColumnNames(sql, schema) {
  const unknown = findUnknownColumns(sql, schema);
  if (!unknown.length) return { sql, repaired: false, corrections: [], unresolved: [] };
  const tokens = tokenize(sql);
  const scope = buildScope(tokens, schema);
  const pool = (scope.usedTables.size ? [...scope.usedTables] : schema.tables.map((t) => t.name))
    .flatMap((n) => scope.tableByName.get(lc(n)).columns.map((c) => c.name));

  const corrections = [];
  const unresolved = [];
  let out = sql;
  for (const u of [...unknown].sort((a, b) => b.start - a.start)) {
    let candidates = pool;
    if (u.qualifier) {
      const table = scope.aliasMap.get(lc(u.qualifier));
      if (table) candidates = table.columns.map((c) => c.name);
    }
    const fix = closestMatch(u.name, candidates);
    if (fix) {
      const original = out.slice(u.start, u.end);
      const quoted = original.startsWith('"') || original.startsWith('`') ? original[0] + fix + original[0] : fix;
      out = out.slice(0, u.start) + quoted + out.slice(u.end);
      corrections.push({ from: u.name, to: fix });
    } else {
      unresolved.push({ name: u.name, suggestions: candidates.slice(0, 8) });
    }
  }
  return { sql: out, repaired: corrections.length > 0, corrections: corrections.reverse(), unresolved };
}

/** Adds GROUP BY for aggregate queries that mix aggregates with bare columns (SQLite silently returns wrong rows). */
function repairMissingGroupBy(sql) {
  const tokens = tokenize(sql);
  const top = tokens.filter((t) => t.depth === 0);
  if (top.some((t) => isKw(t, 'group') || isKw(t, 'union') || isKw(t, 'intersect') || isKw(t, 'except'))) return { sql, repaired: false };
  const selIdx = tokens.findIndex((t) => isKw(t, 'select') && t.depth === 0);
  const fromIdx = tokens.findIndex((t) => isKw(t, 'from') && t.depth === 0);
  if (selIdx !== 0 || fromIdx < 0) return { sql, repaired: false };

  // split select list on top-level commas
  const items = [];
  let cur = [];
  for (let i = selIdx + 1; i < fromIdx; i++) {
    const t = tokens[i];
    if (t.depth === 0 && t.v === ',' && t.t === 'p') { items.push(cur); cur = []; } else cur.push(t);
  }
  items.push(cur);

  let hasAgg = false, hasOver = false;
  const plain = [];
  let nonAggComplex = false;
  for (const item of items) {
    if (!item.length) continue;
    const isAgg = item.some((t, k) => t.t === 'word' && AGGREGATES.has(lc(t.v)) && item[k + 1]?.v === '(');
    if (item.some((t) => isKw(t, 'over'))) hasOver = true;
    if (isAgg) { hasAgg = true; continue; }
    // strip alias
    const asIdx = item.findIndex((t) => isKw(t, 'as'));
    const expr = asIdx >= 0 ? item.slice(0, asIdx) : item;
    if (expr.length === 1 && expr[0].v === '*') { nonAggComplex = true; continue; }
    const simple = expr.length === 1 && isIdentTok(expr[0]) || (expr.length === 3 && isIdentTok(expr[0]) && expr[1].v === '.' && isIdentTok(expr[2]));
    if (simple) plain.push(sql.slice(expr[0].s, expr[expr.length - 1].e));
    else nonAggComplex = true;
  }
  if (!hasAgg || hasOver || nonAggComplex || plain.length === 0) return { sql, repaired: false };

  const tail = tokens.find((t, i) => i > fromIdx && t.depth === 0 && (isKw(t, 'having') || isKw(t, 'order') || isKw(t, 'limit') || isKw(t, 'window')));
  const insertAt = tail ? tail.s : sql.length;
  const groupBy = ` GROUP BY ${plain.join(', ')} `;
  const out = (sql.slice(0, insertAt).trimEnd() + groupBy + sql.slice(insertAt).trimStart()).trim();
  return { sql: out, repaired: true, groupBy: plain };
}

/** Names defined by a leading WITH [RECURSIVE] a AS (...), b AS (...) clause. */
function extractCteNames(sql) {
  const tokens = tokenize(sql);
  const names = [];
  if (!isKw(tokens[0], 'with')) return names;
  let i = 1;
  if (isKw(tokens[i], 'recursive')) i++;
  for (;;) {
    const nameTok = tokens[i];
    if (!isIdentTok(nameTok)) break;
    names.push(nameTok.v);
    i++;
    if (tokens[i]?.v === '(') { // optional column list
      let d = tokens[i].depth;
      i++;
      while (i < tokens.length && !(tokens[i].v === ')' && tokens[i].depth === d)) i++;
      i++;
    }
    if (!isKw(tokens[i], 'as')) break;
    i++;
    if (isKw(tokens[i], 'not')) i++;
    if (isKw(tokens[i], 'materialized')) i++;
    if (tokens[i]?.v !== '(') break;
    const d = tokens[i].depth;
    i++;
    while (i < tokens.length && !(tokens[i].v === ')' && tokens[i].depth === d)) i++;
    i++;
    if (tokens[i]?.v === ',') { i++; continue; }
    break;
  }
  return names;
}

/** Helper: extracts projected column definitions from a SELECT list token slice */
function extractProjectedColumns(bodyTokens, tableByName = new Map()) {
  if (!bodyTokens.length) return [];
  const bodyDepth = bodyTokens[0].depth;
  let selectIdx = -1;
  for (let k = 0; k < bodyTokens.length; k++) {
    if (bodyTokens[k].depth === bodyDepth && isKw(bodyTokens[k], 'select')) {
      selectIdx = k;
      break;
    }
  }
  if (selectIdx < 0) return [];

  let fromIdx = bodyTokens.length;
  for (let k = selectIdx + 1; k < bodyTokens.length; k++) {
    if (bodyTokens[k].depth === bodyDepth && (isKw(bodyTokens[k], 'from') || isKw(bodyTokens[k], 'where') || isKw(bodyTokens[k], 'group') || isKw(bodyTokens[k], 'order'))) {
      fromIdx = k;
      break;
    }
  }

  let fromTable = null;
  let fromTableAlias = null;
  for (let k = fromIdx; k < bodyTokens.length; k++) {
    if (bodyTokens[k].depth === bodyDepth && isKw(bodyTokens[k], 'from')) {
      const tnameTok = bodyTokens[k + 1];
      if (isIdentTok(tnameTok) && !KEYWORDS.has(lc(tnameTok.v))) {
        fromTable = tnameTok.v;
        const maybeAs = bodyTokens[k + 2];
        let alTok = null;
        if (isKw(maybeAs, 'as')) alTok = bodyTokens[k + 3];
        else if (isIdentTok(maybeAs) && !KEYWORDS.has(lc(maybeAs.v)) && maybeAs.v !== ',') alTok = maybeAs;
        if (alTok && isIdentTok(alTok)) fromTableAlias = alTok.v;
      }
      break;
    }
  }

  const items = [];
  let cur = [];
  for (let k = selectIdx + 1; k < fromIdx; k++) {
    const tk = bodyTokens[k];
    if (tk.depth === bodyDepth && tk.v === ',' && tk.t === 'p') {
      if (cur.length) items.push(cur);
      cur = [];
    } else {
      cur.push(tk);
    }
  }
  if (cur.length) items.push(cur);

  const cols = [];
  for (const item of items) {
    if (!item.length) continue;
    if (item.length === 1 && item[0].v === '*' && item[0].t === 'p') {
      const tbl = fromTable ? tableByName.get(lc(fromTable)) : null;
      if (tbl && tbl.columns) {
        for (const c of tbl.columns) {
          cols.push({ name: c.name, sourceTable: tbl.name, sourceColumn: c.name });
        }
      } else {
        cols.push({ name: '*', sourceTable: fromTable, sourceColumn: '*' });
      }
      continue;
    }
    if (item.length === 3 && isIdentTok(item[0]) && item[1].v === '.' && item[2].v === '*') {
      const tbl = tableByName.get(lc(item[0].v));
      if (tbl && tbl.columns) {
        for (const c of tbl.columns) {
          cols.push({ name: c.name, sourceTable: tbl.name, sourceColumn: c.name });
        }
      } else {
        cols.push({ name: '*', sourceTable: item[0].v, sourceColumn: '*' });
      }
      continue;
    }

    let aliasName = null;
    let exprTokens = item;
    const asIdx = item.findIndex((t) => isKw(t, 'as') && t.depth === bodyDepth);
    if (asIdx >= 0 && item[asIdx + 1] && isIdentTok(item[asIdx + 1])) {
      aliasName = item[asIdx + 1].v;
      exprTokens = item.slice(0, asIdx);
    } else if (item.length >= 2) {
      const last = item[item.length - 1];
      const prev = item[item.length - 2];
      if (isIdentTok(last) && !KEYWORDS.has(lc(last.v)) && last.depth === bodyDepth && prev.v !== '.') {
        aliasName = last.v;
        exprTokens = item.slice(0, -1);
      }
    }

    let srcTable = fromTable;
    let srcCol = null;

    if (exprTokens.length === 1 && isIdentTok(exprTokens[0])) {
      srcCol = exprTokens[0].v;
    } else if (exprTokens.length === 3 && isIdentTok(exprTokens[0]) && exprTokens[1].v === '.' && isIdentTok(exprTokens[2])) {
      srcTable = exprTokens[0].v;
      srcCol = exprTokens[2].v;
    } else {
      for (let m = 0; m < exprTokens.length; m++) {
        const t = exprTokens[m];
        if (!isIdentTok(t) || KEYWORDS.has(lc(t.v))) continue;
        const p = exprTokens[m - 1];
        const nxt = exprTokens[m + 1];
        if (nxt && nxt.v === '(') continue;
        if (p && p.v === '.') {
          srcTable = exprTokens[m - 2]?.v || fromTable;
          srcCol = t.v;
        } else if (!p || p.v !== '.') {
          srcCol = t.v;
        }
      }
    }

    const colName = aliasName || srcCol;
    if (colName) {
      cols.push({
        name: colName,
        sourceTable: srcTable === fromTableAlias ? fromTable : srcTable,
        sourceColumn: srcCol || colName,
      });
    }
  }
  return cols;
}

/**
 * Extracts CTE definitions from a leading WITH clause.
 * Returns array of { name, bodySql, bodyTokens, exposedColumns, columnLineage, start, end }
 */
function extractCteBodies(sql) {
  const tokens = tokenize(sql);
  const ctes = [];
  if (!isKw(tokens[0], 'with')) return ctes;

  let i = 1;
  if (isKw(tokens[i], 'recursive')) i++;

  for (;;) {
    const nameTok = tokens[i];
    if (!isIdentTok(nameTok)) break;
    const name = nameTok.v;
    i++;

    const explicitCols = [];
    if (tokens[i]?.v === '(') {
      const d = tokens[i].depth;
      i++;
      while (i < tokens.length && !(tokens[i].v === ')' && tokens[i].depth === d)) {
        if (isIdentTok(tokens[i]) && !KEYWORDS.has(lc(tokens[i].v))) {
          explicitCols.push(tokens[i].v);
        }
        i++;
      }
      if (tokens[i]?.v === ')') i++;
    }

    if (!isKw(tokens[i], 'as')) break;
    i++;
    if (isKw(tokens[i], 'not')) i++;
    if (isKw(tokens[i], 'materialized')) i++;
    if (tokens[i]?.v !== '(') break;

    const openParen = tokens[i];
    const d = openParen.depth;
    i++;
    const bodyStartIdx = i;

    while (i < tokens.length && !(tokens[i].v === ')' && tokens[i].depth === d)) {
      i++;
    }
    const closeParen = tokens[i];
    const bodyTokens = tokens.slice(bodyStartIdx, i);
    const bodySql = closeParen ? sql.slice(openParen.e, closeParen.s) : sql.slice(openParen.e);

    const projected = extractProjectedColumns(bodyTokens);
    const exposedColumns = new Set();
    const columnLineage = new Map();

    if (explicitCols.length > 0) {
      for (let idx = 0; idx < explicitCols.length; idx++) {
        const exp = explicitCols[idx];
        exposedColumns.add(lc(exp));
        const src = projected[idx] || { sourceTable: null, sourceColumn: exp };
        columnLineage.set(lc(exp), { table: src.sourceTable, column: src.sourceColumn });
      }
    } else {
      for (const p of projected) {
        exposedColumns.add(lc(p.name));
        columnLineage.set(lc(p.name), { table: p.sourceTable, column: p.sourceColumn });
      }
    }

    ctes.push({
      name,
      bodySql,
      bodyTokens,
      exposedColumns,
      columnLineage,
      start: openParen.s,
      end: closeParen ? closeParen.e : tokens[tokens.length - 1].e,
    });

    i++;
    if (tokens[i]?.v === ',') { i++; continue; }
    break;
  }

  return ctes;
}

module.exports = {
  tokenize,
  stripLiterals,
  buildScope,
  findUnknownColumns,
  repairColumnNames,
  repairMissingGroupBy,
  extractCteNames,
  extractCteBodies,
  extractProjectedColumns,
  KEYWORDS,
};
