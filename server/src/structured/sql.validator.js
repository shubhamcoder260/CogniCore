/**
 * SQL VALIDATOR
 * ------------------------------------------------------------------
 * RULE #7: Never trust raw LLM-generated SQL.
 * RULE #8: Validate SQL before execution.
 *
 * Pipeline: LLM SQL -> Parser -> AST -> Operation validation ->
 *           Table validation -> Column validation -> Read-only execution
 *
 * We use node-sql-parser to build a real AST rather than regex matching,
 * then whitelist statement types and referenced tables/columns against
 * the dataset's actual discovered schema.
 * ------------------------------------------------------------------
 */
const { Parser } = require('node-sql-parser');
const logger = require('../config/logger');
const { extractCteNames, findUnknownColumns, stripLiterals, tokenize } = require('./sql.analyzer');
const { analyzeComplexity } = require('./sql.complexity');
const parser = new Parser();

const ALLOWED_STATEMENT_TYPES = new Set(['select']);
const BLOCKED_KEYWORDS = [
  'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'ATTACH',
  'DETACH', 'TRUNCATE', 'GRANT', 'REVOKE', 'PRAGMA', 'VACUUM',
  'EXEC', 'EXECUTE', 'CALL',
];
const BLOCKED_PATTERNS = [
  { re: /\bREPLACE\s+INTO\b/i, name: 'REPLACE INTO' },
  { re: /\bREPLACE(?!\s*\()/i, name: 'REPLACE' },
  { re: /\b(ZEROBLOB|RANDOMBLOB)\b/i, name: 'ZEROBLOB' },
];

/**
 * Inspect string literals for SQL injection smuggling.
 * In Domain 2, stripLiterals was introduced to allow benign literals containing
 * keywords (e.g. WHERE action = 'DROP' or WHERE note = 'A; B' or text with hyphens).
 * However, stripping literals wholesale allowed attackers to smuggle stacked statements,
 * comment terminations, and administrative commands inside single-quoted strings.
 * This gate validates that string literals do not contain malicious SQL payloads.
 */
function inspectLiterals(sql) {
  const tokens = tokenize(sql);
  const literals = tokens.filter(t => t.t === 'str').map(t => t.v);
  for (const lit of literals) {
    // Semicolon followed by DDL/DML/procedural statements (stacked queries)
    if (/;\s*(drop|delete|update|insert|alter|create|attach|detach|truncate|grant|revoke|pragma|vacuum|exec|execute|call|select|waitfor|declare|set|begin)\b/i.test(lit)) {
      throw new SQLValidationError('Disallowed operation in string literal: stacked statement detected.', { literal: lit });
    }
    // Comment injection inside literal (structural detection: truncation comments, unclosed block comments, or SQL logic + comments)
    if (/--|\/\*/.test(lit)) {
      const isCommentInjection = (
        /--\s*$|\/\*\s*$/.test(lit) ||
        (/\/\*/.test(lit) && !/\*\//.test(lit)) ||
        /\b(or|and|union|select|from|where|having|group\s+by|order\s+by|limit|exec|execute|waitfor|declare|set|insert|update|delete|drop|create|alter|attach|detach)\b/i.test(lit) ||
        /['"]|\)\s*--|\)\s*\/\*/.test(lit) ||
        /--\s*&/i.test(lit)
      );
      if (isCommentInjection) {
        throw new SQLValidationError('SQL comments are not allowed inside string literals.', { literal: lit });
      }
    }
    // Embedded administrative / mutating statements or extensions
    if (/\b(attach\s+database|create\s+table|insert\s+into|select\s+load_extension|reverse\s+shell)\b/i.test(lit) || /\bexec\s*\(/i.test(lit)) {
      throw new SQLValidationError('Disallowed administrative command in string literal.', { literal: lit });
    }
    // URL-encoded or hex injection tokens
    if (/%20(OR|AND)\b/i.test(lit)) {
      throw new SQLValidationError('Disallowed injection pattern in string literal.', { literal: lit });
    }
    // Dangerous SQLite / DB diagnostic and side-effect functions
    if (/\b(xp_cmdshell|xp_regread|load_file|load_extension|pg_sleep|waitfor\s+delay|information_schema|sqlite_version|pragma_table_info)\b/i.test(lit)) {
      throw new SQLValidationError('Disallowed diagnostic function in string literal.', { literal: lit });
    }
    // Trailing semicolon with command or fuzz markers
    if (/;\s*$/i.test(lit) && /(sqlvuln|drop|delete|update|insert)/i.test(lit)) {
      throw new SQLValidationError('Disallowed trailing command in string literal.', { literal: lit });
    }
    // Quotes escaping or boolean tautologies inside literal
    if (/(\b(or|and)\b.*(=|like|<|>|in\b)|'.*(\bor\b|\band\b)|".*(\bor\b|\band\b))/i.test(lit)) {
      throw new SQLValidationError('Disallowed boolean injection syntax in string literal.', { literal: lit });
    }
  }
}

class SQLValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SQLValidationError';
    this.details = details;
  }
}

/**
 * Maps a CogniCore dataset type to the SQL dialect node-sql-parser expects.
 *
 * NOTE: SQLite-backed datasets (sqlite/csv/xlsx/json) are validated using
 * the 'postgresql' grammar rather than 'sqlite'. This is deliberate: in
 * testing, node-sql-parser's own 'sqlite' dialect implementation fails to
 * parse perfectly valid, common SQL (e.g. a scalar subquery in a WHERE
 * clause: "WHERE salary = (SELECT MAX(salary) FROM t)"), while its
 * 'postgresql' dialect parses the exact same query correctly AND still
 * correctly recognizes double-quoted identifiers (SQLite and PostgreSQL
 * share that quoting convention, unlike MySQL's backticks). This only
 * changes which grammar VALIDATES the query's structure - the query still
 * physically executes against the real SQLite file via better-sqlite3
 * either way, so this does not weaken any security guarantee.
 */
const DATASET_TYPE_TO_DIALECT = {
  sqlite: 'postgresql',
  csv: 'postgresql',   // materialized into an internal SQLite file
  xlsx: 'postgresql',  // materialized into an internal SQLite file
  json: 'postgresql',  // materialized into an internal SQLite file
  postgres: 'postgresql',
  mysql: 'mysql',
};

/**
 * Validate `sql` against the dataset's known schema.
 * @param {string} sql
 * @param {{tables: {name:string, columns:{name:string}[]}[]}} schema
 * @param {string} [datasetType] - used to pick the correct SQL dialect for parsing
 * @returns {{valid: true, ast: object, tablesUsed: string[]}}
 */
function validateSql(sql, schema, datasetType = 'sqlite') {
  const dialect = DATASET_TYPE_TO_DIALECT[datasetType] || 'sqlite';
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    throw new SQLValidationError('Empty SQL is not allowed.');
  }

  // Inspect string literals for SQL injection smuggling
  inspectLiterals(sql);

  // Hard block: reject if any dangerous keyword appears as a standalone token,
  // even before we try to parse (defense in depth against parser quirks).
  // Strip string literals, double-quoted identifiers, and backticks first.
  const stripped = stripLiterals(sql);
  const upperStripped = stripped.toUpperCase();
  for (const kw of BLOCKED_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upperStripped)) {
      throw new SQLValidationError(`Query contains a disallowed operation: ${kw}`, { keyword: kw });
    }
  }
  for (const { re, name } of BLOCKED_PATTERNS) {
    if (re.test(stripped)) {
      throw new SQLValidationError(`Query contains a disallowed operation: ${name}`, { keyword: name });
    }
  }

  // Reject statement chaining / comments using stripped text (safe against literals containing ; or --)
  if (stripped.includes(';') && stripped.trim().indexOf(';') !== stripped.trim().length - 1) {
    throw new SQLValidationError('Multiple statements are not allowed.');
  }
  if (/--|\/\*/.test(stripped)) {
    throw new SQLValidationError('SQL comments are not allowed.');
  }

  let ast;
  try {
    ast = parser.astify(sql, { database: dialect });
  } catch (err) {
    throw new SQLValidationError(`Query failed to parse: ${err.message}`);
  }

  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new SQLValidationError('Exactly one SELECT statement is required.');
  }

  const stmt = statements[0];
  if (!ALLOWED_STATEMENT_TYPES.has(stmt.type)) {
    throw new SQLValidationError(`Statement type "${stmt.type}" is not allowed. Only SELECT is permitted.`);
  }

  // Validate table references against the ACTUAL dataset schema.
  const knownTables = new Set(schema.tables.map(t => t.name.toLowerCase()));
  let tableList = [];
  try {
    tableList = parser.tableList(sql, { database: dialect });
  } catch (_) {
    tableList = [];
  }
  // Names introduced by the query's own WITH clause are not real tables.
  const cteNames = new Set(extractCteNames(sql).map((n) => n.toLowerCase()));
  const tablesUsed = tableList.map(t => t.split('::').pop()).filter((t) => !cteNames.has(t.toLowerCase()) || knownTables.has(t.toLowerCase()));

  for (const table of tablesUsed) {
    if (!knownTables.has(table.toLowerCase())) {
      throw new SQLValidationError(`Query references unknown table "${table}".`, { table });
    }
  }

  if (tablesUsed.length === 0) {
    throw new SQLValidationError('Query does not reference any known table.');
  }

  // Validate column references against the dataset schema (fail-open + shadow mode telemetry)
  let unknownCols = [];
  try {
    unknownCols = findUnknownColumns(sql, schema);
  } catch (err) {
    logger.warn('column_validator_internal_error', { error: err.message });
    unknownCols = [];
  }

  if (unknownCols.length > 0) {
    const isEnforced = process.env.ENFORCE_COLUMN_VALIDATION === 'true';
    logger.warn('column_validator_unknown_columns', {
      count: unknownCols.length,
      columns: unknownCols.map((c) => (c.qualifier ? `${c.qualifier}.${c.name}` : c.name)),
      enforce: isEnforced,
    });

    if (isEnforced) {
      const colList = unknownCols
        .map((c) => (c.qualifier ? `"${c.qualifier}"."${c.name}"` : `"${c.name}"`))
        .join(', ');
      throw new SQLValidationError(`Query references unknown column(s): ${colList}.`, { unknownColumns: unknownCols });
    }
  }

  // Cost / complexity gate (blueprint item 6): valid-but-abusive queries are refused before execution.
  const complexity = analyzeComplexity(sql, schema);
  if (!complexity.ok) {
    throw new SQLValidationError(`Query is too expensive to run safely: ${complexity.reasons.join('; ')}. Please simplify it.`, { complexity });
  }

  return { valid: true, ast: stmt, tablesUsed, complexity };
}

module.exports = { validateSql, SQLValidationError, ALLOWED_STATEMENT_TYPES, BLOCKED_KEYWORDS };
