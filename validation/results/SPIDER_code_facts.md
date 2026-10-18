# Spider Evaluation Code Facts & Pre-Flight Audit

**Date:** 2026-10-18  
**Scope:** CogniCore Structured Query Engine & Ingestion Pipeline Analysis for Spider Benchmark V1  
**Target Architecture:** Node.js v24.13.1, Python 3.11.9, SQLite 3.45.1 / better-sqlite3 3.53.2, Ollama `qwen2.5-coder:7b`

---

## 1. Environment & Ingestion Analysis

### 1.1 `NODE_ENV` Audit
- `server/src/app.js:29`: `if (config.env !== 'test') { app.use(requestLogger); }` (Affects HTTP request logging).
- `server/src/api/middleware/errorHandler.js:10`: `if (process.env.NODE_ENV === 'development' && err.stack)` (Formats error response stack traces).
- `server/src/config/env.js:10`: `const isTest = (process.env.NODE_ENV || 'development') === 'test';`
- `server/src/config/env.js:18`: `env: process.env.NODE_ENV || 'development',`
- `server/src/config/env.js:34`: `uploads: process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', isTest ? 'uploads-test' : 'uploads'),`
- `server/src/config/env.js:73`: `if (process.env.NODE_ENV === 'production' && weak) { throw new Error(...) }`

**Policy Decision:** Setting `NODE_ENV=test` modifies default storage directories (`uploads-test`) and logging middleware behavior. To maintain complete execution fidelity with normal production engine mechanics while isolating all file I/O, the evaluation runner does **NOT** set `NODE_ENV=test`. Instead, isolated disposable directories are explicitly configured via:
- `DATA_DIR`
- `UPLOADS_DIR`
- `REGISTRY_DB_PATH`
pointing directly to disposable run directories under `cognicore_spider/runs/<run_id>/`.

---

### 1.2 `ingestFile({ filePath, originalFilename, ownerId })`
- **Location:** `server/src/ingestion/ingestion.pipeline.js:23-72`
- **Signature:** `async function ingestFile({ filePath, originalFilename, ownerId = null })`
- **Flow:**
  1. Detects file type (`detectFileType`, line 24). For `.sqlite`, type is `'sqlite'`.
  2. Creates dataset record in `DatasetRegistry` with status `'registering'` (lines 32-38):
     `record = DatasetRegistry.create({ name, type, source: 'upload', location: filePath, ownerId })`
  3. Creates adapter via `createAdapter(type, { datasetId: record.dataset_id, location: filePath })` (line 41).
  4. Reads schema directly via `readSchema(adapter)` (line 51), returning `{ schema, metadata }`.
  5. Analyzes relationships via `analyzeSchema(schema, profile)` (line 56).
  6. Enriches semantic profile via `enrichProfile(...)` (lines 57-61).
  7. Merges enrichment: `Object.assign(analyzed, enriched)` (line 62).
  8. Marks dataset ready: `DatasetRegistry.markReady(record.dataset_id, { schema, profile: analyzed })` (lines 63-66).
  9. **Returns:** The updated dataset record object containing `{ dataset_id, name, type, location, schema, profile: { tables, relationships, semantic, quality, ... }, status: 'ready', ... }`.

---

### 1.3 Generation of `dataset.profile.semantic`
- **Location:** `server/src/ingestion/profile.enricher.js:12-34` and `server/src/semantic/semantic.builder.js:buildSemanticModel`
- **Flow:**
  - `enrichProfile` connects the adapter and invokes:
    ```javascript
    out.semantic = await buildSemanticModel({ adapter, schema, datasetType: type, relationships });
    ```
  - `buildSemanticModel` scans tables, columns, primary/foreign keys, distinct sample values, and generates semantic column meanings and classifications.
  - In `ingestFile`, `Object.assign(analyzed, enriched)` embeds `semantic` into `analyzed`, which is stored in `dataset.profile.semantic`.

---

## 2. Structured Engine Query Execution (`runStructuredQuery`)

### 2.1 Entry Point & Tracing
- **Location:** `server/src/core/engines/structured.engine.js:36-40`
  ```javascript
  async function runStructuredQuery(opts) {
    const steps = [];
    const res = await runStructuredQueryInner({ ...opts, _steps: steps });
    return { ...res, steps };
  }
  ```
- All return paths include the full execution trace array `steps: [{ name, status, detail, ms }]`.

---

### 2.2 Return States & Keys

#### State 1: `executed` (Success Path)
- **Lines:** 201-209
- **Return Shape:**
  ```javascript
  {
    routeType: 'STRUCTURED',
    evidence: { ... },          // Structured evidence object including result, provenance, confidence
    generatedSql: finalSql,    // SQL query that was actually executed
    execResult: {
      columns: [...],
      rows: [...],
      rowCount: N,
      truncated: boolean,
      durationMs: number,
      sqlExecuted: string
    },
    sqlRepaired: [...],         // Array of repairs applied (undefined if empty)
    recoveryLog: [...],         // Array of retry attempts (undefined if none)
    steps: [...]
  }
  ```

#### State 2: `empty result` (Diagnosed Subtype of Executed)
- **Lines:** 137-159, 165-169, 201-209
- **Behavior:** When `execResult.rowCount === 0`, `diagnoseEmptyResult` inspects literal filters against table values. If case/whitespace mismatches are detected, `emptyDiagnosis.repairedSql` is generated and executed.
- If repaired and rows are returned: `execResult` is updated, `sqlRepaired` includes `{ type: 'empty_result_case_fix' }`.
- If no rows match after diagnosis: `execResult.rowCount === 0`, `issues` in `evidence.resultValidation` logs unmatched value diagnostics.

#### State 3: `validation rejected`
- **Lines:** 102-103, 109, 247-253 (`validationFailure`)
- **Trigger:** AST syntax failure, prohibited statements (`DROP`, `INSERT`, etc.), comments, or non-recoverable safety violations, or validation errors when `attempt >= maxRecovery`.
- **Return Shape:**
  ```javascript
  {
    routeType: 'STRUCTURED',
    answer: "I generated a query but it failed safety validation (...). I won't run unsafe or unrecognized queries.",
    evidence: null,
    lowConfidence: true,
    generatedSql: sql,
    validationError: err.message,
    steps: [...]
  }
  ```

#### State 4: `NO_QUERY_POSSIBLE`
- **Lines:** 69-75, 123-128
- **Trigger:** Model returns `NO_QUERY_POSSIBLE` (or empty SQL) and fails to generate SQL even after one bounded retry hint.
- **Return Shape:**
  ```javascript
  {
    routeType: 'STRUCTURED',
    answer: "I don't have enough information in the connected dataset's schema to answer that question.",
    evidence: null,
    lowConfidence: true,
    generatedSql: rawSql,       // 'NO_QUERY_POSSIBLE'
    recoveryLog: [...],         // present if given up during recovery loop
    steps: [...]
  }
  ```

#### State 5: `error after retries`
- **Lines:** 110-114
- **Trigger:** Runtime database error (e.g. `no such column`, `syntax error`) that fails recovery or exceeds `maxRecovery`.
- **Return Shape:**
  ```javascript
  {
    routeType: 'STRUCTURED',
    answer: "I wasn't able to run a working query for that question after N automatic correction attempt(s) (...).",
    evidence: null,
    lowConfidence: true,
    generatedSql: prepared.sql,
    recoveryLog: [
      { attempt: 1, failedSql: string, error: string },
      ...
    ],
    steps: [...]
  }
  ```

---

## 3. Row-Cap Logic and SQL Cleaning Exports

### 3.1 `cleanSqlOutput`
- **Location:** `server/src/structured/sql.generator.js:84-92, 94`
- **Exported:** **YES** (`module.exports = { generateSql, buildSchemaDescription, buildPrompt, cleanSqlOutput };`).
- **Functionality:**
  - Strips leading and trailing markdown code fences: ```` ```(sql)? ````
  - Truncates query after first semicolon: `sql.slice(0, firstSemicolon)`
  - Trims extraneous whitespace.

### 3.2 Row-Cap Logic (`executeValidatedQuery`)
- **Location:** `server/src/structured/sql.executor.js:8-36`
- **Exported:** `executeValidatedQuery` is exported (`module.exports = { executeValidatedQuery };`).
- **Row-Cap Wrapper Implementation:** The inner helper `enforceLimit(sql, maxRows)` is private (lines 31-34):
  ```javascript
  function enforceLimit(sql, maxRows) {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    return `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`;
  }
  ```
- **Harness Requirement for C0:** C0 must use the exact same SQL wrapper:
  `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT 1000`
  to guarantee identical 1,000-row capping and truncation semantics across baseline and governed runs.

---

## 4. Prompt Construction & Output Format Instructions

- **Location:** `server/src/structured/sql.generator.js:62-74`
- **Exact Output Format Instructions:**
```
RULES:
- Output ONLY a single valid ${dialectLabel} SELECT statement. No explanation, no markdown, no code fences.
- Only SELECT statements are allowed (a leading WITH ... SELECT is fine). Never write DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, ATTACH, or PRAGMA.
- Use the table and column names exactly as shown in the schema above.
- Filter text columns using the exact spellings listed under possible values.
- When dividing counts or sums to compute a rate/percentage, the result should be a decimal, not an integer - write it in a way that avoids integer truncation (multiply by 100.0 first).
- Do not use semicolons or comments.
- If the question genuinely cannot be answered with the given schema (e.g. it asks about data that isn't present at all), output exactly: NO_QUERY_POSSIBLE
- Simple questions (counts, averages, sums, filters, sorting, filtering on multiple values) almost always CAN be answered directly against the schema above - attempt a query rather than giving up.

QUESTION: ${question}

SQL:
```
- For SQLite dialect, `${dialectLabel}` evaluates to `'SQLite'`.
- Baseline C0 prompt uses DDL extracted from `sqlite_master` concatenated with these **exact** instruction lines to ensure prompt format symmetry between C0 and C4.
