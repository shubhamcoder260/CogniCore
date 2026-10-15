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

---

## Step 3 Proposed Deltas (V3: RLS, Column Denial, and Non-SQL Leak Channels)

### Delta V3-01: Disallow Schema-Qualified Table Names & Remap CTE References
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/security/data.policy.js:117-124` & `server/src/structured/sql.validator.js`
- **Current Code**:
  ```javascript
  const cteDefs = Object.entries(tableConditions).map(([table, conds]) => {
    return `"${table}" AS (SELECT * FROM main."${table}" WHERE ${conds.join(' AND ')})`;
  });
  ```
- **Proposed Change**:
  1. In `sql.validator.js`, disallow schema-qualified table names (`main.`, `temp.`) in analytical queries, OR
  2. In `data.policy.js`, normalize and rewrite any `main."table"` references in the user query body to point to the shadowed CTE `"table"`.
- **Rationale**: In SQLite, when a query explicitly qualifies a table name as `main.table` (e.g. `SELECT * FROM main.employees`), SQLite resolves the reference directly to the base physical table in schema `main`, completely bypassing the unqualified CTE shadowing construct. This resulted in a 100.00% leak rate (15 / 15 fixtures, 524 leaked rows) in Step 3 empirical testing.

---

### Delta V3-02: Pre-Filter Schema & Semantic Profiles in LLM Prompt Generator
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.generator.js` and `server/src/core/core.engine.js:48-56`
- **Current Code**: Raw, unfiltered `schema` and `semantic` profiling dictionaries are injected directly into candidate SQL generation prompts.
- **Proposed Change**: Filter `schema.tables[].columns` and semantic profiling metadata against `policy.deniedColumns` before formatting prompt templates.
- **Rationale**: Testing revealed that denied column names were transmitted to the LLM in 255 prompts during candidate SQL generation, violating zero-knowledge prompt isolation invariants.

---

### Delta V3-03: Wrap Dataset Preview Route with Policy Enforcement
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/routes/datasets.js:33-40`
- **Current Code**:
  ```javascript
  const preview = await adapter.preview(limit);
  res.json({ preview });
  ```
- **Proposed Change**: Pass the preview query through `enforcePolicy(query, user, policy)` before execution, or apply column denial and row filtering to the preview result set.
- **Rationale**: `GET /api/datasets/:id/preview` executes raw database preview queries without policy checks, exposing unauthorized rows and denied columns to low-privilege viewers.

---

### Delta V3-04: Apply PII Redaction to Tool Export Endpoints
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/routes/tools.js`
- **Current Code**: Export and report routes stream raw analytical query results directly into CSV, XLSX, and PDF serializers without redaction.
- **Proposed Change**: Call `redactEvidence(rows, user)` on data records before passing them to export serializers.
- **Rationale**: Dossier Part 11 claims PII masking for low-privilege roles on all egress data, but export endpoints omit `redactEvidence()`, leaking unmasked PII.

---

### Delta V3-05: Enforce Data Policy on Empty-Result Diagnostic Probes
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.repair.js:140-160`
- **Current Code**:
  ```javascript
  const probe = await adapter.executeQuery(`SELECT DISTINCT "${col}" FROM "${table}" LIMIT 5`);
  ```
- **Proposed Change**: Wrap diagnostic queries in `enforcePolicy` or restrict diagnostic sampling to the user's authorized CTE view.
- **Rationale**: When a user query returns 0 rows, `diagnoseEmptyResult` probes the database with un-filtered queries, disclosing distinct data values across forbidden rows to low-privilege users.

---

## Step 3b Proposed Deltas (Runtime Non-SQL Verification Hardening)

### Delta V3b-01: Scope Multi-Turn Conversation Context by (sessionId, userId)
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/conversation/session.manager.js:45-65`
- **Current Code**:
  ```javascript
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  ```
- **Proposed Change**:
  ```javascript
  getSession(sessionId, userId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return null;
    }
    return session;
  }
  ```
- **Rationale**: Phase D runtime verification confirmed that supplying an existing `sessionId` belonging to another user retrieves that user's private query turn context across role boundaries. Session retrieval must enforce strict ownership checks.

---

### Delta V3b-02: Cryptographically Secure 128-Bit Session Identifier Entropy
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/conversation/session.manager.js:18-22`
- **Current Code**:
  ```javascript
  generateSessionId() {
    return 'sess_' + Math.random().toString(16).substring(2, 10);
  }
  ```
- **Proposed Change**:
  ```javascript
  const { randomUUID } = require('crypto');
  generateSessionId() {
    return 'sess_' + randomUUID();
  }
  ```
- **Rationale**: Currently generated session IDs offer only 32 bits of entropy ($16^8 \approx 4.29 \times 10^9$ possibilities), making them vulnerable to brute-force session enumeration in multi-user deployments. Using standard UUID v4 provides 122 bits of cryptographically secure entropy.

---

### Delta V3b-03: Filter Column Definitions and Canary Values from Candidate SQL Generator
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/structured/sql.generator.js:48-75`
- **Current Code**: Dumps complete `schema.tables` and column profiling statistics into the system prompt.
- **Proposed Change**: Strip denied columns and un-authorized table metadata prior to building prompt messages. Replace denied columns with masked placeholders or remove them entirely from table schemas passed to the LLM.
- **Rationale**: Phase D empirical testing demonstrated that secret canary values (`CANARY_BAL_SECRET_77777`) embedded in semantic metadata and denied column names were echoed directly into LLM prompts and candidate SQL responses.

---

### Delta V3b-04: Enforce Policy Wrapper on Dataset Preview Route
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/routes/datasets.js:33-40`
- **Current Code**:
  ```javascript
  const preview = await adapter.preview(limit);
  res.json({ preview });
  ```
- **Proposed Change**:
  ```javascript
  const preview = await adapter.preview(limit);
  const sanitized = redactEvidence(preview, req.user);
  res.json({ preview: sanitized });
  ```
- **Rationale**: `GET /api/datasets/:id/preview` executes raw `adapter.preview()` without policy enforcement, leaking unauthorized rows and denied columns to viewer roles.

---

### Delta V3b-05: Redact PII in Export and Reporting Serializers
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/routes/tools.js:80-120`
- **Current Code**: Emits raw query results directly into CSV, XLSX, and PDF serializers.
- **Proposed Change**: Pipe query results through `redactEvidence(rows, req.user)` before streaming into export formatters.
- **Rationale**: Phase D verified that customer PII (e.g., `'Rajesh Sharma'`) is streamed directly into export files for low-privilege roles without scrubbing.

---

## Step 4 Proposed Deltas (V12 File Validator, V13 Input Guard, V14 Authn/Authz, V15 PII Redaction)

### Delta V12-01: Offset-Independent Signature Verification & Executable Text Screening
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/ingestion/file.validator.js:14-35`
- **Current Code**: Inspects magic bytes strictly at offset 0 (`buffer.indexOf(...) === 0`) and allows any file without NUL bytes as text.
- **Proposed Change**: Strip leading BOM and whitespace before checking magic signatures. Screen text-like uploads for executable headers (`#!`, `<?php`, `<script`) and spreadsheet formula triggers (`=`, `+`, `-`, `@`) even when labeled `.csv` or `.json`.
- **Rationale**: Step 4 Phase B evaluations revealed that files prefixed with whitespace or comments bypass offset-0 signature screening, and plain text files with shell scripts or EICAR strings are falsely accepted under `.csv`.

---

### Delta V13-01: Optimize Rate Limiter Cleanup Scan & Multi-Worker Coordination
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/guardrails/rate.limit.js:19-25`
- **Current Code**: Synchronously loops over all entries in `buckets` on every incoming request when `buckets.size > 5000`.
- **Proposed Change**: Replace full Map iteration with an incremental TTL-ordered queue or periodic `setInterval` cleanup (e.g. every 60s). For production, back rate limiting with Redis/Valkey to support multi-worker processes.
- **Rationale**: Step 4 Phase C key-flood evaluations proved that 100,000 unique keys cause $O(N)$ latency spikes per request.

---

### Delta V14-01: Remediate Session IDOR in Session Manager
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/core/session.manager.js:8-14`
- **Current Code**:
  ```javascript
  const existing = SESSIONS.get(sessionId);
  if (existing) return existing;
  ```
- **Proposed Change**:
  ```javascript
  const existing = SESSIONS.get(sessionId);
  if (existing) {
    if (existing.user_id !== userId) {
      throw new Error('Access denied: session belongs to another user.');
    }
    return existing;
  }
  ```
- **Rationale**: Step 4 Phase D IDOR evaluations proved that an authenticated attacker supplying a victim's `sessionId` in `POST /api/chat` attaches to the victim's session and reads their prior conversational turns.

---

### Delta V14-02: Implement Login Rate Limiting and Account Lockout
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/api/routes/auth.js:20-35`
- **Current Code**: `POST /api/auth/login` accepts unlimited requests with no rate limiter and no lockout counter.
- **Proposed Change**: Mount `rateLimit()` middleware on the auth router and add a failed-attempt counter in `AuthRegistry` to lock user accounts after 5 consecutive bad passwords for 15 minutes.
- **Rationale**: Step 4 Phase D brute-force testing executed 20 rapid invalid logins without triggering any rate limit (429) or account lockout.

---

### Delta V15-01: Credit Card Luhn Verification and Comprehensive Egress Redaction
- **Status**: PROPOSED, NOT APPLIED
- **Target File**: `server/src/guardrails/pii.js:12`, `server/src/core/core.engine.js:195`, `server/src/api/routes/tools.js:50-75`
- **Current Code**:
  - `pii.js:12` regex masks all 13-19 digit strings without checking Luhn algorithm.
  - `core.engine.js:195` returns raw `execResult: extra.execResult` in `POST /api/chat`.
  - `tools.js` exports raw query results to CSV, XLSX, and PDF without calling `redactEvidence`.
- **Proposed Change**:
  1. Add Luhn algorithm check to `PATTERNS[1]` in `pii.js` so only genuine credit card numbers are masked.
  2. Redact `publicResult.execResult.rows` before returning chat API responses.
  3. Pass `result.rows` through `redactEvidence` before streaming to `toCsvBuffer`, `toXlsxBuffer`, and `buildPdfReport`.
- **Rationale**: Step 4 Phase E evaluations demonstrated 25.0% false positives on 16-digit tracking IDs, and 100% PII leakage across `execResult.rows`, dataset preview, and tool exports.



