# CogniCore Validation Limitations Ledger

This document tracks all hypotheses that did not hold, planned experiments that were skipped or not run (with concrete justifications), and documented architectural claims that could not be verified due to missing code or absent runtime environments.

---

# Failed (hypotheses tested that did not hold)

1. **Driver-Level Read-Only Connection Enforcement**:
   - *Claim*: `docs/CODEBASE_DOSSIER.md:12` and architecture diagrams assert "strictly read-only database connections (readonly: true)".
   - *Observed Reality*: `server/src/ingestion/adapters/sqlite.adapter.js:10` explicitly opens database connections with `{ readonly: false, fileMustExist: true }` and sets no read-only pragma (`PRAGMA query_only`). Read-only isolation is not enforced by SQLite or better-sqlite3; protection relies 100% on AST gate coverage.
   - *Reference*: Verified in Phase A (`V4_code_facts.md`) and positive controls.

2. **Query Execution Timeout Enforcement**:
   - *Claim*: `server/src/config/env.js:41` defines `QUERY_TIMEOUT_MS = 15000`.
   - *Observed Reality*: `config.query.timeoutMs` is never wired to SQLite, `better-sqlite3`, or any query execution wrapper in `server/src/structured/sql.executor.js` or `sqlite.adapter.js`. Long-running or recursive queries run synchronously without an engine timeout.
   - *Reference*: Verified in Phase A and Phase E4.

3. **Column-Level Validation Gate**:
   - *Claim*: `server/src/structured/sql.validator.js:8` documents the pipeline as `Table validation -> Column validation -> Read-only execution`.
   - *Observed Reality*: `validateSql` extracts tables and validates tables against `schema.tables`, but performs zero column validation against `schema.tables[].columns`. Queries referencing non-existent columns pass AST validation and fail only at SQLite execution time.
   - *Reference*: Verified in Phase A and positive control analysis.

4. **Literal Boundary-Aware Filtering (False Rejections on Benign Data)**:
   - *Claim*: The SQL validator rejects statement chaining and comments to prevent smuggling.
   - *Observed Reality*: The gate uses naive string regex checks (`sql.includes(';')` and `/--|\/\*/.test(sql)`). These patterns over-reject benign queries where semicolons or comment tokens appear inside valid string literals (e.g. `WHERE city = 'NY; LA'` or `WHERE note = 'Branch -- North'`), producing false rejections on legitimate analytical queries.
   - *Reference*: Verified in Phase E and Phase G.

5. **PostgreSQL Grammar Dialect Mismatch on SQLite Bracket Identifiers**:
   - *Claim*: `server/src/structured/sql.validator.js:38-48` notes that SQLite datasets use `postgresql` parser grammar deliberately to allow scalar subqueries without weakening security.
   - *Observed Reality*: `node-sql-parser` in PostgreSQL mode does not recognize SQLite's native square-bracket identifier quoting (`SELECT [col] FROM [table]`), resulting in 100% false-positive rejection of valid bracketed queries (confirmed in C2 construct analysis and fuzz differential).
   - *Reference*: Verified in Step 2b (Table 2 and Table 6).

6. **Integer Literal Division Promotion Coverage**:
   - *Claim*: `server/src/structured/sql.repair.js:88-106` claims deterministic repair for integer division issues by promoting integer operations to float division (`1.0 *`).
   - *Observed Reality*: The implementation targets only division preceded by `COUNT(...)` or `SUM(...)` aggregates. Bare integer literal divisions (e.g. `10 / 3`) and unaggregated column divisions (`a / b`) are untouched, failing float equivalence (Template T21 in repair property tests).
   - *Reference*: Verified in Step 2b Phase D3.

7. **Keyword Denylist Word-Boundary Screening on Literals & Aliases**:
   - *Claim*: `BLOCKED_KEYWORDS` filters dangerous operations (`DROP`, `DELETE`, `UPDATE`, `CREATE`, etc.).
   - *Observed Reality*: The gate applies a naive word-boundary regex (`new RegExp('\\b' + kw + '\\b')`) against the uppercase SQL string before parsing. This causes 100% false rejection of valid analytical queries where keywords appear legitimately inside string literals (e.g. `WHERE status = 'DROP'`) or quoted column aliases (e.g. `SELECT id AS "delete"`).
   - *Reference*: Verified in Step 2b Phase C1 and Table 2.

8. **Disguised Comma-Join Cartesian Product Bypass in Complexity Analyzer**:
   - *Claim*: `sql.complexity.js:65` claims to detect and reject cartesian products ("it combines tables without a join condition").
   - *Observed Reality*: `sql.complexity.js:58` defines `unkeyedJoin = (crossJoin || (commaJoin && !hasWhereOrOn))`. The mere presence of any `WHERE` token (e.g. `WHERE a.order_id > 0`) sets `hasWhereOrOn = true` and disables cartesian detection, even when the WHERE condition does not relate the tables. Furthermore, `joinCount` only counts the word `join`, treating 7 comma-joined tables as having 0 joins. This allows queries producing 2.025-billion intermediate rows to pass the gate with low complexity scores, locking up the Node.js event loop.
   - *Reference*: Verified in Step 2c (Corpus v4c, Table 2).

9. **PRAGMA query_only=ON Reversible via SQL Injection**:
   - *Claim*: PRAGMA-level hardening provides execution defense-in-depth.
   - *Observed Reality*: `PRAGMA query_only = ON` is an in-band SQLite session setting that can be overridden by executing `PRAGMA query_only = OFF; <write_payload>`. Tested in Phase E, this completely neutralized `query_only = ON` and allowed database mutation. Standalone PRAGMA hardening fails without OS-handle level `readonly: true`.
   - *Reference*: Verified in Step 2c Phase E.

10. **Driver readonly: true Alone Allows Filesystem Exfiltration via VACUUM INTO**:
   - *Claim*: Opening SQLite with `readonly: true` prevents all file modifications.
   - *Observed Reality*: While `readonly: true` prevents mutation to the opened database file, SQLite's query engine permits `VACUUM INTO '<new_path>'` and `CREATE TEMP TABLE` on read-only connections. An attacker bypassing the AST gate could dump the entire database to an arbitrary server file path. Only the combined application of `readonly: true` and `PRAGMA query_only = ON` prevents both data modification and VACUUM exfiltration.
   - *Reference*: Verified in Step 2c Phase E.

11. **SQLite Schema-Qualification Bypass of CTE Shadowing (`main.t`)**:
    - *Claim*: `docs/dossier/part-11-paper-mapping.md:15-16, 51-55` claims "Transparent Zero-Trust Policy Enforcement via CTE Shadowing isolates entire base table at scoping root".
    - *Observed Reality*: `server/src/security/data.policy.js:117-124` rewrites user queries by prepending a CTE: `"${table}" AS (SELECT * FROM main."${table}" WHERE ${conds.join(' AND ')})`. In SQLite, when an incoming query references a schema-qualified table name (e.g. `SELECT * FROM main.employees`), SQLite resolves the qualified reference directly to the base physical table in schema `main`, completely bypassing the unqualified CTE shadowing construct. In Step 3 empirical testing across all 15 database fixtures, schema-qualified queries achieved a 100.00% leak rate (15 / 15 fixtures, Wilson 95% CI: [79.61%, 100.00%]), leaking 524 unauthorized rows.
    - *Reference*: Verified in Step 3 Phase E1, E2, and Table 1.

12. **Unfiltered LLM Prompt Payload Leakage**:
    - *Claim*: `server/src/security/data.policy.js:3-4` asserts "The LLM is never the security layer; data-level security enforced in plain code after SQL is generated".
    - *Observed Reality*: While SQL execution is checked after generation, the candidate SQL generator (`server/src/structured/sql.generator.js:48-56` and `core.engine.js`) transmits unfiltered schema profiles and semantic column facts into the system prompt sent to the LLM before policy enforcement. Denied column names were leaked into 255 prompts evaluated during Step 3 testing.
    - *Reference*: Verified in Step 3 Phase E3 and Table 4.

13. **Unprotected Dataset Preview Endpoint**:
    - *Claim*: Dossier claims complete zero safety leakage across all execution routes.
    - *Observed Reality*: `GET /api/datasets/:id/preview` (`server/src/routes/datasets.js:33-40`) invokes `adapter.preview()` directly against the database adapter with zero policy enforcement, returning live rows including denied columns and unauthorized rows to any viewer role.
    - *Reference*: Verified in Step 3 Phase E3 and Table 4.

14. **Export Endpoints Bypass PII Redaction**:
    - *Claim*: Dossier Part 11 and `core.engine.js:166-170` claim PII masking for low-privilege roles on all API egress data.
    - *Observed Reality*: `/api/tools/export` and `/api/tools/report` (`server/src/routes/tools.js`) export raw CSV, XLSX, and PDF files directly from raw query results without invoking `redactEvidence()`, leaking unmasked PII.
    - *Reference*: Verified in Step 3 Phase E3 and Table 4.

15. **Unenforced Diagnostic Probes (`diagnoseEmptyResult`)**:
    - *Claim*: Dossier Part 7 claims every query and sub-query goes through the full deterministic pipeline.
    - *Observed Reality*: `diagnoseEmptyResult` (`server/src/structured/sql.repair.js:140-160`) issues raw un-filtered database queries (`SELECT ... FROM table`) directly to inspect empty results, bypassing `enforcePolicy` and disclosing data values across forbidden rows.
    - *Reference*: Verified in Step 3 Phase E3 and Table 4.

16. **CTE Table Name Collision Syntax Failures**:
    - *Claim*: `applyRowFilters` transparently handles arbitrary analytical queries.
    - *Observed Reality*: If a user query defines an explicit CTE matching the name of a filtered table (e.g. `WITH employees AS (SELECT ...) SELECT ... FROM employees`), SQLite rejects the query with `duplicate WITH table name: employees` because `applyRowFilters` prepends its own CTE with the identical name without namespace resolution.
    - *Reference*: Verified in Step 3 Phase E1 and Table 1.

17. **PRAGMA Schema Introspection at Policy Layer**:
    - *Claim*: `assertColumnAccess` prevents access to unauthorized column metadata.
    - *Observed Reality*: When evaluated directly at the policy layer, `assertColumnAccess` checks only token identifier occurrences in SQL. PRAGMA queries like `SELECT name, type FROM pragma_table_info('t')` do not name the denied columns in the SQL text, bypassing the check and disclosing the denied column names in 15 / 15 fixtures (100.00%).
    - *Reference*: Verified in Step 3 Phase E2 and Table 2.

18. **Runtime Verification of Dataset Preview Zero-Policy Bypass (D1)**:
    - *Claim*: Dossier asserts all query access paths pass through row/column security policies.
    - *Observed Reality*: Empirically verified against running server handler code (`server/src/routes/datasets.js:33-40`). `GET /api/datasets/:id/preview` invokes `adapter.preview()` directly with zero policy checks, leaking unauthorized rows and denied columns to viewer roles.
    - *Reference*: Verified in Step 3b Phase D1 (`validation/raw/v3_phase_d_evidence.json`).

19. **Runtime Diagnostic Probing of Forbidden Row Values (D2)**:
    - *Claim*: Repair and diagnostic modules operate securely within tenant isolation boundaries.
    - *Observed Reality*: Empirically verified in `server/src/structured/sql.repair.js:140-160`. `diagnoseEmptyResult` issues raw un-filtered queries against the database probing for alternative filter values. In runtime testing, it leaked forbidden values (`['Pune', 'Mumbai', 'Delhi']`).
    - *Reference*: Verified in Step 3b Phase D2 (`validation/raw/v3_phase_d_evidence.json`).

20. **Runtime Tool Export PII Egress (D3)**:
    - *Claim*: API egress endpoints sanitize and scrub PII before transmission.
    - *Observed Reality*: Empirically verified in `server/src/routes/tools.js`. `/api/tools/export` and `/api/tools/report` stream raw query results directly into CSV/XLSX/PDF files without invoking `redactEvidence()`, emitting unmasked customer names.
    - *Reference*: Verified in Step 3b Phase D3 (`validation/raw/v3_phase_d_evidence.json`).

21. **Low-Entropy Session ID & Unscoped Context Exposure (D4)**:
    - *Claim*: Multi-tenant sessions and conversation context are securely isolated per user.
    - *Observed Reality*: Empirically verified in `server/src/conversation/session.manager.js`. Session IDs have only 32 bits of entropy (`sess_` + 8 hex chars), and session context retrieval is unscoped by `userId` or role. User B supplying User A's session ID successfully reads User A's private query turn context.
    - *Reference*: Verified in Step 3b Phase D4 (`validation/raw/v3_phase_d_evidence.json`).

22. **Unfiltered Prompt Compilation Leaking Canaries & Denied Columns (D5)**:
    - *Claim*: Schema and semantic context sent to LLM provider enforces zero-trust boundaries.
    - *Observed Reality*: Empirically verified in `server/src/structured/sql.generator.js:48-56`. `buildPrompt` compiles unfiltered schema tables, column definitions, and min/max stats. Planted canary tokens (`CANARY_BAL_SECRET_77777`) were echoed directly into candidate SQL generation prompts.
    - *Reference*: Verified in Step 3b Phase D5 (`validation/raw/v3_phase_d_evidence.json`).

23. **Non-Deterministic Cartesian Join Tie-Breaks under Un-ordered LIMIT**:
    - *Claim*: Benign queries produce identical ground truth row subsets between physical clone and CTE shadowing.
    - *Observed Reality*: 11 benign Cartesian join queries (`JOIN ... ON 1=1 LIMIT 5`) in the expanded V3b corpus produced row discrepancies against purged clones due to arbitrary B-tree traversal ordering in SQLite when `ORDER BY` is omitted.
    - *Reference*: Verified in Step 3b Phase C (`V3b_RESULTS.md`).

---

# Skipped / NOT RUN (planned experiments not executed, with concrete reason)

1. **Spider & BIRD Dev Gold Benchmarks (`spider-dev` / `bird-dev`)**:
   - *Reason*: Spider and BIRD benchmarks require downloading external multi-gigabyte archives (`spider.zip`) containing hundreds of external SQLite databases and schema JSON files not bundled with the CogniCore repository. In accordance with invariant rules prohibiting arbitrary synthetic mock generation or large unvetted downloads during offline execution, these external benchmarks are marked `NOT RUN`.

2. **External Database Dialects (PostgreSQL and MySQL)**:
   - *Reason*: CogniCore bundles 15 preloaded SQLite database fixtures under `database/`. Testing against PostgreSQL or MySQL without live running database server containers would evaluate synthetic parser mocks rather than genuine execution ground truth. In accordance with Decision 1 (`DECISIONS.md`), dialect scope is restricted to SQLite. Tests requiring external database servers are marked `NOT RUN`.

3. **PostgreSQL Schema-Qualified Bypass Behavior (`public.t`)**:
   - *Reason*: While SQLite schema qualification (`main.t`) was empirically proven to bypass CTE shadowing in 100% of tested fixtures, PostgreSQL behavior for schema-qualified table references (`public.t` or other schema prefixes) is `NOT RUN` due to the absence of a live PostgreSQL server instance in this validation environment. It must NOT be assumed to be "isolated to SQLite", as SQL standard schema resolution rules may similarly resolve schema-qualified relations outside CTE scope.

4. **PRAGMA Table-Valued Function Gate Bypass & Introspection**:
   - *Observed Reality*: `BLOCKED_KEYWORDS` includes `'PRAGMA'`, checked via `new RegExp('\\b' + kw + '\\b')` on uppercase SQL. Because underscore `_` is a word character (`\w`), `\bPRAGMA\b` fails to match `PRAGMA_TABLE_INFO`, `PRAGMA_TABLE_XINFO`, `PRAGMA_DATABASE_LIST`, `PRAGMA_FUNCTION_LIST`, etc. Furthermore, `node-sql-parser` in PostgreSQL mode treats table-valued PRAGMA functions in `FROM` clauses as function calls rather than table references, bypassing table schema verification. In E1 end-to-end execution, these queries pass the gate, pass policy, and execute on SQLite, disclosing denied column names and host filesystem paths.


---

# Could not verify (claims made in docs/paper where code or oracle was missing)

1. **Result Size Memory Cap**:
   - The query executor wraps user queries in an outer `__cognicore_capped` query enforcing `LIMIT maxRows` (default 1000). However, there is no byte-size memory ceiling on the returned rows. A query returning 1,000 enormous text or binary columns could consume unbounded heap memory.

2. **Non-Independent Item Provenance**:
   - While public SQLi payloads from SecLists and PayloadsAllTheThings provide strict external independence, agent-authored attack items and mutation-derived fuzz variants were generated by the validation harness. In accordance with Amendment V4-A3, these items are tracked and reported separately by provenance to avoid circularity.

3. **Cross-Platform Filesystem Differences**:
   - Evaluated on Windows 11 host (`win32 x64`). Windows UNC paths, drive letters, and backslash path conventions were tested. Linux/Unix-specific socket paths or filesystem behaviors remain unverified on this host.
