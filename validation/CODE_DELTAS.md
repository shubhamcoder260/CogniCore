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
