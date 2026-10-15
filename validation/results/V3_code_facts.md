# V3 Code Facts: Data Policy, Row-Level Security, Column Denial, and Leak Channels

**Workspace**: `C:\cognicore\validation_workspace`  
**Branch**: `validation`  
**Date**: October 2026  
**Subject**: Architectural analysis of Row-Level Security (RLS), Column Denial, Enforcement Call Sites, and Non-SQL Leak Channels in CogniCore.

---

## 1. Policy Schema & Storage

The policy system is implemented in `server/src/security/data.policy.js`. Policies are stored in an internal SQLite registry database (`policies.db`), created via `getRegistryDb('policies', ...)` (`server/src/config/registry.db.js`).

### 1.1 Policy DDL and Storage Schema
Location: `server/src/security/data.policy.js:18-32`
```javascript
const DDL = `
  CREATE TABLE IF NOT EXISTS data_policies (
    policy_id TEXT PRIMARY KEY,
    dataset_id TEXT NOT NULL,
    role TEXT NOT NULL,            -- admin | manager | analyst | employee | viewer | user | *
    kind TEXT NOT NULL,            -- deny_column | row_filter
    table_name TEXT,               -- optional: restrict to one table
    column_name TEXT NOT NULL,
    op TEXT,                       -- = | != | IN   (row_filter)
    value TEXT,                    -- literal or {{user.*}} template (row_filter)
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_policy_dataset ON data_policies(dataset_id);
`;
```

### 1.2 PolicyStore CRUD Operations
Location: `server/src/security/data.policy.js:41-55`
```javascript
const PolicyStore = {
  add({ datasetId, role = '*', kind, tableName = null, columnName, op = null, value = null, createdBy = null }) {
    if (!['deny_column', 'row_filter'].includes(kind)) throw new Error('kind must be deny_column or row_filter');
    if (!columnName) throw new Error('columnName is required');
    if (kind === 'row_filter' && !['=', '!=', 'IN'].includes(op)) throw new Error('row_filter op must be =, != or IN');
    if (kind === 'row_filter' && (value === null || value === undefined)) throw new Error('row_filter requires a value');
    const id = 'pol_' + uuidv4().slice(0, 8);
    getDb().prepare(`INSERT INTO data_policies VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, datasetId, role, kind, tableName, columnName, op, value === null ? null : String(value), createdBy, new Date().toISOString());
    return id;
  },
  list(datasetId) { return getDb().prepare(`SELECT * FROM data_policies WHERE dataset_id = ? ORDER BY created_at`).all(datasetId); },
  remove(policyId) { getDb().prepare(`DELETE FROM data_policies WHERE policy_id = ?`).run(policyId); },
  removeForDataset(datasetId) { getDb().prepare(`DELETE FROM data_policies WHERE dataset_id = ?`).run(datasetId); },
};
```

### 1.3 Policy Resolution & Dynamic User Template Interpolation
Location: `server/src/security/data.policy.js:58-66`
```javascript
/** Effective policy for a user on a dataset. Admins are never restricted. */
function resolvePolicy({ datasetId, user }) {
  if (!user || user.role === 'admin') return { deniedColumns: [], rowFilters: [] };
  const rows = PolicyStore.list(datasetId).filter((p) => p.role === '*' || p.role === user.role);
  const sub = (v) => String(v).replace(/\{\{\s*user\.(\w+)\s*\}\}/g, (_, k) => (user[k] ?? ''));
  return {
    deniedColumns: rows.filter((p) => p.kind === 'deny_column').map((p) => ({ table: p.table_name, column: p.column_name })),
    rowFilters: rows.filter((p) => p.kind === 'row_filter').map((p) => ({ table: p.table_name, column: p.column_name, op: p.op, value: sub(p.value) })),
  };
}
```
**Key Observations**:
1. **Admin Exemption**: Any user with `user.role === 'admin'` or if `user` is falsy unconditionally bypasses all policy checks, returning empty arrays (`deniedColumns: [], rowFilters: []`).
2. **Template Interpolation**: Values matching `{{ user.<property> }}` are substituted with `user[k] ?? ''`. Supported user fields include `user.email`, `user.user_id`, `user.name`, `user.role`.
3. **Role Matching**: Matches policies where `p.role === '*'` or `p.role === user.role`.

---

## 2. Policy Engine: Column Denial & Row Filter Rewriting

Enforcement consists of two deterministic mechanisms:
1. `assertColumnAccess`: Throws `PolicyError` if denied columns are referenced.
2. `applyRowFilters`: Rewrites queries by prepending Common Table Expressions (CTEs) that shadow the physical base table.

### 2.1 Column Denial Enforcement: `assertColumnAccess`
Location: `server/src/security/data.policy.js:69-93`
```javascript
/** Throws PolicyError if the SQL references a denied column (directly, via alias, or via SELECT *). */
function assertColumnAccess(sql, schema, policy) {
  if (!policy?.deniedColumns?.length) return;
  const tokens = tokenize(sql);
  const used = new Set();
  tokens.forEach((t, i) => {
    if ((t.t === 'word' || t.t === 'qid') && (tokens[i - 1]?.v === 'from' || /^(from|join)$/i.test(tokens[i - 1]?.v || ''))) used.add(lc(t.v));
  });
  const usedTables = schema.tables.filter((t) => used.has(lc(t.name)));
  const scope = usedTables.length ? usedTables : schema.tables;

  const denied = policy.deniedColumns.filter((d) => !d.table || scope.some((t) => lc(t.name) === lc(d.table)));
  if (!denied.length) return;

  const hasStar = tokens.some((t, i) => t.v === '*' && t.t === 'p' && (!tokens[i - 1] || tokens[i - 1].v !== '(') && !/^count$/i.test(tokens[i - 2]?.v || ''));
  if (hasStar) {
    const cols = denied.map((d) => d.column).join(', ');
    throw new PolicyError(`Your role cannot access the restricted column(s): ${cols}. Ask for specific columns instead of "all columns".`, { columns: denied.map((d) => d.column) });
  }
  const deniedNames = new Set(denied.map((d) => lc(d.column)));
  for (const t of tokens) {
    if ((t.t === 'word' || t.t === 'qid') && deniedNames.has(lc(t.v))) {
      throw new PolicyError(`Your role does not have access to the column "${t.v}".`, { column: t.v });
    }
  }
}
```

**Mechanics & Edge Cases**:
- **Wildcard Detection**: Line 82 checks for `*` tokens where the preceding token is not `(` and preceding two tokens are not `COUNT(`. This catches `SELECT *` and `SELECT t.*`.
- **Token Matching**: Lines 88-92 scan all tokens of type `word` or `qid` (quoted identifier). If the lowercase token text matches any denied column name in scope, `PolicyError` is thrown.
- **Table Scoping Limitation**: Lines 73-75 look for tokens immediately preceded by `from` or `join`. If a table is schema-qualified (e.g. `FROM main.employees`), the token preceding `employees` is `.`, NOT `from` or `join`. As a result, `usedTables` is empty, and the check falls back to all `schema.tables`.

### 2.2 Row Filter Enforcement: `applyRowFilters`
Location: `server/src/security/data.policy.js:98-124`
```javascript
/** Wraps permitted tables in filtered CTEs. Returns possibly-rewritten SQL. */
function applyRowFilters(sql, schema, policy, datasetType) {
  const filters = policy?.rowFilters || [];
  if (!filters.length) return sql;
  const referenced = new Set(tokenize(sql).filter((t) => t.t === 'word' || t.t === 'qid').map((t) => lc(t.v)));
  const byTable = new Map();
  for (const t of schema.tables) {
    const rel = filters.filter((f) => (!f.table || lc(f.table) === lc(t.name)) && t.columns.some((c) => lc(c.name) === lc(f.column)));
    if (rel.length && referenced.has(lc(t.name))) byTable.set(t, rel);
  }
  if (!byTable.size) return sql;
  if (datasetType === 'mysql') throw new PolicyError('Row-level restrictions are not supported on MySQL connections; access denied to protect restricted rows.');

  const ctes = [];
  for (const [table, rels] of byTable) {
    const conds = rels.map((f) => {
      const col = `"${table.columns.find((c) => lc(c.name) === lc(f.column)).name.replace(/"/g, '""')}"`;
      if (f.op === 'IN') return `${col} IN (${String(f.value).split(',').map((v) => sqlStr(v.trim())).join(', ')})`;
      return `${col} ${f.op === '!=' ? '<>' : '='} ${sqlStr(f.value)}`;
    });
    const base = isSqliteBacked(datasetType) ? `main."${table.name.replace(/"/g, '""')}"` : `"${table.name.replace(/"/g, '""')}"`;
    ctes.push(`"${table.name.replace(/"/g, '""')}" AS (SELECT * FROM ${base} WHERE ${conds.join(' AND ')})`);
  }
  const trimmed = sql.trim();
  const m = trimmed.match(/^WITH\s+(RECURSIVE\s+)?/i);
  if (m) return `WITH ${m[1] || ''}${ctes.join(', ')}, ${trimmed.slice(m[0].length)}`;
  return `WITH ${ctes.join(', ')} ${trimmed}`;
}
```

**Mechanics & Architectural Vulnerabilities**:
1. **Shadowing Mechanism**: The engine defines a Common Table Expression with the same name as the table:
   `"customers" AS (SELECT * FROM main."customers" WHERE "branch" = 'North')`
2. **SQLite Schema-Qualification Bypass**: For SQLite, the base table is referenced as `main."table"`. If the incoming user query itself references `main.table` or `main."table"`, SQLite statement compilation resolves `main.table` directly to the attached physical database table, completely bypassing the CTE!
3. **CTE Collision / Name Redefinition**: If the incoming query already contains a CTE with the same name as the filtered table (e.g. `WITH customers AS (SELECT * FROM main.customers WHERE 1=1) SELECT * FROM customers`), line 122 merges the clauses into `WITH "customers" AS (...), customers AS (...)`, causing a fatal SQLite syntax error (`duplicate WITH table name: customers`).
4. **MySQL Fail-Closed Guard**: Line 108 immediately throws a 403 `PolicyError` if `datasetType === 'mysql'`.

---

## 3. Every Call Site Where Policies Are Retrieved or Applied

The policy engine is invoked across several pipeline layers:

### 3.1 Primary SQL Pipeline (`structured.engine.js`)
- `server/src/core/engines/structured.engine.js:87`:
  ```javascript
  const validation = validateSql(prepared.sql, schema, dataset.type);
  mark('sql_validated', 'ok', `syntax, schema and safety passed; cost: ${validation.complexity?.level || 'low'}`);
  execSql = enforcePolicy({ sql: prepared.sql, schema, policy, datasetType: dataset.type });
  ```
- `server/src/core/engines/structured.engine.js:146`: Empty result retry execution:
  ```javascript
  const retrySql = enforcePolicy({ sql: emptyDiagnosis.repairedSql, schema, policy, datasetType: dataset.type });
  ```

### 3.2 Core Query Engine & Routing (`core.engine.js`)
- `server/src/core/core.engine.js:63`:
  ```javascript
  const policyFor = (id) => resolvePolicy({ datasetId: id, user: actor });
  ```
- `server/src/core/core.engine.js:87`: Management report generation:
  ```javascript
  const report = await buildManagementReport({ dataset: structured[0], policy: policyFor(structured[0].dataset_id) });
  ```
- `server/src/core/core.engine.js:97`: Deterministic agent tools:
  ```javascript
  const agent = await tryAgent({ question: effectiveQuestion, dataset: structured[0], policy: policyFor(structured[0].dataset_id) });
  ```
- `server/src/core/core.engine.js:111`: Pipeline query router:
  ```javascript
  const routed = await routeQuery({ ..., policy: policyFor, ... });
  ```

### 3.3 Agent Safe Query Layer (`agent/safe.query.js`)
- `server/src/agent/safe.query.js:13-18`:
  ```javascript
  async function runSafeSql({ dataset, sql, policy = null, maxRows = 20000 }) {
    validateSql(sql, dataset.schema, dataset.type);
    const execSql = enforcePolicy({ sql, schema: dataset.schema, policy, datasetType: dataset.type });
    const adapter = createAdapter(dataset.type, { datasetId: dataset.dataset_id, location: dataset.location });
    return executeValidatedQuery(adapter, execSql, { maxRows });
  }
  ```

### 3.4 Shared Tool Execution Resolver (`tools/shared.js`)
- `server/src/tools/shared.js:43-44`:
  ```javascript
  const policy = resolvePolicy({ datasetId, user });
  const execSql = enforcePolicy({ sql, schema: dataset.schema, policy, datasetType: dataset.type });
  const adapter = createAdapter(dataset.type, { datasetId: dataset.dataset_id, location: dataset.location });
  const result = await executeValidatedQuery(adapter, execSql);
  ```

### 3.5 Action Proposal & Execution (`actions/action.executor.js`)
- `server/src/actions/action.executor.js:19-20`:
  ```javascript
  const policy = resolvePolicy({ datasetId, user: proposer });
  const report = await buildManagementReport({ dataset, policy });
  ```

### 3.6 API Routes (`api/routes/analytics.js` and `api/routes/tools.js`)
- `server/src/api/routes/analytics.js:30`: `const policyOf = (req) => resolvePolicy({ datasetId: req.dataset.dataset_id, user: req.user });`
- `server/src/api/routes/analytics.js:51`: `/api/analytics/briefing` resolves policy per dataset.
- `server/src/api/routes/analytics.js:62`: `/api/analytics/:datasetId/semantic` strips denied columns via `filterSemantic`.
- `server/src/api/routes/analytics.js:69-71`: `/api/analytics/:datasetId/quality` checks `policyRestrictsAggregates` and strips issues on denied columns.
- `server/src/api/routes/analytics.js:78-83`: `/api/analytics/:datasetId/kpis` checks `policyRestrictsAggregates` and filters denied columns from output.
- `server/src/api/routes/analytics.js:98, 106`: `/api/analytics/:datasetId/report` passes `policyOf(req)`.
- `server/src/api/routes/analytics.js:120`: `/api/analytics/:datasetId/chart-svg` invokes `resolveValidatedResult`.
- `server/src/api/routes/analytics.js:133`: `/api/analytics/:datasetId/export-analysis` invokes `resolveValidatedResult`.
- `server/src/api/routes/analytics.js:153-155`: `/api/analytics/:datasetId/python` checks `isColumnDenied` and runs `runSafeSql`.
- `server/src/api/routes/analytics.js:165`: `/api/analytics/:datasetId/catalog` invokes `buildCatalog({ dataset, policy })`.
- `server/src/api/routes/analytics.js:188`: `/api/analytics/:datasetId/dashboard` invokes `buildDashboard({ dataset, policy })`.
- `server/src/api/routes/analytics.js:194`: `/api/analytics/:datasetId/tool/schema` invokes `schemaTool(dataset, policy)`.
- `server/src/api/routes/analytics.js:196`: `/api/analytics/:datasetId/tool/profile` invokes `profilerTool(dataset, policy)`.
- `server/src/api/routes/tools.js:23, 32, 44, 65`: Endpoints `/chart`, `/calculate`, `/export`, and `/report` call `resolveValidatedResult({ datasetId, sql, user })`.
- `server/src/api/routes/policies.js:12, 17, 33`: Policy management CRUD (`PolicyStore.list`, `PolicyStore.add`, `PolicyStore.remove`).

---

## 4. Non-SQL Leak Channels & Policy Gaps

A comprehensive audit of all data-returning pathways reveals ten (10) severe architectural leak channels where restricted rows or denied columns bypass policy enforcement:

### Gap 1: Schema-Qualified CTE Shadowing Bypass (`main.table`)
- **Location**: `server/src/security/data.policy.js:117-124`
- **Issue**: SQLite resolves `SELECT * FROM main.employees` to the physical base table rather than the unqualified shadowing CTE `employees`.
- **Code**:
  ```javascript
  const base = isSqliteBacked(datasetType) ? `main."${table.name.replace(/"/g, '""')}"` : `"${table.name.replace(/"/g, '""')}"`;
  ctes.push(`"${table.name.replace(/"/g, '""')}" AS (SELECT * FROM ${base} WHERE ${conds.join(' AND ')})`);
  ```
  Executing `WITH "employees" AS (SELECT * FROM main."employees" WHERE branch = 'North') SELECT * FROM main."employees"` returns all rows across all branches.

### Gap 2: Unfiltered LLM Prompt Generation
- **Location**: `server/src/core/engines/structured.engine.js:48-56`
- **Issue**: When building the prompt for candidate SQL generation, the engine sends the raw `dataset.schema` and raw `dataset.profile.semantic` directly to the LLM. It does NOT invoke `resolvePolicy` or filter denied columns!
- **Code**:
  ```javascript
  const schema = dataset.schema;
  const relationships = dataset.profile?.relationships || analyzeSchema(schema, dataset.profile).relationships;
  const semantic = applyMeanings(dataset.profile?.semantic || null, dataset.profile?.semantic ? Meanings.list(dataset.dataset_id) : []);
  const recoveryLog = [];

  const gen = (extra = {}) => generateSql(llmProvider, {
    question, schema, relationships, conversationContext, datasetType: dataset.type,
    semantic, knowledgeText, followUp, ...extra,
  });
  ```
  The LLM prompt receives denied column names, types, full column statistics (min, max, average, missing count), and categorical sample values extracted from the entire table during profiling!

### Gap 3: Empty-Result Diagnosis Probing Leak
- **Location**: `server/src/core/engines/structured.engine.js:141` $\rightarrow$ `server/src/structured/result.checks.js:74, 85`
- **Issue**: When a query yields 0 rows, the system attempts automatic empty-result diagnosis. Probing queries are executed directly on the raw `adapter.executeQuery` WITHOUT policy enforcement!
- **Code**:
  ```javascript
  // server/src/structured/result.checks.js:74
  const ci = toNum((await adapter.executeQuery(`SELECT COUNT(*) AS n FROM ${tq} WHERE LOWER(TRIM(${cq})) = LOWER(TRIM('${lit}'))`)).rows[0]?.n) ?? 0;
  // server/src/structured/result.checks.js:85
  const rows = (await adapter.executeQuery(`SELECT ${cq} AS v, COUNT(*) AS n FROM ${tq} WHERE ${cq} IS NOT NULL GROUP BY ${cq} ORDER BY n DESC LIMIT 8`)).rows;
  findings.push({ column: col.name, literal: f.literal, type: 'value_not_found', available: rows.map((r) => r.v) });
  ```
  This queries rows across the entire database table regardless of row filters, and includes values from unauthorized rows in the `available` property of `findings`, which is attached to execution metadata!

### Gap 4: Dataset Preview Route
- **Location**: `server/src/api/routes/datasets.js:40-59`
- **Issue**: The dataset preview endpoint executes `adapter.preview(tableName, limit)` with zero policy checks.
- **Code**:
  ```javascript
  // GET /api/datasets/:id/preview?table=X&limit=10
  const adapter = createAdapter(dataset.type, { datasetId: dataset.dataset_id, location: dataset.location });
  await adapter.connect();
  try {
    const preview = await adapter.preview(tableName, parseInt(req.query.limit || '10', 10));
    res.json({ table: tableName, ...preview });
  } finally {
    await adapter.disconnect();
  }
  ```
  Any user with `read` permission can request `/api/datasets/:id/preview` and receive live data containing denied columns and restricted rows.

### Gap 5: Dataset Metadata Route
- **Location**: `server/src/api/routes/datasets.js:35-37`
- **Issue**: `GET /api/datasets/:id` returns the full `dataset` record without filtering `schema` or `profile`.
- **Code**:
  ```javascript
  router.get('/:id', requireDatasetAccess('read'), asyncHandler(async (req, res) => {
    res.json({ dataset: req.dataset });
  }));
  ```
  Exposes all denied column names, data types, primary keys, and relationships.

### Gap 6: Schema Endpoint Disclosure
- **Location**: `server/src/api/routes/schema.js:10-26`
- **Issue**: `GET /api/schema/:datasetId` calls `analyzeSchema(dataset.schema, dataset.profile)` with no policy filtering.
- **Code**:
  ```javascript
  const analyzed = analyzeSchema(dataset.schema, dataset.profile);
  res.json({ datasetId: dataset.dataset_id, isDocument: false, ...analyzed });
  ```
  Discloses table structure, row counts, and denied column names.

### Gap 7: Profiler Static Aggregate Leaks
- **Location**: `server/src/tools/catalog.js:50-60`
- **Issue**: `profilerTool` strips denied columns but returns global static aggregates for permitted columns computed over all rows.
- **Code**:
  ```javascript
  function profilerTool(dataset, policy) {
    const sem = dataset.profile?.semantic;
    if (!sem) return null;
    return {
      dataset: dataset.name,
      tables: sem.tables.map((t) => ({
        name: t.name, rowCount: t.rowCount,
        columns: t.columns.filter((c) => !isColumnDenied(policy, t.name, c.name)).map((c) => ({
          name: c.name, role: c.role, distinct: c.stats.distinct, missing: c.stats.missing,
          min: c.stats.min, max: c.stats.max, avg: c.stats.avg, pii: c.pii,
          distribution: c.stats.distribution ? { p25: c.stats.distribution.p25, median: c.stats.distribution.median, p75: c.stats.distribution.p75, shape: c.stats.distribution.shape } : undefined
        })),
      })),
    };
  }
  ```
  A user restricted to `branch = 'North'` learns the global total `rowCount`, global `min`, `max`, `avg`, `median`, and `p75` across all branches.

### Gap 8: Unmasked PII in Tool Export Endpoints
- **Location**: `server/src/api/routes/tools.js:50, 56, 67-74`
- **Issue**: While `chat.js` runs `redactEvidence(evidence, semantic, actor.role)` and `maskText()`, `server/src/api/routes/tools.js` exports raw query results directly without PII redaction:
- **Code**:
  ```javascript
  // CSV export:
  const buffer = toCsvBuffer(result);
  // XLSX export:
  const buffer = toXlsxBuffer(result, dataset.name);
  // PDF report:
  const buffer = await buildPdfReport({ ..., columns: result.columns, rows: result.rows });
  ```

### Gap 9: Raw KPI Metric Computation on Denied Columns
- **Location**: `server/src/analytics/kpi.js:28` & `server/src/report/report.builder.js:49-53`
- **Issue**: `generateKpis` executes SQL calculations on all measure columns directly against the adapter. If the policy only restricts columns (and has no row filters), `buildManagementReport` and `GET /api/analytics/:datasetId/kpis` run the calculation first, and only filter the result object in memory.
- **Code**:
  ```javascript
  // server/src/analytics/kpi.js:28
  const rows = (await adapter.executeQuery(kpi.sql)).rows;
  ```

### Gap 10: Multi-Turn Conversation Context Leakage
- **Location**: `server/src/core/context.manager.js:8-16` & `server/src/core/core.engine.js:70`
- **Issue**: Previous turns' assistant responses are saved in the session turn log. `buildConversationContext` extracts up to 4 previous turns and injects them verbatim into the LLM prompts of future queries:
- **Code**:
  ```javascript
  function buildConversationContext(sessionId, { maxTurns = 4 } = {}) {
    if (!sessionId) return '';
    const turns = DatasetRegistry.getRecentTurns(sessionId, maxTurns * 2);
    if (!turns.length) return '';
    return turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${truncate(t.content, 300)}`).join('\n');
  }
  ```
  If a session is shared or queried across role transitions, historical data from unrestricted turns leaks into the prompt.

### Gap 11: Schema Introspection Queries Bypass Column Denial
- **Location**: `server/src/security/data.policy.js:88-92`
- **Issue**: `assertColumnAccess` only triggers if the denied column name appears as a literal token in the query or if `*` is selected on a scoped table.
- **Mechanism**:
  - `SELECT name, type FROM pragma_table_info('employees')` does NOT contain `*` and does NOT contain the denied column name `salary`.
  - `SELECT sql FROM sqlite_master WHERE name = 'employees'` does NOT contain `*` and does NOT contain the denied column name.
  Both queries pass safety validation and `assertColumnAccess`, returning the names and definitions of all denied columns.

---

## 5. Comparison to Architecture Dossier Claims

| Dossier Claim / Citation | Code Reality | Verified Status |
| :--- | :--- | :--- |
| **"Transparent Zero-Trust Policy Enforcement via CTE Shadowing"** (`part-11-paper-mapping.md:15`, `part-11:51-55`) | **DISPROVEN for qualified tables**: Shadowing prepends `"t" AS (SELECT * FROM main."t" WHERE ...)`. If a query uses `main.t`, SQLite accesses the base table directly, bypassing the CTE entirely. | **VULNERABLE (Bypass via `main.t`)** |
| **"The LLM is never the security layer. Two policy kinds... enforced in plain code AFTER the SQL is generated"** (`data.policy.js:3-4`) | **PARTIALLY TRUE, BUT PROMPT LEAK**: Policy enforcement occurs after SQL generation, but prompt generation sends unfiltered schema and sample values of denied columns to the LLM. | **DEFECT (Prompt Data Leak)** |
| **"Zero Safety Leakage: Every sub-query goes through the full deterministic pipeline"** (`part-07-routes-features.md:72`) | **DISPROVEN**: The empty-result diagnosis probe (`result.checks.js:74, 85`) executes unvalidated, policy-free raw SQL against the database. | **VULNERABLE (Unenforced Probes)** |
| **"Tools never accept rows/numbers directly from client... closing off any path where a tool could be tricked into rendering fabricated numbers"** (`tools/shared.js:14-18`) | **ACCURATE for tool calculations, but bypassable via preview**: `/api/datasets/:id/preview` exposes live raw tables with zero policy checks. | **DISCREPANCY (Preview Route Gap)** |
| **"Row-level policies fail closed on MySQL connections; throws hard PolicyError (403)"** (`part-11:67-70`, `part-12:16`) | **CONFIRMED**: `server/src/security/data.policy.js:108` explicitly throws `PolicyError` on `datasetType === 'mysql'`. | **VERIFIED** |
| **"AST predicate injection is vulnerable... CTE shadowing isolates the entire base table at the scoping root"** (`part-11:53-54`) | **DISPROVEN**: CTE shadowing causes fatal syntax collisions on queries already defining a CTE named `t`, and fails to isolate `main.t`. | **DEFECT (CTE Collision & Scoping Bypass)** |
| **"PII masking for low-privilege roles (applies to what leaves the API)"** (`core.engine.js:166-170`) | **INCOMPLETE**: PII redaction is applied in `core.engine.js` and `/api/analytics/:datasetId/export-analysis`, but completely omitted in `/api/tools/export` and `/api/tools/report`. | **DEFECT (Export PII Leak)** |

---

## 6. Summary of Phase A Findings

1. **Policy Architecture**:
   - Stored in SQLite table `data_policies`.
   - Admin role unconditionally bypasses all policies.
   - Column denial: Token-based keyword matching on column names + wildcard `*` detection.
   - Row filtering: Prepending CTE shadowing `WITH "t" AS (SELECT * FROM main."t" WHERE ...)`.
2. **Structural Bypasses**:
   - `main."table"` qualification completely circumvents SQLite CTE shadowing.
   - CTE name redefinition causes SQLite syntax errors.
   - Column denial is vulnerable to schema introspection (`pragma_table_info`, `sqlite_master`).
3. **Information Disclosure Channels**:
   - Unfiltered schema, column stats, and sample values leak into LLM prompts.
   - Empty result diagnosis probe executes raw SQL across all rows.
   - `/api/datasets/:id/preview` returns raw table rows with no policy enforcement.
   - `/api/schema/:datasetId` and `/api/datasets/:id` expose full schema metadata.
   - `/api/tools/export` and `/api/tools/report` leak unmasked PII.
   - Profiler reveals dataset-wide aggregates (`min`, `max`, `avg`, `median`) to row-filtered users.
