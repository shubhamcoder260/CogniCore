# V4: SQL Safety Gate & Execution Perimeter — Code Facts Audit

**Workspace**: `C:\cognicore\validation_workspace`  
**Target Modules**:
- `server/src/structured/sql.validator.js`
- `server/src/structured/sql.complexity.js`
- `server/src/structured/sql.repair.js`
- `server/src/structured/sql.executor.js`
- `server/src/ingestion/adapters/sqlite.adapter.js`
- `server/src/core/engines/structured.engine.js`
- `server/src/config/env.js`

---

## 1. Rejection Rules & Order of Execution

In `server/src/core/engines/structured.engine.js`, the execution flow passes through candidate preparation, validation, policy enforcement, and execution:

### Step 1: Pre-Validation Deterministic Auto-Repair (`server/src/core/engines/structured.engine.js:82, 212-241`)
Before validation runs, `prepareSql()` mutates the raw candidate SQL in the following deterministic sequence:
1. `repairTableNames(sql, schema)` (`server/src/structured/sql.repair.js:37-68`): singular/plural normalization.
2. `repairColumnNames(sql, schema)` (`server/src/structured/sql.analyzer.js`): Levenshtein-based column suggestions.
3. `ensureFromClause(sql, schema)` (`server/src/structured/sql.repair.js:78-85`): injects `FROM "<table_name>"` if single-table schema and `FROM` is absent.
4. `repairMissingGroupBy(sql)` (`server/src/structured/sql.analyzer.js`): appends unaggregated select columns to `GROUP BY`.
5. `fixIntegerDivision(sql)` (`server/src/structured/sql.repair.js:107-164`): inserts `1.0 *` before `COUNT(...)` or `SUM(...)` before division `/`.
6. `repairValueLiterals(sql, semantic)` (`server/src/structured/sql.values.repair.js`): case-normalizes categorical filter values.

### Step 2: AST & Safety Validation (`server/src/structured/sql.validator.js:66-136`)
Inside `validateSql(sql, schema, datasetType = 'sqlite')`, rules execute in the following exact order:

#### Rule 1: Empty SQL Rejection (`server/src/structured/sql.validator.js:68-70`)
```javascript
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    throw new SQLValidationError('Empty SQL is not allowed.');
  }
```

#### Rule 2: Denylist Keywords Regex Scan (`server/src/structured/sql.validator.js:21-25, 74-80`)
Rejects if any blocked keyword appears as a standalone word boundary in uppercase text:
```javascript
const BLOCKED_KEYWORDS = [
  'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'ATTACH',
  'DETACH', 'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE', 'PRAGMA', 'VACUUM',
  'EXEC', 'EXECUTE', 'CALL',
];
```
Verbatim execution code:
```javascript
  const upper = sql.toUpperCase();
  for (const kw of BLOCKED_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(upper)) {
      throw new SQLValidationError(`Query contains a disallowed operation: ${kw}`, { keyword: kw });
    }
  }
```

#### Rule 3: Semicolon / Multiple Statements Rejection (`server/src/structured/sql.validator.js:83-85`)
Rejects if a semicolon appears anywhere other than the final character:
```javascript
  // Reject statement chaining / comments used to smuggle a second statement.
  if (sql.includes(';') && sql.trim().indexOf(';') !== sql.trim().length - 1) {
    throw new SQLValidationError('Multiple statements are not allowed.');
  }
```

#### Rule 4: SQL Comments Rejection (`server/src/structured/sql.validator.js:86-88`)
Rejects any query containing `--` or `/*` anywhere in the string (including inside literals):
```javascript
  if (/--|\/\*/.test(sql)) {
    throw new SQLValidationError('SQL comments are not allowed.');
  }
```

#### Rule 5: AST Parsing (`server/src/structured/sql.validator.js:50-57, 90-95`)
Parses SQL using `node-sql-parser`. For SQLite, it explicitly overrides dialect to `'postgresql'`:
```javascript
const DATASET_TYPE_TO_DIALECT = {
  sqlite: 'postgresql',
  csv: 'postgresql',   // materialized into an internal SQLite file
  xlsx: 'postgresql',  // materialized into an internal SQLite file
  json: 'postgresql',  // materialized into an internal SQLite file
  postgres: 'postgresql',
  mysql: 'mysql',
};
```
Verbatim execution code:
```javascript
  let ast;
  try {
    ast = parser.astify(sql, { database: dialect });
  } catch (err) {
    throw new SQLValidationError(`Query failed to parse: ${err.message}`);
  }
```

#### Rule 6: Statement Count Whitelist (`server/src/structured/sql.validator.js:97-100`)
```javascript
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1) {
    throw new SQLValidationError('Exactly one SELECT statement is required.');
  }
```

#### Rule 7: Statement Type Whitelist (`server/src/structured/sql.validator.js:20, 102-105`)
Only `select` is permitted:
```javascript
const ALLOWED_STATEMENT_TYPES = new Set(['select']);
```
Verbatim execution code:
```javascript
  const stmt = statements[0];
  if (!ALLOWED_STATEMENT_TYPES.has(stmt.type)) {
    throw new SQLValidationError(`Statement type "${stmt.type}" is not allowed. Only SELECT is permitted.`);
  }
```

#### Rule 8: Schema-Conformity Table Name Rule (`server/src/structured/sql.validator.js:107-127`)
Checks extracted table names against discovered schema `schema.tables` (allowing CTE-defined aliases):
```javascript
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
```

#### Rule 9: Function or Column Name Rules
- **Function Name Rules**: **NONE**. Neither `sql.validator.js` nor `sql.analyzer.js` checks or restricts function names (e.g., `load_extension`, `randomblob`, `zeroblob`, `readfile`).
- **Column Name Rules**: **NONE in validator**. Despite line 8 claiming `Table validation -> Column validation`, `validateSql` contains no column validation logic. Unrecognized columns are never rejected by `validateSql`.

#### Rule 10: Complexity Gate (`server/src/structured/sql.validator.js:129-134`)
```javascript
  // Cost / complexity gate (blueprint item 6): valid-but-abusive queries are refused before execution.
  const complexity = analyzeComplexity(sql, schema);
  if (!complexity.ok) {
    throw new SQLValidationError(`Query is too expensive to run safely: ${complexity.reasons.join('; ')}. Please simplify it.`, { complexity });
  }
```

---

## 2. Read-Only Enforcement on SQLite Connections

Read-only enforcement at the SQLite database layer is implemented in `server/src/ingestion/adapters/sqlite.adapter.js:8-13`:

```javascript
class SQLiteAdapter extends DataSourceAdapter {
  async connect() {
    this.db = new Database(this.location, { readonly: false, fileMustExist: true });
    this.db.pragma('journal_mode = WAL');
    return this;
  }
```

### Audit Facts:
1. **Driver**: `better-sqlite3` (version `12.11.1`).
2. **Flags**: Connection option `{ readonly: false, fileMustExist: true }`. Read-only is **EXPLICITLY DISABLED** (`readonly: false`).
3. **Pragmas**: Only `this.db.pragma('journal_mode = WAL')` is issued. SQLite's `PRAGMA query_only = ON;` is **NOT set**.
4. **Conclusion**: Read-only is **NOT enforced** at the database engine or driver connection level. The underlying connection has full read/write privileges to mutate the SQLite database on disk. Safety relies 100% on the AST/regex filters in `validateSql`.

---

## 3. Query Timeout, Row Cap, and Result Size Cap

### A. Query Timeout
- **Config Definition**: `server/src/config/env.js:41` sets:
  ```javascript
  timeoutMs: parseInt(process.env.QUERY_TIMEOUT_MS || '15000', 10),
  ```
- **Execution Reality**: `timeoutMs` is **NEVER passed** to `better-sqlite3` or wrapped with an asynchronous timeout in `server/src/structured/sql.executor.js` or `sqlite.adapter.js`.
- **Verdict**: **NO query timeout is enforced** for SQLite execution. Synchronous queries will block the Node.js event loop indefinitely on complex or recursive queries.

### B. Row Cap
- **Config Definition**: `server/src/config/env.js:40`:
  ```javascript
  maxRows: parseInt(process.env.MAX_RESULT_ROWS || '1000', 10),
  ```
- **Enforcement**: `server/src/structured/sql.executor.js:31-34`:
  ```javascript
  function enforceLimit(sql, maxRows) {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    return `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`;
  }
  ```
- **Verdict**: Enforced via outer subquery wrapping with `LIMIT 1000`.

### C. Result Size Cap
- **Verdict**: **NONE**. There is no maximum byte ceiling on row buffers or column payloads.

---

## 4. Complexity Gate Thresholds & Fan-Out Estimator

Located in `server/src/structured/sql.complexity.js:13-70`:

### A. Thresholds (`server/src/structured/sql.complexity.js:13-18`)
```javascript
const LIMITS = {
  maxLength: parseInt(process.env.SQL_MAX_LENGTH || '4000', 10),
  maxJoins: parseInt(process.env.SQL_MAX_JOINS || '6', 10),
  maxDepth: parseInt(process.env.SQL_MAX_SUBQUERY_DEPTH || '4', 10),
  maxEstimatedRows: parseFloat(process.env.SQL_MAX_ESTIMATED_ROWS || '5e9'),
};
```

### B. Fan-Out Estimator & Data Used (`server/src/structured/sql.complexity.js:54-66`)
```javascript
  // estimated fan-out: multiply row counts of referenced tables when they are joined without keys
  const rowCounts = new Map((schema?.tables || []).map((t) => [lc(t.name), Math.max(1, t.rowCount || 1)]));
  // every table OCCURRENCE in FROM/JOIN position counts (a self cross-join multiplies the same table)
  const referenced = tokens.filter((t, i) => (t.t === 'word' || t.t === 'qid') && rowCounts.has(lc(t.v)) && i > 0 && (['from', 'join'].includes(lc(tokens[i - 1].v)) || (tokens[i - 1].v === ',' && tokens[i - 1].t === 'p'))).map((t) => lc(t.v));
  const unkeyedJoin = (crossJoin || (commaJoin && !hasWhereOrOn));
  const estimatedRows = unkeyedJoin ? referenced.reduce((p, n) => p * rowCounts.get(n), 1) : Math.max(...referenced.map((n) => rowCounts.get(n)), 1);

  const reasons = [];
  if (sql.length > LIMITS.maxLength) reasons.push(`the statement is ${sql.length} characters long (limit ${LIMITS.maxLength})`);
  if (joinCount + (commaJoin ? 1 : 0) > LIMITS.maxJoins) reasons.push(`it joins ${joinCount} tables (limit ${LIMITS.maxJoins})`);
  if (maxDepth > LIMITS.maxDepth) reasons.push(`subqueries are nested ${maxDepth} levels deep (limit ${LIMITS.maxDepth})`);
  if (unkeyedJoin) reasons.push('it combines tables without a join condition (a cartesian product)');
  if (estimatedRows > LIMITS.maxEstimatedRows) reasons.push(`it could produce about ${estimatedRows.toExponential(1)} intermediate rows`);
```

- **Data Used**:
  - `schema.tables[].rowCount`: Reads the `rowCount` property stored on the ingested schema object (introspected once during dataset registration via `SELECT COUNT(*) FROM table`).
  - Fallback: If `rowCount` is undefined or 0, defaults to `1` (`Math.max(1, t.rowCount || 1)`).
  - No database engine statistics (e.g., `sqlite_stat1`, SQLite index heuristics, or `EXPLAIN QUERY PLAN`) are used.
  - Calculation: If `unkeyedJoin` is detected (an explicit `CROSS JOIN` or comma-separated tables in `FROM` without `where`, `on`, or `using`), it takes the product of `rowCount` across referenced table occurrences. Otherwise, it simply assigns `Math.max(...referenced.map((n) => rowCounts.get(n)), 1)`.

---

## 5. Architecture Documentation Comparison & Discrepancy Ledger

Comparison against `docs/CODEBASE_DOSSIER.md` and `docs/dossier/*`:

| # | Architecture Document Claim | Source File & Citation | Actual Implementation Reality | Status |
|---|---|---|---|---|
| **1** | *"execution occurs via strictly read-only database connections"* | `docs/CODEBASE_DOSSIER.md:12`, `docs/dossier/part-14-glossary-diagrams.md:154-155: 'readonly: true connection'` | `server/src/ingestion/adapters/sqlite.adapter.js:10` explicitly opens connections with `{ readonly: false }` and sets no read-only pragma. The connection is fully read-write. | **UNSUPPORTED / FALSE** |
| **2** | *"Pipeline: ... Table validation -> Column validation -> Read-only execution"* | `server/src/structured/sql.validator.js:8` | `sql.validator.js:107-127` validates table names against `schema.tables`, but performs zero column validation. Unknown columns pass through the gate unhindered. | **UNSUPPORTED / FALSE** |
| **3** | *"Query safety limits: timeoutMs: 15000"* | `server/src/config/env.js:41`, `docs/dossier/part-08-config-constants.md` | `config.query.timeoutMs` is defined but never passed to `better-sqlite3` or any execution wrapper. SQLite queries have zero timeout enforcement. | **UNSUPPORTED / FALSE** |
| **4** | *"SQL AST validator for SQLite"* | `docs/dossier/part-09-tests-benchmark.md:14`, `docs/dossier/part-11-paper-mapping.md:61-63` | `sql.validator.js:50-57` overrides SQLite grammar to `postgresql`. While acknowledged as a conscious parser workaround in comments, it creates dialect mismatches where valid SQLite constructs may fail to parse or PostgreSQL-specific constructs are permitted. | **PARTIAL / DRIFT** |
| **5** | *"Automated six-stage repair pipeline deterministically corrects common small-model errors... without incurring second-round LLM latency"* | `docs/CODEBASE_DOSSIER.md:12`, `docs/dossier/part-03-stage-deep-dive.md` | `prepareSql()` executes *before* `validateSql()`. A malicious or malformed query containing an integer division with an aggregate or a singularized keyword may be rewritten before AST validation occurs. | **SUPPORTED (Runs Before Gate)** |
| **6** | *"Reject statement chaining / SQL comments"* | `docs/CODEBASE_DOSSIER.md:69, 73` | Semicolons are checked via `sql.includes(';')` and comments via regex `/--|\/\*/.test(sql)`. This over-rejects benign string literals containing `--` or `/*` or `;`. | **SUPPORTED (Naive Over-Rejection)** |
| **7** | *"Result size cap"* | Spec invariant | There is an outer row cap (`LIMIT 1000`), but zero byte-size or memory cap on returned columns or rows. | **UNSUPPORTED** |
