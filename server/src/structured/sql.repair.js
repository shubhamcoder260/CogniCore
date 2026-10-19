/**
 * SQL REPAIR
 * ------------------------------------------------------------------
 * Small local LLMs frequently write a plausible-but-wrong table name
 * (most commonly: guessing a plural like "employees" when the real,
 * schema-given table is singular "employee") even when the exact name
 * was right there in the prompt. Rather than fail the whole query on
 * this extremely common and low-risk mistake, we deterministically
 * check whether the guessed identifier is a case/plural variant of a
 * REAL table in the REAL schema, and substitute it if so.
 *
 * This is not a second LLM call and not a guess of our own - it only
 * ever substitutes toward a table name that provably exists in the
 * dataset's actual schema. The repaired SQL still goes through the full
 * validateSql() pipeline afterward, so this cannot weaken security; it
 * only reduces false-positive rejections of otherwise-correct queries.
 * ------------------------------------------------------------------
 */
const { tokenize, extractCteNames } = require('./sql.analyzer');
const { quoteIdent, dialectOf } = require('../utils/sqlident');
const { closestMatch } = require('../utils/strings');

function singularize(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function pluralize(word) {
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  if (word.endsWith('s')) return word;
  return word + 's';
}

function isTableRefPosToken(tokens, idx, inFromClause) {
  if (idx < 0) return false;
  const prev = tokens[idx - 1];
  if (!prev) return false;
  if (prev.t === 'word' && ['from', 'join'].includes(prev.v.toLowerCase())) return true;
  if (prev.v === ',' && inFromClause) return true;
  if (prev.v === '.' && idx >= 2) return isTableRefPosToken(tokens, idx - 2, inFromClause);
  return false;
}

const CLAUSE_KEYWORDS = new Set([
  'where', 'group', 'having', 'order', 'limit', 'union', 'intersect', 'except',
  'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'natural', 'on', 'using',
  'window', 'offset', 'fetch',
]);

/**
 * @param {string} sql
 * @param {{tables: {name: string, columns?: {name: string}[]}[]}} schema
 * @param {string} [datasetType='sqlite']
 * @returns {{sql: string, repaired: boolean, corrections: {from: string, to: string, offset: number}[]}}
 */
function repairTableNames(sql, schema, datasetType = 'sqlite') {
  const dialect = dialectOf(datasetType);
  const realNames = schema.tables.map((t) => t.name);
  const realByLower = new Map(realNames.map((n) => [n.toLowerCase(), n]));
  const tokens = tokenize(sql);
  const edits = [];
  const corrections = [];

  // Gap 1: Known names include real table names AND CTE names defined in query
  const cteNames = extractCteNames(sql);
  const knownNames = new Set([
    ...realNames.map((n) => n.toLowerCase()),
    ...cteNames.map((n) => n.toLowerCase()),
  ]);

  // Gap 3: Collect explicit (AS x) AND implicit (FROM t x) table aliases
  const definedAliases = new Set();
  let inFromClause = false;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'word') {
      const w = tk.v.toLowerCase();
      if (w === 'from') inFromClause = true;
      else if (CLAUSE_KEYWORDS.has(w)) inFromClause = false;
    }

    // Explicit alias: AS alias
    if (tk.t === 'word' && tk.v.toLowerCase() === 'as') {
      const next = tokens[i + 1];
      if (next && (next.t === 'word' || next.t === 'qid')) {
        definedAliases.add(next.v.toLowerCase());
      }
    }

    // Implicit alias: FROM table alias / JOIN table alias (no AS)
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    const isTableRefPos =
      (prev && prev.t === 'word' && ['from', 'join'].includes(prev.v.toLowerCase())) ||
      (prev && prev.v === ',' && inFromClause) ||
      (prev && prev.v === '.' && prev2 && isTableRefPosToken(tokens, i - 2, inFromClause));

    if (isTableRefPos && (tk.t === 'word' || tk.t === 'qid')) {
      const next = tokens[i + 1];
      if (next && (next.t === 'word' || next.t === 'qid')) {
        const nextWord = next.v.toLowerCase();
        if (nextWord !== 'as' && !CLAUSE_KEYWORDS.has(nextWord)) {
          definedAliases.add(nextWord);
        }
      }
    }
  }

  // Pass 1: Find direct table references and collect repairs
  const directRepairs = new Map(); // candidate.toLowerCase() -> found
  inFromClause = false;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    const next = tokens[i + 1];
    const next2 = tokens[i + 2];

    if (tk.t === 'word') {
      const w = tk.v.toLowerCase();
      if (w === 'from') inFromClause = true;
      else if (CLAUSE_KEYWORDS.has(w)) inFromClause = false;
    }

    if (tk.t !== 'word' && tk.t !== 'qid') continue;

    const isDirectTableRef =
      (prev && prev.t === 'word' && ['from', 'join'].includes(prev.v.toLowerCase())) ||
      (prev && prev.v === ',' && inFromClause) ||
      (prev && prev.v === '.' && prev2 && isTableRefPosToken(tokens, i - 2, inFromClause));

    if (!isDirectTableRef) continue;

    // In 'FROM schema.table', the token before the dot is the schema name, NOT the table name.
    // Schema names must NEVER be repaired!
    if (next && next.t === 'p' && next.v === '.' && next2 && (next2.t === 'word' || next2.t === 'qid')) {
      continue;
    }

    const candidate = tk.v;
    const lower = candidate.toLowerCase();
    if (knownNames.has(lower) || definedAliases.has(lower)) continue;

    const variants = [singularize(lower), pluralize(lower)];
    let found = variants.map((v) => realByLower.get(v)).find(Boolean);

    // Gap 2: For direct table refs, only use closestMatch if candidate length >= 4
    if (!found && candidate.length >= 4) {
      found = closestMatch(lower, realNames, { maxDistance: 1 });
    }
    if (found) {
      directRepairs.set(lower, found);
      const replacement = tk.t === 'qid' ? quoteIdent(found, dialect) : found;
      edits.push({ start: tk.s, end: tk.e, replacement });
      corrections.push({ from: candidate, to: found, offset: tk.s });
    }
  }

  // Pass 2: Repair table qualifiers on columns (e.g. employe.dept_id or `employe`.name)
  inFromClause = false;

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    const next = tokens[i + 1];
    const next2 = tokens[i + 2];

    if (tk.t === 'word') {
      const w = tk.v.toLowerCase();
      if (w === 'from') inFromClause = true;
      else if (CLAUSE_KEYWORDS.has(w)) inFromClause = false;
    }

    if (tk.t !== 'word' && tk.t !== 'qid') continue;

    // Check if token qualifies another token: tk.next2
    if (!next || next.t !== 'p' || next.v !== '.' || !next2 || (next2.t === 'word' && next2.t === 'qid')) {
      continue;
    }

    // Gap 4: If next2 is a table in table-ref position (e.g. hr.employees), tk is a schema prefix.
    // Schema prefixes must NEVER be repaired!
    if (isTableRefPosToken(tokens, i + 2, inFromClause) || realByLower.has(next2.v.toLowerCase())) {
      continue;
    }

    const lower = tk.v.toLowerCase();
    if (definedAliases.has(lower)) continue;

    // Check if this qualifier was repaired in Pass 1, or matches a real table column
    let found = directRepairs.get(lower);
    if (!found) {
      const variants = [singularize(lower), pluralize(lower)];
      found = variants.map((v) => realByLower.get(v)).find(Boolean);
    }

    if (!found) continue;

    // Verify found table actually has column next2
    const targetTable = realByLower.get(found.toLowerCase());
    const fullTableObj = schema.tables.find((t) => t.name.toLowerCase() === targetTable?.toLowerCase());
    if (fullTableObj && !fullTableObj.columns.some((c) => c.name.toLowerCase() === next2.v.toLowerCase())) {
      continue;
    }

    const replacement = tk.t === 'qid' ? quoteIdent(found, dialect) : found;
    edits.push({ start: tk.s, end: tk.e, replacement });
    corrections.push({ from: tk.v, to: found, offset: tk.s });
  }

  if (!edits.length) return { sql, repaired: false, corrections: [] };

  let out = sql;
  for (const ed of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, ed.start) + ed.replacement + out.slice(ed.end);
  }
  return { sql: out, repaired: true, corrections };
}

/**
 * When the model forgets the FROM clause entirely, that's only safe to
 * auto-complete if there's exactly ONE table in the dataset - otherwise
 * we'd be guessing which table was meant, which is exactly the kind of
 * fabrication this project's rules forbid. For a single-table dataset
 * (the overwhelmingly common case for a single CSV/Excel/SQLite upload)
 * there is only one possible correct answer, so this isn't a guess.
 */
function ensureFromClause(sql, schema) {
  const hasFrom = /\bFROM\b/i.test(sql);
  if (hasFrom) return { sql, repaired: false };
  if (schema.tables.length !== 1) return { sql, repaired: false }; // genuinely ambiguous - leave it to fail validation

  const onlyTable = schema.tables[0].name;
  return { sql: `${sql.trim()} FROM "${onlyTable}"`, repaired: true };
}

/**
 * INTEGER DIVISION FIX
 * ------------------------------------------------------------------
 * SQLite performs INTEGER division when both operands of "/" are
 * integers - COUNT(...) and SUM(...) always return integers for integer
 * columns, so a completely reasonable-looking percentage query like:
 *   COUNT(CASE WHEN status = 'completed' THEN 1 END) / COUNT(*) * 100
 * silently truncates to 0 BEFORE the *100 ever runs (5/7 truncates to 0,
 * not 0.71), producing a confidently wrong "0%" instead of an error.
 * This is worse than a refusal: it looks like a real, precise answer.
 *
 * Fixed deterministically by detecting COUNT(...)/... or SUM(...)/...
 * patterns (using a balanced-parenthesis scan, so it correctly handles
 * nested CASE WHEN expressions rather than a naive regex) and forcing
 * float division by prefixing the aggregate with "1.0 * ". This changes
 * the query's numeric TYPE, never its logic or which rows it touches -
 * it cannot make an otherwise-valid query behave differently in any way
 * other than making a division mathematically correct.
 * ------------------------------------------------------------------
 */
function fixIntegerDivision(sql) {
  let result = '';
  let i = 0;
  let corrected = false;
  let inString = false;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "'" && !inString) { inString = true; result += ch; i++; continue; }
    if (ch === "'" && inString) {
      if (sql[i + 1] === "'") { result += "''"; i += 2; continue; }
      inString = false;
      result += ch;
      i++;
      continue;
    }

    if (!inString && ch === '/' && sql[i + 1] !== '*' /* not a comment */) {
      // Look backward over what we've already appended to `result` to find
      // the aggregate call immediately preceding this division, skipping
      // whitespace.
      let j = result.length - 1;
      while (j >= 0 && /\s/.test(result[j])) j--;

      if (result[j] === ')') {
        // Walk backward to find the matching '('.
        let depth = 1;
        let k = j - 1;
        while (k >= 0 && depth > 0) {
          if (result[k] === ')') depth++;
          else if (result[k] === '(') depth--;
          k--;
        }
        // k+1 is now just after the matching '(' position... actually k is
        // just before it once depth hits 0; the '(' itself is at k+1.
        const openParenIdx = k + 1;
        // Read the identifier immediately before the '('.
        let nameEnd = openParenIdx;
        let nameStart = nameEnd;
        while (nameStart > 0 && /[A-Za-z_]/.test(result[nameStart - 1])) nameStart--;
        const fnName = result.slice(nameStart, nameEnd).toUpperCase();

        // Check it isn't already float-safe (already CAST, or already
        // multiplied by a float literal like "1.0 *" just before it).
        let beforeFn = nameStart - 1;
        while (beforeFn >= 0 && /\s/.test(result[beforeFn])) beforeFn--;
        const alreadyFloatSafe =
          fnName === 'CAST' ||
          result.slice(Math.max(0, beforeFn - 6), beforeFn + 1).replace(/\s/g, '').toUpperCase().endsWith('1.0*');

        if ((fnName === 'COUNT' || fnName === 'SUM') && !alreadyFloatSafe) {
          result = result.slice(0, nameStart) + '1.0 * ' + result.slice(nameStart);
          corrected = true;
        }
      }
    }

    result += ch;
    i++;
  }

  return { sql: result, repaired: corrected };
}

module.exports = { repairTableNames, ensureFromClause, fixIntegerDivision };
