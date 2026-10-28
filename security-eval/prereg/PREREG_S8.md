# PREREG_S8 — Resource Exhaustion and Availability

Status: REGISTERED BEFORE RUNNER IMPLEMENTATION (context pack §7 S8, rule 5).
No peer-reviewed benchmark exists for this suite (pack: "build your own"); the battery
below is preregistered before implementation. Reuse: v4c DoS corpus (29 items,
validation/data/v4c/dos_items.jsonl) and v4 boundary corpus (12 items,
validation/data/v4/boundary.jsonl), verified present at HEAD.
NOT RUN here; the operator executes per RUNBOOK_S8.md.

---

## 1. Threat model

- Actor: an authenticated low-privilege user (the only capability needed is 'query').
- Entry surface: the validated-SQL execution chain prepareSql -> validateSql (AST parse,
  tokenizer, complexity gate — MAIN THREAD) -> enforcePolicy -> executeValidatedQuery
  (SQLite: worker thread with terminate-on-timeout).
- Asset: availability and responsiveness of the analysis service; bounded resource use
  (wall time, rows, main-thread event-loop lag).
- Goal (attacker): monopolise CPU (cartesian/recursive/expensive queries), wedge the main
  thread (huge statements through the tokenizer/parser), exhaust memory (huge results),
  or leave the service unresponsive after heavy queries.
- Out of scope: SQL injection content (S1), authorisation (S2), concurrency beyond
  in-process parallel probes; no HTTP load generation (a --base-url probe count exists
  but is opt-in and informational).

## 2. Verified code anchors (HEAD 9cde26c; re-verify per rung)

| Fact | Anchor |
|---|---|
| Per-query worker thread; terminate() on timeout; wall-time rejection | server/src/structured/sql.executor.js:6-68 (:28-36 terminate) |
| Row cap wrap SELECT * FROM (...) LIMIT maxRows; CTE-preserving | sql.executor.js:171-189 |
| Worker: better-sqlite3 readonly:true, fileMustExist, query_only=ON | server/src/structured/sqlite.worker.js:8-10 |
| maxRows 1000 (MAX_RESULT_ROWS), timeoutMs 15000 (QUERY_TIMEOUT_MS) | server/src/config/env.js:40-41 |
| Complexity LIMITS: length 4000, joins 6, subquery depth 4, est. rows 5e9 (env-overridable) | server/src/structured/sql.complexity.js:13-18 |
| Unkeyed cartesian detection incl. COUNT(*) aggregate override and LIMIT<=1000 exemption | sql.complexity.js:171-197 |
| Complexity gate inside validateSql (main thread) | server/src/structured/sql.validator.js:336-342 |
| Engine chain order prepareSql -> validateSql -> enforcePolicy -> executeValidatedQuery | server/src/core/engines/structured.engine.js:82-90 |
| v4c DoS corpus 29 items (recursive CTEs, fan-out classes) | validation/data/v4c/dos_items.jsonl |
| v4 boundary corpus 12 items (join_boundary_6 etc.) | validation/data/v4/boundary.jsonl |

## 3. Fixture and corpora

- setup/12_build_s8_fixture.js emits data/fixtures/s8_availability.sqlite:
  tables s8_t1..s8_t6, 5,000 keyed rows each (aligned integer keys), deterministic text
  payload column; byte-reproducible; SHA-256 pinned in the manifest at run time.
- Generated battery (classes S8-C1..C12 below) is constructed in-code, deterministic,
  and listed in the summary with the exact SQL per class.
- v4c + v4/boundary replay resolves fixture_db bank/B1_community.db exactly like S1-A;
  when the realm fixture is absent the items are recorded SKIPPED_MISSING_FIXTURE
  (honest outcome; mirrors S2-B V3 behaviour). The generated battery never needs realm
  fixtures, so the suite always produces a measurable core.

## 4. Generated battery classes

- C1 keyed fan-out: joins s8_t1..s8_t6 on aligned keys (gate passes; timing measured).
- C2 unkeyed comma join (no WHERE) — positive control: complexity gate must reject.
- C3 CROSS JOIN with LIMIT 1000 — gate passes (limit exemption :178-184); timing of the
  capped retrieval.
- C4 COUNT(*) over CROSS JOIN — positive control: gate must reject (isAggCount :185-186).
- C5 7-table join — positive control: gate must reject (maxJoins 6).
- C6 subquery nesting depth 5 (reject) and depth 4 (accept).
- C7 long statement 3,900 chars (accept; tokenizer/complexity lag measured) and 4,100
  chars (reject maxLength).
- C8 infinite recursive CTE (no terminal condition) — worker must hit the engine timeout
  and be terminated; wall time recorded.
- C9 huge result: SELECT of all 5,000+ rows from s8_t1 without LIMIT — capped at maxRows
  with truncated=true.
- C10 repeated heavy: 5 sequential bounded recursive CTEs (n < 5,000,000 counts) —
  timing distribution, no timeout expected on the reference laptop class.
- C11 concurrent: 8 in-flight bounded CTEs via Promise.all — completion of all, timing.
- C12 health-after: trivial SELECT immediately after C8 (timeout case) must succeed —
  the availability endpoint of record.

## 5. Hypotheses and criteria (preregistered)

- H8-A (gate behaviour at HEAD, quotable): C2, C4, C5, C6-depth5, C7-long are BLOCKED by
  the complexity gate with a SQLValidationError whose message matches the corresponding
  LIMITS reason; C1, C3, C6-depth4, C7-short pass the gate. Criterion: 9/9 exact matches.
  The runner reads the worktree LIMITS at run time and asserts against the recorded env
  values; deviations are FALSIFICATIONS with finding entries, never silent.
- H8-B (worker availability at HEAD, quotable): for C8, outcome = TIMEOUT_WORKER_KILLED
  defined as wall time in [timeoutMs, timeoutMs + 2000] AND no harness watchdog event
  (watchdog = timeoutMs + 5000, per pack §7 S8 "dynamic watchdog = target + 5 s"); AND
  C12 health-after = COMPLETED. Criterion: both hold.
- H8-C (row cap, quotable): C9 returns exactly maxRows rows (capped) with truncated=true.
- H8-D (main-thread responsiveness, criterion preregistered): while validateSql +
  analyzeComplexity + enforceLimit process the C7-short statement, harness event-loop
  drift is sampled at 5 ms; p99 drift <= 100 ms => SUPPORTED; p99 > 100 ms registers
  finding candidate S8-F1 (parser/tokenizer on the main event loop). Distribution
  recorded either way (exploratory percentiles are not PASS claims).
- H8-E (rung characteristics, exploratory — no PASS claims): at 903c3c1 the worker path
  is expected to be absent (probe executeSqliteInWorker) — the runner records
  NOT_APPLICABLE for the termination endpoint and runs the timing classes through the
  engine as found, inside a harness-side worker thread with a kill switch so a blocking
  rung cannot wedge the harness. At 932996b+ the worker timeout endpoint is measurable.
- v4c/boundary replay: outcome taxonomy BLOCKED_COMPLEXITY | BLOCKED_VALIDATOR |
  BLOCKED_POLICY | TIMEOUT_WORKER_KILLED | TIMEOUT_HUNG | COMPLETED |
  SKIPPED_MISSING_FIXTURE | EXECUTION_ERROR; totals must reconcile to 29 + 12.

## 6. Outcome taxonomy, exclusions, statistics

- Per item: outcome, wallTimeMs, harnessLagP99Ms (where measured), engine timeout used,
  first-stop attribution (GATE_COMPLEXITY / GATE_VALIDATOR / POLICY / DRIVER_TIMEOUT /
  COMPLETED), fixture, rung.
- Exclusion: none — every generated item is expected executable at HEAD; items that fail
  to even reach the engine are EXECUTION_ERROR and reconciled in the summary (valid:false
  if any item lacks an outcome).
- Zero-event results (e.g., TIMEOUT_HUNG = 0 at HEAD) get one-sided Clopper-Pearson
  upper bounds. Timing comparisons across rungs are reported as distributions
  (min/p50/p90/p99/max) with explicit "exploratory, no PASS" labels (lesson from the
  withdrawn "linear O(N)" label — S2-C ERRATA).

## 7. NOT RUN declarations

- The whole suite is NOT RUN by the harness author (no validation executions).
- v4c/boundary replay may be SKIPPED_MISSING_FIXTURE on machines without the realm
  fixtures (I2) — recorded per item, never averaged away.
- HTTP concurrency probes: NOT_RUN_HTTP_DISABLED unless --base-url is provided
  (informational only, not part of any criterion).

## 8. Ladder

Rungs: 903c3c1 (synchronous main-thread driver), 932996b (worker + readonly), HEAD.
Per-rung function probes (executeSqliteInWorker, analyzeComplexity presence) are
recorded; layers absent at a rung are NOT_APPLICABLE. Worktrees
../cognicore-ladder/<hash> with node_modules symlinked, removed after each run
(operator executes).
