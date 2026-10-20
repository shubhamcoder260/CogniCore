# CogniCore Master Findings & Issues Inventory (45 Issues)

**Document Date:** October 19, 2026  
**Repository Working Directory:** `C:\cognicore\validation_workspace`  
**Target Git Tree:** Commit `e975b89` (Post-Domain-1–6 Fixes)  
**Baseline Git Tag:** `spider-audit-complete` (Commit `d5e4d58`)  
**Scope:** Unified register containing all 30 validation harness benchmark findings plus all 15 newly discovered codebase defects, vulnerabilities, and edge cases.

---

## Executive Count Summary

| Issue Classification | Total Identified | Fixed | Partially Fixed | Unresolved / Open |
| :--- | :---: | :---: | :---: | :---: |
| **Part 1: Validation Harness Register (V3–V15)** | 30 | 6 | 3 | 21 |
| **Part 2: Newly Discovered Issues (NEW-01–15)** | 15 | 0 | 0 | 15 |
| **Total Master Inventory** | **45** | **6** | **3** | **36** |

---

## Part 1: Validation Harness Register (30 Issues)

These 30 issues are derived from the frozen empirical validation benchmark suites (V3, V3b, V3c, V4, V4b, V4c, V4d, V12, V13, V14, V15). Post-fix statuses reflect the empirical re-run recorded in [`validation/results/after/AFTER_FIX_REPORT.md`](file:///C:/cognicore/validation_workspace/validation/results/after/AFTER_FIX_REPORT.md).

| ID | Category | Severity | Current Status | Primary Source Location | Issue Summary & Reproduction SQL / Rationale |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **V3-01** | Data Policy | High | **NOT FIXED** | [`server/src/security/data.policy.js:296-298`](file:///C:/cognicore/validation_workspace/server/src/security/data.policy.js#L296-L298) | SQLite schema-qualification bypass: `SELECT * FROM main.employees;` accesses the underlying physical table directly in SQLite, completely bypassing the unqualified CTE policy shadow view. Leaks: 1,779 / 46,920 (3.79%). |
| **V3-02** | Guardrails | High | **NOT FIXED** | [`server/src/structured/sql.generator.js:48`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.generator.js#L48) | LLM prompt contains unfiltered schema context and canary tokens; columns restricted by column-denial policy are still provided to the model in prompts. Leaked prompts: 255 / 255 (100.00%). |
| **V3-03** | API / Preview | High | **NOT FIXED** | [`server/src/api/routes/datasets.js:41-59`](file:///C:/cognicore/validation_workspace/server/src/api/routes/datasets.js#L41-L59) | Dataset preview endpoint `GET /api/datasets/:id/preview` invokes raw `adapter.preview()` without invoking `enforcePolicy()` or `redactEvidence()`, leaking restricted rows to any user with read access. |
| **V3-04** | API / Export | High | **NOT FIXED** | [`server/src/api/routes/tools.js:80-120`](file:///C:/cognicore/validation_workspace/server/src/api/routes/tools.js#L80-L120) | Tool export routes (`POST /api/tools/export`) stream executed query results directly into CSV/XLSX serializers without applying `redactEvidence()` PII masking. |
| **V3-05** | SQL Checks | Medium | **PARTIALLY FIXED** | [`server/src/structured/result.checks.js:77`](file:///C:/cognicore/validation_workspace/server/src/structured/result.checks.js#L77) | Empty result diagnostic probe: silent destructive query rewriting was removed, but line 77 still executes `SELECT {col} FROM {table}` directly on base tables without RLS, leaking existing values in `issues`. |
| **V3-06** | Data Policy | Medium | **NOT FIXED** | [`server/src/security/data.policy.js:301-304`](file:///C:/cognicore/validation_workspace/server/src/security/data.policy.js#L301-L304) | CTE name collision: when user SQL already defines a CTE with the same name as a shadowed table (`WITH employees AS (...) SELECT * FROM employees`), the resulting concatenated `WITH` statement fails fatally with duplicate CTE name errors. |
| **V3-07** | Data Policy | Medium | **NOT FIXED** | [`server/src/security/data.policy.js:203`](file:///C:/cognicore/validation_workspace/server/src/security/data.policy.js#L203) | PRAGMA introspection: SQLite table-valued functions like `pragma_table_info('table')` are classified as function calls rather than table/column accesses, bypassing column-denial rules. |
| **V3-08** | Sessions | Low | **NOT FIXED** | [`server/src/core/session.manager.js:18`](file:///C:/cognicore/validation_workspace/server/src/core/session.manager.js#L18) | Conversational session IDs are generated with low entropy (32-bit hex slices / `Math.random`) rather than cryptographically secure UUID v4 tokens. |
| **V4-01** | Adapters | High | **NOT FIXED** | [`server/src/ingestion/adapters/sqlite.adapter.js:10`](file:///C:/cognicore/validation_workspace/server/src/ingestion/adapters/sqlite.adapter.js#L10) | Driver-level read-only connection disabled: SQLite connections are opened with `readonly: false`, relying entirely on AST string validation without engine-level read-only isolation. |
| **V4-02** | SQL Validator | Medium | **FIXED** | [`server/src/structured/sql.validator.js:79, 94-98`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.validator.js#L79) | Semicolons and SQL comment delimiters (`--`, `/*`) embedded inside quoted string literals no longer trigger false-rejection syntax errors. False rejections: 0 / 45 (0.00%). |
| **V4-03** | SQL Validator | Medium | **PARTIALLY FIXED** | [`server/src/structured/sql.validator.js:140-163`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.validator.js#L140-L163) | Unknown column validation gate: implemented via `findUnknownColumns()` in shadow mode telemetry; blocking enforcement is conditioned on `ENFORCE_COLUMN_VALIDATION=true`. |
| **V4-04** | Executor | Medium | **PARTIALLY FIXED** | [`server/src/structured/sql.executor.js:49-58`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.executor.js#L49-L58) | Query execution timeout: wired in `sql.executor.js` using `Promise.race`, but better-sqlite3 runs synchronously on the main thread, blocking event loop timeout execution on SQLite. |
| **V4-05** | Adapters | Medium | **NOT FIXED** | [`server/src/ingestion/adapters/sqlite.adapter.js:10`](file:///C:/cognicore/validation_workspace/server/src/ingestion/adapters/sqlite.adapter.js#L10) | Absence of dual-layer connection hardening: neither OS-level read-only file handle flags nor PRAGMA query_only are enforced on database connections. |
| **V4-06** | Complexity | Medium | **NOT FIXED** | [`server/src/structured/sql.complexity.js:52, 58`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.complexity.js#L52) | Comma-join cartesian product bypass: `hasWhereOrOn` evaluates to true if ANY `WHERE` clause exists in the query, allowing unkeyed cartesian joins (`FROM a, b WHERE a.id > 0`) to bypass complexity limits. |
| **V4-07** | SQL Validator | Low | **NOT FIXED** | [`server/src/structured/sql.validator.js:55, 103`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.validator.js#L55) | Dialect parser mismatch: SQLite datasets are parsed using node-sql-parser's `postgresql` grammar, which rejects valid SQLite square bracket identifier syntax (`SELECT [id] FROM [t];`). |
| **V4-08** | SQL Repair | Low | **NOT FIXED** | [`server/src/structured/sql.repair.js:260`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.repair.js#L260) | Integer division repair is restricted solely to aggregate function calls (`COUNT`/`SUM`), leaving bare column divisions (`col1 / col2`) and literal math (`10 / 3`) susceptible to integer truncation. |
| **V4-09** | SQL Validator | Medium | **FIXED** | [`server/src/structured/sql.validator.js:79-86`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.validator.js#L79-L86) | Keyword denylist screening strips string literals prior to checking, allowing queries filtering on keywords (`WHERE action = 'DELETE'`) to pass without false rejection. |
| **V4-10** | Adapters | Low | **NOT FIXED** | [`server/src/ingestion/adapters/sqlite.adapter.js:10`](file:///C:/cognicore/validation_workspace/server/src/ingestion/adapters/sqlite.adapter.js#L10) | `PRAGMA query_only = ON` is reversible via in-band query execution if not locked with driver-level immutable flags. |
| **V4-11** | Adapters | Low | **NOT FIXED** | [`server/src/ingestion/adapters/sqlite.adapter.js:10`](file:///C:/cognicore/validation_workspace/server/src/ingestion/adapters/sqlite.adapter.js#L10) | `VACUUM INTO` arbitrary file write vulnerability remains open whenever write handles are permitted on SQLite connections. |
| **V12-01** | Ingestion | High | **FIXED** | [`server/src/security/file.validator.js:14-35`](file:///C:/cognicore/validation_workspace/server/src/security/file.validator.js#L14-L35) | Magic byte validation and executable script screening (`#!/bin/bash`, `<?php`, ELF/PE) enforced for all file uploads regardless of extension. 468 / 468 malicious payloads rejected (100.00%). |
| **V12-02** | Ingestion | High | **FIXED** | [`server/src/security/file.validator.js:40-65`](file:///C:/cognicore/validation_workspace/server/src/security/file.validator.js#L40-L65) | Path traversal sequences (`../`, `..\`) and control characters in upload filenames are stripped to safe basenames. 100 / 100 traversal attempts neutralized. |
| **V12-03** | Ingestion | High | **FIXED** | [`server/src/documents/zip.reader.js:22-55`](file:///C:/cognicore/validation_workspace/server/src/documents/zip.reader.js#L22-L55) | Decompression bomb protection active: zip compression ratios, uncompressed file sizes, and header offsets are verified before memory allocation. |
| **V13-01** | Guardrails | Medium | **NOT FIXED** | [`server/src/guardrails/rate.limit.js:19-25`](file:///C:/cognicore/validation_workspace/server/src/guardrails/rate.limit.js#L19-L25) | Memory leak / algorithmic complexity: in-memory rate limiter executes synchronous O(N) map sweeps when size exceeds 5,000 entries. |
| **V13-02** | Guardrails | Low | **NOT FIXED** | [`server/src/guardrails/input.guard.js:39`](file:///C:/cognicore/validation_workspace/server/src/guardrails/input.guard.js#L39) | Input length validation uses `String.length` (UTF-16 code units), which penalizes multi-byte Unicode/astral characters (2 code units per character). |
| **V13-03** | Guardrails | High | **FIXED** | [`server/src/guardrails/input.guard.js:65-110`](file:///C:/cognicore/validation_workspace/server/src/guardrails/input.guard.js#L65-L110) | Multi-tier prompt injection screening and instruction neutralization active. Attack block recall: 97.53% [95.53%, 98.65%] with 0.00% false positives on analytical queries. |
| **V14-01** | Core / Auth | High | **NOT FIXED** | [`server/src/core/session.manager.js:8-14`](file:///C:/cognicore/validation_workspace/server/src/core/session.manager.js#L8-L14) | Session IDOR: `getOrCreateSession(sessionId)` returns existing sessions without verifying `session.user_id === req.user.user_id`, allowing users to read and append to another user's session history. |
| **V14-02** | API / Auth | Medium | **NOT FIXED** | [`server/src/api/routes/auth.js:48-67`](file:///C:/cognicore/validation_workspace/server/src/api/routes/auth.js#L48-L67) | Authentication endpoint lacks login attempt rate-limiting, failed login counters, and temporary account lockout. |
| **V15-01** | Guardrails | Medium | **NOT FIXED** | [`server/src/guardrails/pii.js:12`](file:///C:/cognicore/validation_workspace/server/src/guardrails/pii.js#L12) | Credit card regex masks any sequence of 13–19 digits without validating the Luhn checksum, resulting in a 25.0% false-positive rate on benign numeric identifiers. |
| **V15-02** | Core / Egress | High | **NOT FIXED** | [`server/src/core/core.engine.js:195`](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L195) | Egress PII leak: `extra.execResult.rows` returned in the `/api/chat` response payload is not scrubbed by `redactEvidence()`, leaking raw PII to low-privilege roles (`viewer`, `employee`). |
| **V15-03** | Guardrails | Low | **NOT FIXED** | [`server/src/guardrails/pii.js:15-30`](file:///C:/cognicore/validation_workspace/server/src/guardrails/pii.js#L15-L30) | Regex-based PII extraction produces 0.00% recall on unstructured personal names and Indian PAN format identifiers. |

---

## Part 2: The 15 Newly Discovered Issues

These 15 issues were identified through comprehensive source code inspection across all backend modules in `server/src/`. They represent latent vulnerabilities, unhandled exceptions, and functional bugs outside the frozen validation suites.

---

### NEW-01: SSRF & Loopback Bypass in Approved Webhook Execution
- **Severity:** High
- **Category:** Actions / Network Security
- **File & Line:** [`server/src/actions/action.executor.js:58-61`](file:///C:/cognicore/validation_workspace/server/src/actions/action.executor.js#L58-L61)
- **Code:**
  ```javascript
  async webhook(action) {
    const res = await fetch(action.params.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action.params.payload), redirect: 'error', signal: AbortSignal.timeout(10000) });
    return { status: res.status, ok: res.ok };
  }
  ```
- **Defect Mechanism:** While [`action.registry.js:75`](file:///C:/cognicore/validation_workspace/server/src/actions/action.registry.js#L75) checks hostname membership in `ACTION_WEBHOOK_ALLOWLIST`, `action.executor.js` invokes `fetch()` directly without DNS resolution validation or IP pinning. If an allowlisted hostname resolves to a loopback/internal IP address (`127.0.0.1`, `10.0.0.0/8`, `169.254.169.254`) or changes IP via DNS rebinding, internal network endpoints can be probed with caller-controlled JSON payloads.
- **Remediation:** Route webhook requests through the DNS-resolving, IP-pinning HTTP client implemented in [`server/src/ingestion/api.connector.js:161`](file:///C:/cognicore/validation_workspace/server/src/ingestion/api.connector.js#L161).

---

### NEW-02: Silent Conversation State Wipeout from Slicing Raw JSON Strings
- **Severity:** High
- **Category:** Core / Conversation State
- **File & Line:** [`server/src/core/session.state.js:18-22`](file:///C:/cognicore/validation_workspace/server/src/core/session.state.js#L18-L22)
- **Code:**
  ```javascript
  function saveState(sessionId, state) {
    const json = JSON.stringify(state).slice(0, 8000);
    db().prepare(`INSERT INTO session_state (session_id, state_json, updated_at) VALUES (?,?,?)
      ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`)
      .run(sessionId, json, new Date().toISOString());
  }
  ```
- **Defect Mechanism:** Slicing raw JSON text (`.slice(0, 8000)`) truncates the serialized JSON string mid-token whenever conversation state exceeds 8KB (e.g. after multiple turns with evidence previews and SQL queries). In [`getState`](file:///C:/cognicore/validation_workspace/server/src/core/session.state.js#L14), `JSON.parse` encounters truncated invalid JSON, throws a `SyntaxError`, gets swallowed by `catch (_) { return {}; }`, and silently resets conversation history, losing all multi-turn context and follow-up state.
- **Remediation:** Truncate internal arrays and string fields inside the `state` object *before* calling `JSON.stringify()`, rather than slicing the serialized JSON string.

---

### NEW-03: Denial of Service via V8 Call-Stack Overflow on Array Spreading
- **Severity:** High
- **Category:** Tools / SVG Charts / Analytics
- **Files & Lines:**
  - [`server/src/tools/calculate.tool.js:31-32`](file:///C:/cognicore/validation_workspace/server/src/tools/calculate.tool.js#L31-L32) (`Math.min(...numeric)`, `Math.max(...numeric)`)
  - [`server/src/report/chart.svg.js:55, 78`](file:///C:/cognicore/validation_workspace/server/src/report/chart.svg.js#L55) (`Math.min(...xs)`, `Math.max(...xs)`)
  - [`server/src/python/python.tool.js:51`](file:///C:/cognicore/validation_workspace/server/src/python/python.tool.js#L51) (`Math.min(...xs)`)
- **Code:**
  ```javascript
  case 'min': value = Math.min(...numeric); break;
  case 'max': value = Math.max(...numeric); break;
  ```
- **Defect Mechanism:** Spreading an array with more than ~65,536 elements (`...numeric`) into function parameters exceeds V8's call-stack argument limit, throwing `RangeError: Maximum call stack size exceeded`. Queries returning large datasets crash when calculating aggregates or rendering scatter/line SVGs. Additionally, when `xs` is empty, `Math.min()` returns `Infinity`, causing SVG calculations to emit `NaN` attributes.
- **Remediation:** Use `numeric.reduce((min, v) => v < min ? v : min, Infinity)` or iterative `for` loops.

---

### NEW-04: Cross-Tenant Global Prompt Injection via Unscoped Knowledge Base Additions
- **Severity:** High
- **Category:** Knowledge Base / Multi-Tenancy
- **File & Line:** [`server/src/api/routes/knowledge.js:25-34`](file:///C:/cognicore/validation_workspace/server/src/api/routes/knowledge.js#L25-L34)
- **Code:**
  ```javascript
  router.post('/', requireCapability('knowledge.manage'), asyncHandler(async (req, res) => {
    const { scope = '*', kind = 'glossary', term, definition } = req.body || {};
    if (scope !== '*') {
      const ds = DatasetRegistry.get(scope);
      if (!ds || !canRead(req.user, ds)) return res.status(400).json({ error: true, message: 'Unknown dataset scope.' });
    }
  ```
- **Defect Mechanism:** Any user with role `manager` holds `knowledge.manage`. While dataset-scoped knowledge checks `canRead(req.user, ds)`, `scope: '*'` completely bypasses dataset checks. Any manager can post a global (`scope: '*'`) definition that is injected into the SQL-generation prompts of *all* users across *all* datasets via [`OrgKnowledge.renderForPrompt()`](file:///C:/cognicore/validation_workspace/server/src/knowledge/org.knowledge.js#L86).
- **Remediation:** Restrict `scope: '*'` creation strictly to users with `req.user.role === 'admin'`.

---

### NEW-05: IDOR on Organizational Knowledge Entry Deletion
- **Severity:** Medium
- **Category:** Knowledge Base / Authorization
- **File & Line:** [`server/src/api/routes/knowledge.js:36-40`](file:///C:/cognicore/validation_workspace/server/src/api/routes/knowledge.js#L36-L40)
- **Code:**
  ```javascript
  router.delete('/:id', requireCapability('knowledge.manage'), (req, res) => {
    OrgKnowledge.remove(req.params.id);
  ```
- **Defect Mechanism:** `DELETE /api/knowledge/:id` accepts an ID and deletes it without checking whether the requesting user created the record or possesses `manage` rights on the entry's dataset scope. A manager of Dataset A can delete business rules created for Dataset B or global definitions created by admins.
- **Remediation:** Query the entry first; verify that `entry.created_by === req.user.user_id`, or `req.user.role === 'admin'`, or `canManage(req.user, dataset)`.

---

### NEW-06: Missing XML Fencing & Sanitization in Follow-Up Prompt Rewriting
- **Severity:** Medium
- **Category:** Guardrails / Follow-up Resolver
- **File & Line:** [`server/src/core/followup.resolver.js:64-76`](file:///C:/cognicore/validation_workspace/server/src/core/followup.resolver.js#L64-L76)
- **Code:**
  ```javascript
  function buildRewritePrompt(question, state) {
    return `Rewrite the user's follow-up message as ONE complete, standalone question...
  PREVIOUS QUESTION: ${state.lastStandalone || state.lastQuestion}
  FOLLOW-UP MESSAGE: ${question}
  STANDALONE QUESTION:`;
  }
  ```
- **Defect Mechanism:** In direct contravention of the Security Shield invariant in `GEMINI.md`, user-supplied conversation inputs and previous answers are interpolated into LLM prompts without `<untrusted_data>` fences or `neutralizeInjection()`.
- **Remediation:** Wrap all dynamic session values in `<untrusted_data>` boundaries and pass them through [`neutralizeInjection()`](file:///C:/cognicore/validation_workspace/server/src/guardrails/input.guard.js#L52).

---

### NEW-07: Multi-Step Analysis Engine Bypasses Grounding Gate
- **Severity:** High
- **Category:** Core Engines / Grounding Gate
- **File & Line:** [`server/src/core/core.engine.js:120-128`](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L120-L128)
- **Code:**
  ```javascript
  if (routed.routeType === 'ANALYSIS' && routed.answer !== undefined) {
    final = { answer: routed.answer, evidence: routed.evidence, lowConfidence: routed.lowConfidence ?? false };
  } else {
    final = await trace.time('synthesis', ...);
    final = applyGrounding(final, effectiveQuestion);
  }
  ```
- **Defect Mechanism:** The synthesis step in [`analysis.engine.js`](file:///C:/cognicore/validation_workspace/server/src/core/engines/analysis.engine.js#L97) generates an open-ended natural language summary across sub-queries. In `core.engine.js`, `applyGrounding()` is skipped for `ANALYSIS` routes. If the model hallucinates numbers or makes claims contradicting the sub-query evidence, the ungrounded narrative is sent straight to the user without verification.
- **Remediation:** Execute `applyGrounding(final, effectiveQuestion)` unconditionally across all engine routes.

---

### NEW-08: Global Internal Error and Path Leakage in Error Handler Middleware
- **Severity:** Medium
- **Category:** API Middleware / Information Disclosure
- **File & Line:** [`server/src/api/middleware/errorHandler.js:7-15`](file:///C:/cognicore/validation_workspace/server/src/api/middleware/errorHandler.js#L7-L15)
- **Code:**
  ```javascript
  const payload = {
    error: true,
    message: err.message || 'Internal server error',
    name: err.name || 'Error',
  };
  ```
- **Defect Mechanism:** When unhandled 500 exceptions occur (e.g. SQLite database locked, connection pool errors, filesystem ENOENT errors), `err.message` is returned to HTTP clients in production. This exposes internal paths, database table names, and driver details, violating the Security Shield rule against leaking internal data in 500 responses.
- **Remediation:** In production mode (`process.env.NODE_ENV === 'production'`), mask messages on 500 errors to `"Internal server error"`.

---

### NEW-09: TOCTOU Race Condition on Bootstrap Admin Registration
- **Severity:** Medium
- **Category:** Security / Authentication
- **File & Line:** [`server/src/api/routes/auth.js:35-40`](file:///C:/cognicore/validation_workspace/server/src/api/routes/auth.js#L35-L40)
- **Code:**
  ```javascript
  const isFirstUser = AuthRegistry.countUsers() === 0;
  const role = isFirstUser ? 'admin' : 'user';
  const passwordHash = await hashPassword(password);
  const user = AuthRegistry.createUser({ email, passwordHash, name, role });
  ```
- **Defect Mechanism:** Because `countUsers()` is checked before the asynchronous `await hashPassword()` operation, two concurrent registration requests hitting a freshly deployed server both evaluate `isFirstUser === true`, creating two admin accounts.
- **Remediation:** Atomically assign `admin` within a SQLite transaction using `(SELECT COUNT(*) FROM users) == 0`.

---

### NEW-10: Lexer Inversion on Escaped Quotes (`''`) in Integer Division Repair
- **Severity:** Medium
- **Category:** Structured SQL / Repair
- **File & Line:** [`server/src/structured/sql.repair.js:269-271`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.repair.js#L269-L271)
- **Code:**
  ```javascript
  if (ch === "'" && !inString) { inString = true; result += ch; i++; continue; }
  if (ch === "'" && inString) { inString = false; result += ch; i++; continue; }
  ```
- **Defect Mechanism:** In `fixIntegerDivision`, `inString` toggles on every single quote without checking for SQL quote escaping (`''`). For strings containing apostrophes (e.g. `'O''Reilly'`), the second quote causes the lexer to believe it is outside the string. Any slash inside the string (e.g. `'2024/01/01'`) is then wrongly parsed as a division operator, while actual division operators outside the string are ignored.
- **Remediation:** If `ch === "'" && inString && sql[i + 1] === "'"`, consume both quotes and preserve `inString = true` (identical to [`stripLiterals`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.analyzer.js#L68)).

---

### NEW-11: Quoted Identifier Truncation on Standard Escaped Quotes (`""`)
- **Severity:** Medium
- **Category:** Structured SQL / Lexer
- **File & Line:** [`server/src/structured/sql.analyzer.js:37-39`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.analyzer.js#L37-L39)
- **Code:**
  ```javascript
  } else if (ch === '"' || ch === '`') {
    i++;
    let v = '';
    while (i < n && sql[i] !== ch) v += sql[i++];
    i++;
    tokens.push({ t: 'qid', v, s: start, e: i, depth });
  ```
- **Defect Mechanism:** In standard SQL and SQLite, quotes inside quoted identifiers are escaped by doubling them (`"col""name"`). The tokenizer loop stops at the first `ch`, corrupting identifiers with escaped quotes and causing desynchronization across AST validation and column security policies.
- **Remediation:** Support doubled delimiters: `if (sql[i] === ch && sql[i + 1] === ch) { v += ch; i += 2; continue; }`.

---

### NEW-12: Insecure TLS Certificate Verification in PostgreSQL Adapter
- **Severity:** Medium
- **Category:** Ingestion / Connectors
- **File & Line:** [`server/src/ingestion/adapters/postgres.adapter.js:23, 153`](file:///C:/cognicore/validation_workspace/server/src/ingestion/adapters/postgres.adapter.js#L23)
- **Code:**
  ```javascript
  ssl: creds.ssl ? { rejectUnauthorized: false } : false,
  ```
- **Defect Mechanism:** Both the live connection pool and `testPostgresConnection` force `rejectUnauthorized: false` whenever SSL is selected. This disables certificate chain validation, leaving database traffic vulnerable to active machine-in-the-middle interception.
- **Remediation:** Default `rejectUnauthorized` to `true` unless explicitly overridden via configuration.

---

### NEW-13: Main Event-Loop Freezing via Synchronous OCR Execution
- **Severity:** Medium
- **Category:** Documents / OCR Pipeline
- **File & Line:** [`server/src/documents/ocr.js:17-35`](file:///C:/cognicore/validation_workspace/server/src/documents/ocr.js#L17-L35)
- **Code:**
  ```javascript
  const r = spawnSync('pdftoppm', ['-r', '200', '-l', String(maxPages), '-png', pdfPath, path.join(dir, 'p')], { timeout: 300000 });
  ...
  return files.map((f, i) => ({ pageNumber: i + 1, text: ocrImage(path.join(dir, f)) }));
  ```
- **Defect Mechanism:** `ocrPdf` renders up to 60 pages into PNGs via `spawnSync`, then sequentially runs `spawnSync('tesseract')` across all 60 pages on the Node.js main thread. This blocks the single-threaded event loop for several minutes, causing all concurrent HTTP requests to time out.
- **Remediation:** Refactor `ocrPdf` and `ocrImage` to use asynchronous `child_process.spawn()` or worker threads.

---

### NEW-14: Division by Zero and Spurious Fit in Linear Regression
- **Severity:** Low
- **Category:** Analytics / Statistics
- **File & Line:** [`server/src/analytics/stats.js:58-59`](file:///C:/cognicore/validation_workspace/server/src/analytics/stats.js#L58-L59)
- **Code:**
  ```javascript
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
  ```
- **Defect Mechanism:**
  1. When dependent `y` values are constant (e.g. `[10, 10, 10]`), `syy === 0`, and the function returns `r2 = 1`, falsely claiming a 100% fit for invariant data.
  2. When independent `x` values are constant (`sxx === 0`), `(sxy * sxy) / (sxx * syy)` computes `0 / 0 = NaN`. Downstream analytics components receive `NaN` values.
- **Remediation:** Return `r2 = 0` whenever `syy === 0` or `sxx === 0`.

---

### NEW-15: Fatal Execution Failure on Derived Subqueries with Duplicate Column Names in PostgreSQL/MySQL
- **Severity:** Medium
- **Category:** Structured SQL / Executor
- **File & Line:** [`server/src/structured/sql.executor.js:90-95`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.executor.js#L90-L95)
- **Code:**
  ```javascript
  return `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`;
  ```
- **Defect Mechanism:** `enforceLimit` wraps queries inside `SELECT * FROM (...) AS __cognicore_capped LIMIT N`. In PostgreSQL and MySQL, a derived subquery in the `FROM` clause cannot have duplicate column names. Any multi-table join that selects duplicate unaliased column names (e.g. `SELECT users.id, orders.id FROM users JOIN orders ...`) crashes with `ERROR 42701: column "id" specified more than once`.
- **Remediation:** For PostgreSQL and MySQL, append `LIMIT ${maxRows}` to the outermost statement directly rather than wrapping in a derived table subquery when no CTE is present.

---

## Priority Remediation Plan

1. **Phase 1: High-Severity Security Mitigations (NEW-01, NEW-04, V14-01, V15-02)**
   - Protect webhooks against SSRF with IP pinning and DNS filtering.
   - Restrict global knowledge scopes (`scope: '*'`) exclusively to administrative users.
   - Patch session IDOR by verifying user ownership in `getOrCreateSession`.
   - Scrub `extra.execResult.rows` with `redactEvidence` before returning chat responses.

2. **Phase 2: High-Severity Stability & Correctness Fixes (NEW-02, NEW-03, NEW-07)**
   - Eliminate raw JSON string slicing in `saveState` by truncating object properties before serialization.
   - Replace argument-spreading `Math.min(...arr)` with iterative loops across calculate, SVG chart, and analytics tools.
   - Ensure `applyGrounding()` is invoked for all analysis engine synthesis responses.

3. **Phase 3: Lexer, Parser & Connector Hardening (NEW-06, NEW-10, NEW-11, NEW-12, NEW-15)**
   - Add `<untrusted_data>` fences to follow-up rewrite prompts.
   - Fix escaped quote handling in `fixIntegerDivision` and `sql.analyzer.js`.
   - Enable strict TLS certificate validation on PostgreSQL connections by default.
   - Replace derived table wrapping in `enforceLimit` for PostgreSQL and MySQL to prevent duplicate column crashes.
