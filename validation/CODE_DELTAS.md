# CogniCore Proposed Code Deltas (Step 2: V4 SQL Safety Gate)

In accordance with validation protocol rules, **NO CHANGES HAVE BEEN APPLIED** to `server/` or `src/`. The original source tree remains completely unmodified. All entries below are recorded as **"PROPOSED, NOT APPLIED"** for upstream consideration based on Phase A and Phase E findings.

---

### Delta V4-01: Enforce Read-Only Database Connection at Driver Layer
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/ingestion/adapters/sqlite.adapter.js:10-12`
- **Current Code**:
  ```javascript
  this.db = new Database(this.location, { readonly: false, fileMustExist: true });
  this.db.pragma('journal_mode = WAL');
  ```
- **Proposed Change**:
  ```javascript
  this.db = new Database(this.location, { readonly: true, fileMustExist: true });
  this.db.pragma('query_only = ON');
  ```
- **Rationale**: The architecture documentation repeatedly claims "strictly read-only database connections". Currently, read-only is explicitly disabled (`readonly: false`), meaning database integrity relies 100% on AST gate coverage. Enabling driver-level read-only guarantees kernel/engine defense-in-depth even if an AST bypass occurs.

---

### Delta V4-02: String Literal Boundary-Aware Comment & Semicolon Screening
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.validator.js:83-88`
- **Current Code**:
  ```javascript
  if (sql.includes(';') && sql.trim().indexOf(';') !== sql.trim().length - 1) {
    throw new SQLValidationError('Multiple statements are not allowed.');
  }
  if (/--|\/\*/.test(sql)) {
    throw new SQLValidationError('SQL comments are not allowed.');
  }
  ```
- **Proposed Change**: Replace naive string regex checks with tokenized boundary checks using `tokenize(sql)` or the AST parser's tokenizer, so that semicolons, `--`, and `/*` inside quoted string literals (e.g., `WHERE note = 'Branch -- North'` or `WHERE city = 'NY; LA'`) are permitted.
- **Rationale**: In Phase E evaluations, this naive regex accounted for false-positive rejections of valid analytical queries containing legitimate business punctuation inside data values.

---

### Delta V4-03: Implement Missing Column Validation Gate
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.validator.js:107-127`
- **Current Code**: Only tables are checked against `schema.tables`. Columns are never validated.
- **Proposed Change**: Extract referenced columns via AST column walker and validate each column against `schema.tables[].columns` for known tables.
- **Rationale**: `sql.validator.js:8` explicitly claims the pipeline does `Table validation -> Column validation`, but the validator omits column checking entirely.

---

### Delta V4-04: Wire Configured Query Timeout to Execution
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.executor.js` and `server/src/ingestion/adapters/sqlite.adapter.js`
- **Current Code**: `config.query.timeoutMs = 15000` is defined in `server/src/config/env.js:41` but is never passed to SQLite or wrapped in an asynchronous execution deadline.
- **Proposed Change**: Implement an execution timer or SQLite progress handler (`sqlite3_progress_handler` via better-sqlite3) to abort queries that exceed `timeoutMs`.
- **Rationale**: Unbounded recursive CTEs or CPU-heavy queries can block the Node.js event loop indefinitely.

---

### Delta V4-05: Dual-Layer Defense Connection Hardening (OS Handle + Engine PRAGMA)
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/ingestion/adapters/sqlite.adapter.js:10-14`
- **Current Code**:
  ```javascript
  this.db = new Database(this.location, { readonly: false, fileMustExist: true });
  this.db.pragma('journal_mode = WAL');
  ```
- **Proposed Change**:
  ```javascript
  this.db = new Database(this.location, { readonly: true, fileMustExist: true });
  this.db.pragma('query_only = ON');
  this.db.pragma('journal_mode = WAL');
  ```
- **Rationale**: Phase E empirical evaluations proved that neither defense alone is sufficient:
  1. `readonly: true` alone allows `VACUUM INTO 'target.db'` (exfiltrating database data to an arbitrary server path) and `CREATE TEMP TABLE`.
  2. `PRAGMA query_only = ON` alone can be bypassed and flipped back by executing `PRAGMA query_only = OFF; <write>`.
  3. Only the combination of both (`readonly: true` + `PRAGMA query_only = ON`) completely prevents mutation, exfiltration via `VACUUM INTO`, and PRAGMA reset bypasses, while retaining full compatibility with WAL mode and analytical queries.

---

### Delta V4-06: Fix Comma-Join Disguised Cartesian Products in Complexity Gate
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.complexity.js:29, 58, 63`
- **Current Code**:
  ```javascript
  const joinCount = words.filter((w) => w === 'join').length;
  // ...
  const unkeyedJoin = (crossJoin || (commaJoin && !hasWhereOrOn));
  // ...
  if (joinCount + (commaJoin ? 1 : 0) > LIMITS.maxJoins) ...
  ```
- **Proposed Change**:
  1. Count comma-separated tables in the `FROM` list as distinct joins: each table beyond the first adds 1 to `joinCount`.
  2. Validate that `WHERE` predicates actually relate the joined tables (e.g. `t1.id = t2.id`) rather than treating ANY keyword `WHERE` (e.g. `WHERE a.id > 0`) as a join condition.
- **Rationale**: Phase D evaluations demonstrated that 7-table comma joins with unrelated WHERE clauses completely bypass the complexity gate (`joinCount: 0`, `unkeyedJoin: false`), resulting in 2.025-billion row Cartesian explosions that crash or hang the Node.js process.
