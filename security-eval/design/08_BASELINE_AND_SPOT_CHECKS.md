# 08_BASELINE_AND_SPOT_CHECKS.md: Codebase Baseline & Spot-Check Audit

**Document Status**: Authoritative Grounding & Spot-Check Ledger  
**Target Codebase Commit**: `9cde26cc712cd805d48c2ede925393742ec1b68d`  
**Execution Timestamp**: 2026-10-25T15:07:30Z  
**Verification Standard**: Grounded directly in `git rev-parse HEAD`, `git log`, `git show`, and exact line-by-line file inspections. Every code snippet is quoted verbatim from source code.

---

## 1. Baseline Commits & Pre-Fix History

Audit of the git commit history across key security modules:
- `server/src/ingestion/adapters/sqlite.adapter.js`
- `server/src/structured/sqlite.worker.js`
- `server/src/structured/sql.validator.js`
- `server/src/security/data.policy.js`

### 1.1 Commit Ledger for Security Modules
```
62107b7 fix(validator): allow table-valued functions in empty tables check and adjust heartbeat tolerance
932996b fix(sqlite): enforce readonly connection, worker thread timeout, and cartesian join detection (Item 5)
971d171 fix(egress): enforce shared egress chokepoint and policy-wrapped diagnostics (Item 3)
56313f7 fix(validator): reject dangerous and table-valued functions (Item 2)
8205910 fix(policy): normalize schema-qualified table references and reject system catalogs (Item 1)
bba54e2 fix(validator): use structural comment detection in string literals
3ca818b fix(executor): prevent closing shared SQLite adapter per query (STEP0)
b1ca7ed fix(gate): remediate V4/V4b gate regressions and freeze regression corpus
e4dd6cf feat(connectors): mirror Domain 4 fixes to validation workspace
e439ce6 feat(security): harden RBAC, denied-CTE propagation, and test DB isolation
9f74526 feat(security): apply domain 2 sql parser ast validator and table repair fixes
64d14ea (origin/main, origin/HEAD, main) Initial commit - CogniCore
```

### 1.2 Identification of the Driver Hardening Boundary
1. **Earliest Hardened Commit (`readonly: true` + `PRAGMA query_only = ON`)**:
   - **Commit Hash**: `932996b80337287a2cb89349bf838b6058f94416`
   - **Commit Subject**: `fix(sqlite): enforce readonly connection, worker thread timeout, and cartesian join detection (Item 5)`
   - **Date**: Mon Oct 19 19:13:56 2026 +0530
   - **Changes Applied**:
     - Introduced `sqlite.worker.js` with `{ readonly: true }` and `db.pragma('query_only = ON')`.
     - Modified `sqlite.adapter.js:15-18` to enforce `readonly: true` and `query_only = ON`.
     - Wired 15-second execution timeout with synchronous `worker.terminate()`.
2. **Pre-Fix Baseline Commit (Immediate Parent)**:
   - **Commit Hash**: `903c3c18e4a9f7521c4bbff26eece86fe7244b9f`
   - **Commit Subject**: `fix(sessions): enforce UUID entropy, user binding, and IDOR isolation (Item 4)`
   - **Driver State at `903c3c1`**:
     ```javascript
     // git show 903c3c1:server/src/ingestion/adapters/sqlite.adapter.js:10-13
     this.db = new Database(this.location, { readonly: false, fileMustExist: true });
     this.db.pragma('journal_mode = WAL');
     ```
     `sqlite.worker.js` did not exist; queries ran on the main thread in read-write mode.
3. **Availability of Pre-Fix Baseline**:
   - **YES**. A definitive pre-fix baseline exists at commit `903c3c1`.
   - **Evaluation Design Implication**: S1-A (mutation testing) and S2 Tier 1 can be checked out and executed at `903c3c1` (pre-fix) and `9cde26c` (current HEAD) to empirically prove that driver isolation eliminated mutation vulnerabilities.

---

## 2. Code Spot-Checks with Verbatim File:Line Citations

Every item below has been verified against commit `9cde26cc712cd805d48c2ede925393742ec1b68d`:

### (a) Default Model in `env.js`
- **Location**: `server/src/config/env.js:26`
- **Verbatim Code**:
  ```javascript
  model: process.env.OLLAMA_MODEL || 'qwen2.5:14b',
  ```

### (b) SQLite Adapter & Worker Flags
- **Adapter Location**: `server/src/ingestion/adapters/sqlite.adapter.js:15-18`
- **Verbatim Code**:
  ```javascript
    } else {
      this.db = new Database(this.location, { readonly: true, fileMustExist: true });
      this.db.pragma('query_only = ON');
    }
  ```
- **Worker Location**: `server/src/structured/sqlite.worker.js:10-12`
- **Verbatim Code**:
  ```javascript
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
  ```

### (c) `PolicyStore.add` Accepted Kinds
- **Location**: `server/src/security/data.policy.js:37`
- **Verbatim Code**:
  ```javascript
  if (!['deny_column', 'row_filter'].includes(kind)) throw new Error('kind must be deny_column or row_filter');
  ```

### (d) `assertColumnAccess` Behavior for `COUNT(*)`, `SELECT t.*`, and `SELECT *`
- **`COUNT(*)` Handling** (`server/src/security/data.policy.js:157-162`):
  ```javascript
    // Skip count(*)
    const prev = tokens[i - 1];
    if (prev && prev.v === '(') {
      const prev2 = tokens[i - 2];
      if (prev2 && prev2.t === 'word' && /^count$/i.test(prev2.v)) continue;
    }
  ```
  *Finding*: `COUNT(*)` is explicitly skipped. Queries computing `SELECT COUNT(*) FROM table` pass even if every column in the table is denied.
- **Qualified Wildcard `SELECT t.*` Handling** (`server/src/security/data.policy.js:164-177`):
  ```javascript
    if (prev && prev.v === '.' && prev.t === 'p') {
      const q = tokens[i - 2];
      const qName = q && lc(q.v);
      const table = q && scope.aliasMap.get(qName);
      if (table) {
        const tableDenied = applicableDenied.filter(
          (d) => !d.table || lc(d.table) === lc(table.name)
        );
        if (tableDenied.length) {
          throw new PolicyError(
            `Your role cannot access the restricted column(s) on ${table.name}: ${tableDenied.map((d) => d.column).join(', ')}. Ask for specific columns instead of "all columns".`,
            { columns: tableDenied.map((d) => d.column) }
          );
        }
        continue;
      }
  ```
- **Unqualified Wildcard `SELECT *` Handling** (`server/src/security/data.policy.js:191-200`):
  ```javascript
    const hasTableDenied = applicableDenied.length > 0;
    const hasCteDenied = [...scope.usedTables].some((n) => deniedCteNames.has(lc(n)));
    if (hasTableDenied || hasCteDenied) {
      const cols = applicableDenied.map((d) => d.column).join(', ');
      throw new PolicyError(
        `Your role cannot access the restricted column(s): ${cols}. Ask for specific columns instead of "all columns".`,
        { columns: applicableDenied.map((d) => d.column) }
      );
    }
  ```

### (e) `screenQuestion` Block Conditions
- **Location**: `server/src/guardrails/input.guard.js:42-43`
- **Verbatim Code**:
  ```javascript
  const blocked = flags.includes('prompt_injection') || flags.includes('oversized_input');
  ```
  *Finding*: `flags.push('sql_injection_attempt')` occurs at line 40, but line 42 omits `sql_injection_attempt` from the `blocked` predicate. SQL injection patterns in natural language pass through to the SQL generator.

### (f) First-Registered-User Admin Behavior
- **Location**: `server/src/api/routes/auth.js:36-37`
- **Verbatim Code**:
  ```javascript
  const isFirstUser = AuthRegistry.countUsers() === 0;
  const role = isFirstUser ? 'admin' : 'user';
  ```

### (g) Pipeline Stage Order in `structured.engine.js`
- **Location**: `server/src/core/engines/structured.engine.js:46-95`
- **Sequence**:
  1. Line 46: `let { sql: rawSql, rawResponse } = await gen();` (SQL Generation)
  2. Line 63: `prepared = prepareSql(rawSql, { schema, semantic, datasetType: dataset.type });` (Deterministic Auto-Repair)
  3. Line 66: `const validation = validateSql(prepared.sql, schema, dataset.type);` (AST & Complexity Validation)
  4. Line 79: `execSql = enforcePolicy({ sql: prepared.sql, schema, policy, datasetType: dataset.type });` (Data Policy Rewriting)
  5. Line 90: `execResult = await executeValidatedQuery(adapter, execSql);` (Worker Thread Execution)

### (h) Executor Timeout / Terminate Path
- **Location**: `server/src/structured/sql.executor.js:28-40`
- **Verbatim Code**:
  ```javascript
    timer = setTimeout(async () => {
      if (finished) return;
      finished = true;
      if (typeof onTimeout === 'function') onTimeout();
      try {
        await worker.terminate();
      } catch (_) {}
      reject(new Error(`Query execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  ```

### (i) `MAX_SUB_QUESTIONS` and Sub-Query Execution in `analysis.engine.js`
- **Location**: `server/src/core/engines/analysis.engine.js:4, 37, 51-62`
- **Verbatim Code**:
  ```javascript
  const MAX_SUB_QUESTIONS = 6;
  // ...
  const subQuestions = parsePlan(planRaw).slice(0, MAX_SUB_QUESTIONS);
  // ...
  for (const subQuestion of subQuestions) {
    try {
      const result = await runStructuredQuery({ question: subQuestion, dataset, llmProvider, conversationContext, policy, knowledgeText });
      steps.push({
        subQuestion,
        evidence: result.evidence || null,
        failureReason: result.evidence ? null : (result.answer || 'No result.'),
      });
    } catch (err) {
      steps.push({ subQuestion, evidence: null, failureReason: err.message });
    }
  }
  ```

### (j) Whether `GET /api/schema/:id` Applies Column Policies
- **Location**: `server/src/api/routes/schema.js:25-26`
- **Verbatim Code**:
  ```javascript
  const analyzed = analyzeSchema(dataset.schema, dataset.profile);
  res.json({ datasetId: dataset.dataset_id, isDocument: false, ...analyzed });
  ```
  *Finding*: `schema.js` calls `analyzeSchema` directly and **does not apply column policies**. All tables and columns in the physical database are returned to any authenticated user with `read` dataset access.

### (k) Whether the `PolicyError` Message Contains Column Names
- **Location**: `server/src/security/data.policy.js:173, 194, 227`
- **Verbatim Code**:
  ```javascript
  // Line 173:
  throw new PolicyError(`Your role cannot access the restricted column(s) on ${table.name}: ${tableDenied.map((d) => d.column).join(', ')}. Ask for specific columns instead of "all columns".`, { columns: tableDenied.map((d) => d.column) });
  // Line 227:
  throw new PolicyError(`Your role does not have access to the column "${tk.v}".`, { column: tk.v });
  ```
  *Finding*: `PolicyError` explicitly prints the names of restricted columns in its exception message.

### (l) How `resolvePolicy` Normalises Roles & Admin Bypass
- **Location**: `server/src/security/data.policy.js:53-54`
- **Verbatim Code**:
  ```javascript
  function resolvePolicy({ datasetId, user }) {
    if (!user || user.role === 'admin') return { deniedColumns: [], rowFilters: [] };
    const rows = PolicyStore.list(datasetId).filter((p) => p.role === '*' || p.role === user.role);
  ```
  *Finding*:
  1. `admin` bypasses policy unconditionally (`return { deniedColumns: [], rowFilters: [] }`).
  2. `resolvePolicy` **does not alias `'user'` to `'analyst'`**. It performs an exact match `p.role === user.role`. Although `rbac.js:44` defines `'user'` as a capability alias of `'analyst'`, policies defined for `role: 'analyst'` do not apply to users with `role: 'user'`.

### (m) Whether `/api/tools/export|chart|report` Run `validateSql` & `enforcePolicy`
- **Location**: `server/src/tools/shared.js:34-45`
- **Verbatim Code**:
  ```javascript
  try {
    validateSql(sql, dataset.schema, dataset.type);
  } catch (err) {
    if (err instanceof SQLValidationError) {
      throw new Error(`Query failed safety validation: ${err.message}`);
    }
    throw err;
  }
  const policy = resolvePolicy({ datasetId, user });
  const execSql = enforcePolicy({ sql, schema: dataset.schema, policy, datasetType: dataset.type });
  ```
  *Finding*: All tool endpoints call `resolveValidatedResult`, which runs `validateSql` and `enforcePolicy`. However, it **omits `prepareSql`** (the auto-repair loop).

### (n) Semantic Profile and Cache Scope
- **Location**: `server/src/ingestion/ingestion.pipeline.js:57-64` & `server/src/core/engines/structured.engine.js:50`
- **Verbatim Code**:
  ```javascript
  // ingestion.pipeline.js:57-61:
  const enriched = await enrichProfile({
    type, datasetId: record.dataset_id, location: filePath, schema,
    relationships: analyzed.relationships,
    loaderNotes: profile && profile.dateNormalization ? { [schema.tables[0].name]: profile } : profile,
  });
  // structured.engine.js:50:
  const semantic = applyMeanings(dataset.profile?.semantic || null, dataset.profile?.semantic ? Meanings.list(dataset.dataset_id) : []);
  ```
  *Finding*: The semantic profile and catalog are built once during ingestion and stored in `dataset.profile.semantic`. Business meanings are fetched via `Meanings.list(dataset.dataset_id)`. The semantic cache is **scoped per dataset, NOT per user**.

---

## 3. Inventory of Existing Validation Corpora (`validation/data/`)

Exact line counts and file counts across `validation/data/` subdirectories:

| Subdirectory | File Path | Record / Line Count | Stated v1 Count | Contradiction / Omission in v1 |
| :--- | :--- | :---: | :---: | :--- |
| `validation/data/v3/` | `v3_queries.jsonl` | 510 | 510 | None. |
| `validation/data/v3b/`| `v3b_queries.jsonl` | 1,430 | *Omitted* | v1 reported only file size (1,028 KB); omitted 1,430 line count. |
| `validation/data/v3c/`| `v3c_queries.jsonl` | 46,920 | *Omitted* | v1 reported only file size (38 MB); omitted massive 46,920 line count. |
| `validation/data/v3d/`| `v3d_queries.jsonl` | 40 | *Omitted* | v1 omitted 40 line count. |
| `validation/data/v4/` | `attacks.jsonl` | 1,348 | 1,348 | None for this single file. |
| `validation/data/v4/` | `benign.jsonl` | 220 | 220 | None. |
| `validation/data/v4/` | `boundary.jsonl` | 12 | 12 | None. |
| `validation/data/v4/` | `fuzz.jsonl` | 350 | 350 | None. |
| `validation/data/v4/` | `regressions.jsonl` | 166 | 166 | None. |
| `validation/data/v4b/`| `b2_probes.jsonl` | 352 | *Omitted* | v1 completely omitted directory `v4b/` (844 items). |
| `validation/data/v4b/`| `c2_benign.jsonl` | 465 | *Omitted* | v1 omitted. |
| `validation/data/v4b/`| `d2_boundary.jsonl` | 27 | *Omitted* | v1 omitted. |
| `validation/data/v4c/`| `dos_items.jsonl` | 29 | *Omitted* | v1 completely omitted directory `v4c/` (29 DoS items). |
| `validation/data/v4d/`| `executable_writes.jsonl`| 640 | *Omitted* | v1 completely omitted directory `v4d/` (640 verified write items). |
| `validation/data/v13/`| `v13_corpus.jsonl` | 972 | 972 | None. |
| **TOTAL** | | **53,481** | **3,578** | **v1 under-reported validation assets by 49,903 records.** |
