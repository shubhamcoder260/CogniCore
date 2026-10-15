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

---

# Skipped / NOT RUN (planned experiments not executed, with concrete reason)

1. **Spider & BIRD Dev Gold Benchmarks (`spider-dev` / `bird-dev`)**:
   - *Reason*: Spider and BIRD benchmarks require downloading external multi-gigabyte archives (`spider.zip`) containing hundreds of external SQLite databases and schema JSON files not bundled with the CogniCore repository. In accordance with invariant rules prohibiting arbitrary synthetic mock generation or large unvetted downloads during offline execution, these external benchmarks are marked `NOT RUN`.

2. **External Database Dialects (PostgreSQL and MySQL)**:
   - *Reason*: CogniCore bundles 15 preloaded SQLite database fixtures under `database/`. Testing against PostgreSQL or MySQL without live running database server containers would evaluate synthetic parser mocks rather than genuine execution ground truth. In accordance with Decision 1 (`DECISIONS.md`), dialect scope is restricted to SQLite. Tests requiring external database servers are marked `NOT RUN`.

---

# Could not verify (claims made in docs/paper where code or oracle was missing)

1. **Result Size Memory Cap**:
   - The query executor wraps user queries in an outer `__cognicore_capped` query enforcing `LIMIT maxRows` (default 1000). However, there is no byte-size memory ceiling on the returned rows. A query returning 1,000 enormous text or binary columns could consume unbounded heap memory.

2. **Non-Independent Item Provenance**:
   - While public SQLi payloads from SecLists and PayloadsAllTheThings provide strict external independence, agent-authored attack items and mutation-derived fuzz variants were generated by the validation harness. In accordance with Amendment V4-A3, these items are tracked and reported separately by provenance to avoid circularity.

3. **Cross-Platform Filesystem Differences**:
   - Evaluated on Windows 11 host (`win32 x64`). Windows UNC paths, drive letters, and backslash path conventions were tested. Linux/Unix-specific socket paths or filesystem behaviors remain unverified on this host.
