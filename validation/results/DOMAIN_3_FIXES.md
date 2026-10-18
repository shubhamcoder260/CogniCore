# Domain 3 Fixes: RBAC, Multi-Tenancy & Authorization Security

## Overview
This document records every vulnerability, architectural bug, and heuristic flaw diagnosed and resolved in **Domain 3: RBAC, Multi-Tenancy & Authorization Security**, along with failure mechanisms, root causes, exact code diffs, and verification results across all unit and integration test suites.

---

## 3.1 Column Access Control with Denied-CTE Propagation & Subquery Scoping

### Problem & Failure Mechanism
In `server/src/security/data.policy.js`:
1. **Indiscriminate Token Matching**: `assertColumnAccess` originally checked `if ((t.t === 'word' || t.t === 'qid') && deniedNames.has(lc(t.v)))` on all tokens indiscriminately.
   - Output column aliases collided with restricted column names: `SELECT bonus AS salary FROM employees` was rejected because `salary` matched `deniedNames`, even though `salary` was an alias and the restricted column was never accessed.
   - Multi-table column name collisions: `SELECT d.salary FROM departments d JOIN employees e ON d.id = e.dept_id` was blocked when `employees.salary` was restricted, even though `d.salary` qualified the unrestricted `departments` table.
2. **Wildcard Over-Blocking**: The check flagged any `*` in the query (except `count(*)`). A query joining an unrestricted table and a restricted table (e.g. `SELECT d.* FROM departments d JOIN employees e ...`) was blocked even though `d.*` expanded only columns of the unrestricted table.
3. **CTE & Derived Table Authorization Bypass (Security-Critical)**:
   - A query defining a CTE projecting a denied column (e.g. `WITH safe_view AS (SELECT amount FROM secret_salary) SELECT amount FROM safe_view` or with an alias `SELECT amount AS safe_amount`) could expose restricted data under a new name without being caught by table-specific rules.
   - Conversely, if a CTE definition referenced a denied column in its projection list but the outer query only selected permitted columns (e.g. `WITH safe_view AS (SELECT employee_id, amount FROM secret_salary) SELECT employee_id FROM safe_view`), a naive token scan blocked the query despite zero unauthorized egress.

### Architectural Solution
The fix implements three coordinated security layers:
1. **Layer 1: Denied-CTE Propagation**:
   - `extractCteBodies(sql)`: parses all CTE definitions in top-level `WITH` clauses and tracks each CTE's `exposedColumns` and `columnLineage` (mapping exposed names to underlying source table and column).
   - If an exposed column derives from a denied column, it is recorded in `deniedCteColumns`.
   - In `assertColumnAccess`, tokens inside CTE `SELECT` lists are isolated from outer column checks (allowing safe CTE definitions), while outer queries selecting `cte.col`, bare `col` resolving to a denied CTE, or `cte.*` are strictly blocked.
2. **Layer 2: Subquery Alias Scoping**:
   - `buildScope` in `sql.analyzer.js` extracts projected columns of derived table subqueries in `FROM / JOIN: (SELECT ...) [AS] sub`, populating virtual tables in `aliasMap`.
   - Outer references `sub.amount` map back to source columns and are blocked if denied, while `sub.employee_id` is permitted.
   - Subquery predicates in `WHERE s.amount > 100` are validated against `applicableDenied` and blocked.
3. **Layer 3: KEYWORDS Verification**:
   - `assertColumnAccess` verifies tokens against `KEYWORDS` (including `OVER`, `PARTITION`, `BY`, `WINDOW`, `ROWS`, `RANGE`, `UNBOUNDED`, `PRECEDING`, `FOLLOWING`, `INTERVAL`).
   - Window functions such as `SELECT row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn FROM employees` block strictly because `salary` is referenced in `ORDER BY`, while `OVER` and `PARTITION` are safely recognized as keywords.

### Before & After Snippets

#### `server/src/structured/sql.analyzer.js`
```javascript
// BEFORE
module.exports = { tokenize, stripLiterals, findUnknownColumns, repairColumnNames, repairMissingGroupBy, extractCteNames, KEYWORDS };

// AFTER
function extractProjectedColumns(bodyTokens, tableByName = new Map()) { ... }
function extractCteBodies(sql) { ... }

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
```

#### `server/src/security/data.policy.js`
```javascript
// BEFORE
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

// AFTER
  const scope = buildScope(tokens, schema);
  const cteBodies = extractCteBodies(sql);

  const allUsedTableNames = new Set([...scope.usedTables].map(lc));
  for (const cte of cteBodies) {
    allUsedTableNames.add(lc(cte.name));
    for (const [, lineage] of cte.columnLineage) {
      if (lineage.table) allUsedTableNames.add(lc(lineage.table));
    }
  }

  const scopeTables = allUsedTableNames.size
    ? [...allUsedTableNames].map((n) => scope.tableByName.get(lc(n))).filter(Boolean)
    : schema.tables;

  const applicableDenied = policy.deniedColumns.filter((d) =>
    !d.table || scopeTables.some((t) => lc(t.name) === lc(d.table))
  );
  if (!applicableDenied.length) return;

  const deniedCteColumns = new Map();
  const deniedCteNames = new Set();
  ...
```

---

## 3.2 Row Filter CTE Self-Recursion in PostgreSQL

### Problem & Failure Mechanism
In line 117 of `server/src/security/data.policy.js`:
```javascript
const base = isSqliteBacked(datasetType) ? `main."${table.name.replace(/"/g, '""')}"` : `"${table.name.replace(/"/g, '""')}"`;
ctes.push(`"${table.name.replace(/"/g, '""')}" AS (SELECT * FROM ${base} WHERE ${conds.join(' AND ')})`);
```
- In SQLite, `main."table"` directs SQLite to the base table in schema `main`.
- In PostgreSQL (`datasetType === 'postgres'`), `isSqliteBacked` is `false`, resulting in:
  `WITH "employees" AS (SELECT * FROM "employees" WHERE ...)`
- In PostgreSQL, referencing `"employees"` without schema qualification inside a CTE of the same name references the CTE itself, producing fatal SQL error `42P01: cycle in CTE references` or recursive query errors.

### Architectural Solution
Qualify PostgreSQL base tables with schema namespace (`"${table.schema || 'public'}"."${table.name}"`):
```javascript
// BEFORE (data.policy.js:117)
const base = isSqliteBacked(datasetType) ? `main."${table.name.replace(/"/g, '""')}"` : `"${table.name.replace(/"/g, '""')}"`;

// AFTER (data.policy.js:296-302)
const schemaPrefix = table.name.includes('.')
  ? `"${table.name.split('.')[0].replace(/"/g, '""')}"."${table.name.split('.')[1].replace(/"/g, '""')}"`
  : datasetType === 'postgres'
  ? `"${(table.schema || 'public').replace(/"/g, '""')}"."${table.name.replace(/"/g, '""')}"`
  : isSqliteBacked(datasetType)
  ? `main."${table.name.replace(/"/g, '""')}"`
  : `"${table.name.replace(/"/g, '""')}"`;
ctes.push(`"${table.name.replace(/"/g, '""')}" AS (SELECT * FROM ${schemaPrefix} WHERE ${conds.join(' AND ')})`);
```

---

## 3.3 Query String Parameter Resolution in `requireDatasetAccess`

### Problem & Failure Mechanism
In line 120 of `server/src/security/rbac.js`:
```javascript
const datasetId = req.params.id || req.params.datasetId || req.body?.datasetId;
```
- HTTP GET requests passing `?datasetId=ds_xxx` or `?id=ds_xxx` failed to resolve `datasetId`.
- Express returned `404 Dataset not found.` because `DatasetRegistry.get(undefined)` returned `null`.

### Architectural Solution
Include `req.query?.datasetId || req.query?.id` in the fallback extraction chain:
```javascript
// BEFORE (rbac.js:120)
const datasetId = req.params.id || req.params.datasetId || req.body?.datasetId;

// AFTER (rbac.js:120)
const datasetId = req.params.id || req.params.datasetId || req.body?.datasetId || req.query?.datasetId || req.query?.id;
```

---

## 3.4 Dataset Policy Cleanup on Deletion

### Problem & Failure Mechanism
In `server/src/api/routes/datasets.js`:
```javascript
  DatasetRegistry.remove(dataset.dataset_id);
  AuthRegistry.removeAllGrantsForDataset(dataset.dataset_id);
```
- When a dataset was deleted, its row filters and column denial policies in `data_policies` were never deleted.
- Orphaned security rules remained in SQLite permanently.

### Architectural Solution
Invoke `PolicyStore.removeForDataset(dataset.dataset_id)` during dataset deletion:
```javascript
// BEFORE (datasets.js:99-100)
DatasetRegistry.remove(dataset.dataset_id);
AuthRegistry.removeAllGrantsForDataset(dataset.dataset_id);

// AFTER (datasets.js:99-102)
DatasetRegistry.remove(dataset.dataset_id);
AuthRegistry.removeAllGrantsForDataset(dataset.dataset_id);
PolicyStore.removeForDataset(dataset.dataset_id);
```

---

## 3.5 Test DB Isolation & Windows File-Lock Invariant

### Problem & Failure Mechanism
- In Node on Windows, `better-sqlite3` instantiates open file handles upon module require (`auth.registry.js` and `dataset.registry.js`).
- Tests defining `freshDb()` executed `try { fs.rmSync(config.paths.registryDb); } catch (_) {}`.
- On Windows (NTFS), deleting an open file fails with `EBUSY: resource busy or locked`. The error was silently swallowed by `catch (_) {}`.
- Leftover users (e.g. `admin@rbac.test`) remained across test runs, causing registration calls to return `409 Conflict: An account with this email already exists.`
- The test received `{ token: undefined }` and sent `Authorization: Bearer undefined`, cascading into false `401 Unauthorized` failures across the test suite.

### Architectural Solution
1. **Per-Run Isolated Temp Database**:
   - `server/src/config/env.js`: `config.paths.registryDb` checks `process.env.COGNICORE_TEST_DB_PATH`.
   - `server/tests/helpers/testEnv.js`: generates a unique test database path in `os.tmpdir()` (`cognicore-test-${uuid}.db`).
2. **In-Place Database Truncation**:
   - `server/tests/helpers/testServer.js` exports `cleanTestDb()` and `freshDb()`:
     - Disables foreign keys (`PRAGMA foreign_keys = OFF`).
     - Truncates all application tables in a single transaction.
     - Resets `sqlite_sequence` autoincrement counters.
     - Restores `PRAGMA foreign_keys = ON`.
   - Integration tests (`rbac.test.js`, `hospital-privacy.test.js`, `auth.test.js`) import `freshDb` from `testServer.js`, guaranteeing 100% clean isolation on all operating systems without `EBUSY` locks.

---

## Verification Results

### Unit Test Suite: `tests/unit/domain3-rbac-policy.test.js`
- **Case 1**: `SELECT bonus AS salary FROM employees` -> ALLOW (Alias false positive resolved) (PASS)
- **Case 2**: `SELECT d.salary FROM departments d JOIN employees e ...` -> ALLOW (Qualified ref to unrestricted table) (PASS)
- **Case 3**: `SELECT d.* FROM departments d JOIN employees e ...` -> ALLOW (Qualified wildcard on unrestricted table) (PASS)
- **Case 4**: `SELECT * FROM departments d JOIN employees e ...` -> BLOCK (Unqualified wildcard with denied table in scope) (PASS)
- **Case 5**: `WITH safe_view AS (SELECT employee_id, amount FROM secret_salary) SELECT employee_id FROM safe_view` -> ALLOW (CTE does not reference denied column in outer query) (PASS)
- **Case 6**: `WITH safe_view AS (SELECT amount FROM secret_salary) SELECT amount FROM safe_view` -> BLOCK (CTE denied column leak) (PASS)
- **Case 7**: `WITH safe_view AS (SELECT amount AS safe_amount FROM secret_salary) SELECT safe_amount FROM safe_view` -> BLOCK (CTE denied column via alias) (PASS)
- **Case 8**: `SELECT e.name FROM employees e WHERE e.id IN (SELECT s.employee_id FROM secret_salary s WHERE s.amount > 100)` -> BLOCK (Subquery denied column in predicate) (PASS)
- **Case 9**: `SELECT e.name FROM employees e WHERE e.id IN (SELECT s.employee_id FROM secret_salary s)` -> ALLOW (Subquery safe column) (PASS)
- **Case 10**: `SELECT row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn FROM employees` -> BLOCK (Window function ORDER BY denied column) (PASS)
- **Case C**: `SELECT sub.employee_id FROM (SELECT employee_id FROM secret_salary) sub` -> ALLOW (PASS)
- **Case D**: `SELECT sub.amount FROM (SELECT amount FROM secret_salary) sub` -> BLOCK (PASS)
- **Domain 3.2**: PostgreSQL `public."employees"` and SQLite `main."employees"` CTE base table selection (PASS)
- **Domain 3.3**: `requireDatasetAccess` query string parameter resolution (PASS)
- **Domain 3.4**: `PolicyStore.removeForDataset` cascade (PASS)
- **Domain 3.5**: Windows test database cleanliness and isolation (PASS)

### Integration & Validation Suites
- `server/tests/integration/rbac.test.js`: 15/15 tests passing across consecutive runs.
- `server/tests/integration/hospital-privacy.test.js`: 9/9 tests passing across consecutive runs.
- `server/tests/integration/auth.test.js`: 10/10 tests passing across consecutive runs.
- `validation_workspace/validation/tests/index.js`: **89/89 tests passing (100% pass rate)**.
