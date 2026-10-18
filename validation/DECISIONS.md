# CogniCore Validation Architectural & Methodological Decisions

This document records all methodological decisions, architectural invariants, and defaults established for the CogniCore scientific validation harness.

---

## Mandated Decisions

### Decision 1: Dialects Claimed
- **Decision**: SQLite only. Postgres and MySQL test evaluations are marked as `NOT RUN` unless an external live server instance is explicitly provisioned and configured.
- **Rationale**: CogniCore ships with 15 SQLite database fixtures preloaded under `database/`. Testing against Postgres/MySQL without real database instances produces synthetic parser mocks rather than genuine execution ground truth. The paper claims SQLite performance; external dialects remain out of scope unless verifiable against a live database container.

### Decision 2: Column Denial Definition
- **Decision**: ANY reference to a denied column in generated or intermediate SQL counts as a security leak/violation. This includes appearances in `SELECT`, `WHERE`, `ORDER BY`, `GROUP BY`, `HAVING`, `JOIN ... ON`, subqueries, and wildcard expansion (`SELECT *`).
- **Rationale**: In zero-trust data governance, column denial is not merely an egress filter on final result sets. Referencing a restricted column in a `WHERE` clause allows boolean inference side-channels (e.g. `WHERE salary > 100000`), and referencing it in `ORDER BY` leaks statistical rank information. Therefore, any syntactic or semantic mention of a denied column constitutes a complete gate failure.

### Decision 3: Independence of Datasets and Test Sets
- **Decision**: The adversarial attack set and the RBAC expected allow/deny matrix must be authored by someone other than the filter and engine authors. In `PREREGISTRATION.md`, both are explicitly designated as `PENDING EXTERNAL AUTHOR`.
- **Rationale**: Handcrafted test suites written by the filter author inherently suffer from circularity (regexes written to match the specific test examples). True zero-trust claims require test inputs to originate from independent security corpora (e.g., PayloadsAllTheThings, Lakera Gandalf, HackAPrompt) or an unblinded external evaluator.

---

## Implementation Defaults Adopted (Step 1)

1. **CommonJS Module Architecture**:
   - The validation harness adheres strictly to CommonJS (`require` / `module.exports`) to match `server/package.json` (`"type": "commonjs"`).

2. **Zero External Dependencies**:
   - All statistical routines (`wilson`, `mcnemarExact`, `holm`, `cohensKappa`, `clusterBootstrap`, `mulberry32`), file parsers, and hashing utilities are implemented using pure JavaScript and Node built-in modules (`node:test`, `node:assert/strict`, `crypto`, `fs`, `path`, `os`, `child_process`). This guarantees deterministic reproducibility without reliance on npm network access or third-party package churn.

3. **Deterministic Pseudo-Random Number Generation (Mulberry32)**:
   - For statistical bootstrapping (resampling database clusters and questions), the harness uses a deterministic 32-bit Mulberry32 PRNG seeded by `MASTER_SEED = 20261015`. This ensures that bootstrap confidence intervals are bit-for-bit identical across repeated evaluations on identical hardware.

4. **Append-Only Immutability Invariant for Raw Logs**:
   - `validation/lib/jsonl.js` enforces strict append-only logging using `fs.openSync(..., 'a')` and `fs.fsyncSync(fd)` after every write. Overwriting or truncating existing `.jsonl` files in `validation/raw/` is prohibited at the API boundary, and path traversal outside `validation/raw/` throws fatal exceptions.

5. **Directory Runner Compatibility (`validation/tests/index.js`)**:
   - In Node 24 on Windows, executing `node --test validation/tests` without an index file fails with `MODULE_NOT_FOUND` as Node expects a module entry point. `validation/tests/index.js` was created to aggregate test suites so that running `node --test validation/tests` executes all unit tests seamlessly.

6. **Missing Probe Value Conventions**:
   - As mandated by the zero-fabrication invariant, any hardware, model, or configuration metric that cannot be directly queried is recorded as `{ value: null, reason: "<concrete explanation>" }` rather than an assumed or placeholder string.

---

## Phase B Decisions (Step 2: V4 SQL Safety Gate)

1. **Dual Driver Architecture for Oracles**:
   - To prevent test coupling, `better-sqlite3@12.11.1` is installed into `validation/package.json` specifically for the oracle verification harness, while the server's existing module instance (`server/node_modules/better-sqlite3`) is probed for runtime compatibility.

2. **Preregistration Immutability & Amendments**:
   - `validation/PREREGISTRATION.md` is strictly frozen at git tag `prereg-v1`. All clarifications, operational definitions, item classifications, and hypothesis criteria refinements are committed to `validation/PREREG_AMENDMENTS.md`.

3. **Item Class Stratification (A, B, C, D)**:
   - Tests are partitioned into Class A (spec-mandated rejections), Class B (unspecified/SELECT-callable probes), Class C (benign valid queries), and Class D (complexity boundary limits). This ensures clear separation between explicit contract violations and dialect edge-case behaviors.

---

## Phase G Decisions (Step 2: V4 Analysis & Reporting)

1. **Bypass Denominator Standardization**:
   - The denominator for the bypass rate is defined strictly as the count of queries *accepted by the gate* ($n_{accepted}$) within that stratum, rather than the total corpus count. This accurately reflects conditional gate failure: given that the gate permitted execution, what proportion resulted in a driver non-read-only state or filesystem/database mutation?

2. **Classification of False Rejections on Class C**:
   - Rejections on Class C are categorized into literal syntax smuggling controls (queries where legitimate punctuation like `;`, `--`, `/*` was present inside string constants) vs. AST parser errors. This ensures precision in identifying that the 9.09% false rejection rate stems directly from regex string-level screening over-reaching into literal data content.

3. **Multi-Oracle Consensus**:
   - Any query accepted by the gate that triggers non-readonly in Oracle 1 (`statement.readonly === false`), or filesystem/data changes in Oracle 2 (`mutationOracle`), or executor mutation in Oracle 3 (`defenseInDepthOracle`) is recorded as a security bypass.

---

## Step 2b Decisions (Evidence Gap Closure & Extended Analysis)

1. **Genuine Write Statement Stratification**:
   - In addition to reporting overall bypass rate across all accepted items, the bypass metric is additionally computed and reported over the specific subset of **genuine write statements** (queries that parse as non-SELECT or contain write/DDL keywords outside quoted string literals). This prevents harmless inert string literals from distorting the denominator or numerator of write execution bypass risk.

2. **Per-Construct False-Rejection Reporting**:
   - False-rejection rates on benign queries (Class C2) are reported strictly per construct (29 distinct language constructs) rather than a single pooled headline rate. This ensures construct-level over-rejection (e.g. 100% rejection on bracket quoting or string literals with comment tokens) cannot be obscured by high acceptance on basic queries.

3. **Strict Child Process Resource Isolation**:
   - All resource-heavy queries (Class B2) are evaluated exclusively in isolated child processes with `--max-old-space-size=1024`, an asynchronous 100ms event-loop heartbeat monitor, and a hard 15-second tree termination deadline (`taskkill /T /F`). In-process execution of unbounded or DoS queries is strictly prohibited to guarantee evaluator host stability.

---

## Step 2c Decisions (Reconciliation, Positive Controls, DoS Corpus v4c, and Hardening)

1. **Script-Generated Reporting Invariant**:
   - To guarantee 100% mathematical consistency and eliminate discrepancies between narrative prose and tables, all Markdown report text in `V4c_RESULTS.md` is generated programmatically from raw log records and computed summary objects via template strings.

2. **Baseline Mutation Dual-Definition**:
   - Baseline mutations for Class A unvalidated bypass items are reported under both execution paths:
     - Path A: Real executor wrapper (`SELECT * FROM (...) AS __cognicore_capped LIMIT 1000`), where SQLite subquery syntax rules reject 7 non-subquery-compatible statements, yielding 26 mutations out of 40 items.
     - Path B: Direct execution (`db.exec(sql)`), yielding 33 mutations out of 40 items.

3. **Positive Controls Prerequisite**:
   - Positive controls must be executed and passing in `validation/tests/` prior to running the v4c evaluation suite: verifying that a 2-second busy-loop registers $\ge 1$ blocked event-loop interval, and a 600 MB native allocation registers peak RSS $\ge 600$ MB in the monitor.

4. **Resource Cap & Hard Kill Deadline**:
   - All v4c DoS runs are monitored by a 100ms RSS poller that triggers an immediate kill if child RSS exceeds 2,048 MB, alongside a 15-second hard tree termination timeout (`taskkill /T /F`).





---

## Step 3 Decisions (V3: RLS, Column Denial, Non-SQL Leak Channels, and Phase 0 Reconciliations)

1. **Phase 0 V4 Loose Ends Reconciliation**:
   - Reconciled the draft 250-item / 113-accepted placeholder: verified from raw JSONL logs that `v4_gate.jsonl` contains 23 Class B items (0 accepted) and `v4b_gate.jsonl` contains 352 Class B2 items (224 accepted). Class C (220 items, 200 accepted) is formally included in the ledger. Total pooled items across all frozen corpora: 2,803 items / 1,107 accepted.
   - Independent Driver-Level Classification: Evaluated across all 2,803 frozen corpus items on an isolated database clone. 2,096 items were `not_executable` (prepare errors), 651 were `executable_readonly` (`statement.readonly === true`), and 56 were `executable_write` (`statement.readonly === false`). Across all 56 genuine executable write statements, gate acceptance was **0 / 56 (0.00%)**, yielding an exact 95% Clopper-Pearson upper bound of **5.21%** (Rule of Three: **5.36%**).
   - Real Executor Wrapper Proof: Proved that `server/src/structured/sql.executor.js` wraps SQL in `SELECT * FROM (...) AS __cognicore_capped LIMIT 1000`. This explains why direct `db.exec(sql)` produces 33 mutations whereas the real executor wrapper produces 26 mutations (due to SQLite subquery compilation errors on DDL/DML statements).
   - Filesystem Coordination File Exclusion: The filesystem mutation oracle explicitly excludes SQLite internal coordination files (`-wal`, `-shm`, `-journal`) when evaluating database and filesystem mutations, confirming that `VACUUM INTO` creates an exfiltrated file under Config 3 (`readonly: true` alone) but is blocked under Config 4 (`readonly: true` + `query_only = ON`).

2. **In-Process Stub LLM Provider**:
   - In accordance with the zero-LLM-call invariant, all end-to-end pipeline evaluations use an in-process stub `llmProvider` that records 100% of incoming prompt text and returns harness-supplied SQL or text responses. No external network requests or LLM API calls are permitted.

3. **Multiset Row Oracle Comparison**:
   - Ground truth row filter verification compares multiset equality between CogniCore's returned rows and the physically purged database clone (`DELETE FROM t WHERE NOT COALESCE((filter), 0)`). Floating-point comparisons enforce relative tolerance $\epsilon = 10^{-9}$.

4. **Column Denial Physical Verification**:
   - To verify column denial independently of the parser, the harness utilizes a Column Drop Oracle: dropping the denied column (`ALTER TABLE t DROP COLUMN c`) on an isolated copy of the fixture schema. Any query whose result or execution depends on $c$ fails or changes output, confirming functional dependence.

5. **Stratification: End-to-End vs Policy-Alone**:
   - Queries are evaluated both end-to-end through the complete CogniCore stack and directly against `enforcePolicy` on a read-only SQLite connection. This decouples upstream gate rejections from underlying policy rewriter defects (such as `main.table` CTE shadowing circumvention).

6. **Deterministic Multi-Column ORDER BY in Evaluation Corpus**:
   - In SQLite, executing queries with `LIMIT` without an explicit unique ordering produces non-deterministic row subsets depending on physical page order and B-tree traversal. To eliminate false-positive discrepancy reports between the baseline clone and the shadowed CTE queries, all queries featuring `LIMIT` in multi-row joins or subqueries include explicit multi-column `ORDER BY` clauses.

---

## Step 3b Decisions (V3/V4 Coverage Expansion, Runtime Verification, and Executable-Write Bound)

1. **Reusable Database Clone Pooling for V3b**:
   - To scale the expanded 1,430-item evaluation without disk I/O thrashing or file lock collisions on Windows, all 15 fixture databases are cloned and pre-purged (one per user/fixture policy pair) and column-dropped once before the run into `scratch/v3b_clones/`. Read-only connections (`{ readonly: true }`) are pooled and reused across queries, reducing total evaluation time to ~11 seconds across 2,860 total executions.

2. **Cluster Bootstrap Resampling Strategy**:
   - Because queries derived from the same base query or fixture exhibit intra-cluster correlation, variance and 95% confidence intervals for pooled leak rates are computed using cluster bootstrapping over 920 distinct base query clusters (1,000 resamples seeded by `MASTER_SEED`).

3. **Verified Executable-Write Corpus Expansion (Corpus v4d)**:
   - To establish a sub-0.5% upper bound on executable-write acceptance, Corpus v4d generated 640 diverse write statements across all 15 fixture databases (DML `INSERT/UPDATE/DELETE/REPLACE`, DDL `CREATE/DROP/ALTER`, and ATTACH/DETACH operations). Every item was independently verified using `better-sqlite3` on an isolated DB clone to confirm `db.prepare(sql)` succeeds and `stmt.readonly === false`. Gate acceptance was 0 / 640 (0.00%, exact 95% upper bound 0.47%). Pooled with Phase 0, overall write acceptance is 0 / 696 (0.00%, exact upper bound 0.43%).

---

## Step 3c Decisions (V3/V4 Gap Audit, LIMIT Reclassification, Path A Reproduction, and Corpus V3c Expansion)

1. **LIMIT Artifact Reclassification via Subquery Containment**:
   - For queries with `LIMIT` and no total `ORDER BY`, multiset equality produces false-positive leak flags due to non-deterministic tie-breaks in SQLite B-tree page order. A returned row constitutes a leak if and only if it is not contained within the oracle's full result computed on the purged database clone without `LIMIT` (multiset subset containment).
   - Subquery containment checking is executed via `SELECT 1 FROM (${sqlNoLimit}) AS __auth WHERE <row_predicate> LIMIT 1` directly on purged clones, avoiding memory pressure and Cartesian product OOMs.
   - Positive control verified: `SELECT "br_id", "br_nm", "city" FROM main."brs" LIMIT 3` against unpurged vs purged clone catches uncontained rows (`Mumbai`, `Pune`), confirming `isContained === false` and catching the leak.
   - Reclassifies V3b E1 leaks from 26 to 15 / 1,430 (1.05%, 95% bootstrap CI [0.48%, 1.68%]), and E2 leaks from 41 to 30 / 1,430 (2.10%).

2. **Path A Real Executor Reproduction & Mutation Reconciliation**:
   - Confirmed that running `DELETE`, `DROP TABLE`, `INSERT`, `CREATE TABLE`, `UPDATE` through the project's own `executeValidatedQuery` results in `near "<KEYWORD>": syntax error` due to the outer `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}` subquery wrapper. Database hashes before and after were byte-for-byte identical (`Mutated: false`).
   - Reconciled with reported "26 mutations vs 0/40": Direct raw execution `db.exec(sql)` produces 33 mutations; compound/subquery-compatible contexts produce 26 mutations; passing top-level statements directly through the real executor's subquery wrapper blocks all 40 unvalidated top-level write items (0 mutations).

3. **Introspection End-to-End & Regex Boundary Mechanics**:
   - Discovered that `BLOCKED_KEYWORDS` regex `\bPRAGMA\b` fails on `pragma_table_info` because underscore `_` is a word character (`\w`), preventing word boundary matching.
   - Table-valued PRAGMA functions pass gate and policy and execute against SQLite, disclosing denied column names and host filesystem paths.

4. **Corpus V3c Systematic Row-Variant Expansion (46,920 items)**:
   - Expanded evaluation across all 920 base queries (380 benign + 15 fixture + 525 grammar) x 17 variant forms x 3 users = 46,920 items.
   - Evaluated under E1 and E2 with subset containment rule, yielding 1,720 leaks / 46,920 (3.67% [3.41%, 3.93%]).

5. **TARGET_REPO Environment Abstraction & Secondary Worktree Verification**:
   - Built support for `TARGET_REPO` into `validation/lib/config.js` with path resolution fallbacks for uncommitted fixture databases and node_modules.
   - Verified via smoke test on a secondary git worktree (`../validation_worktree_smoke`).

6. **Heartbeat Event-Loop Block Threshold**:
   - Defined blocked event-loop threshold as `gap > 1000 ms` (missed 10 heartbeats on a 100ms interval).
   - Maximum event-loop gap on B2 resource queries was 695ms on `printf_expansion` (0 blocked), whereas v4c DoS queries registered gaps up to 15,235ms (16 blocked).

---

## Step 4 Decisions (V12 File Validator, V13 Input Guard, V14 Authn/Authz, V15 PII Redaction)

1. **Module V12 (File Validator) Evaluation Protocols**:
   - Magic signature verification evaluated strictly at buffer offset 0 vs post-BOM and post-whitespace offsets.
   - Independent central directory zip parser built into harness to verify declared vs actual uncompressed entry sizes and compression ratios.
   - Sandbox directory write containment verified for all accepted uploads via filesystem snapshots, ensuring sanitized filenames remain strictly within the target upload directory.

2. **Module V13 (Input Guard & Rate Limiter) Evaluation Protocols**:
   - Prompt length boundary verified against UTF-16 code units (enforced by `q.length > 4000` at `server/src/guardrails/input.guard.js:35`).
   - Sourced external test split from `deepset/prompt-injections` (116 items) directly from Hugging Face hub with verified SHA-256 hash.
   - Sliding window rate limiter evaluated under real local HTTP loop and mock timers; memory scaling tested across 100,000 unique keys.

3. **Module V14 (Authentication & Authorization) Route Sweep Protocols**:
   - Comprehensive route sweep executed across all 63 routes and 15 router modules discovered in `server/src/api/routes/`.
   - Since `validation/data/rbac/expected.csv` is absent, emitted `expected_TEMPLATE.csv` with blank `expected_allow` column and formally marked RBAC matrix check as **NOT RUN**.
   - Swept IDOR vectors on dataset access, conversational sessions, trace audit logs, and file downloads.

4. **Module V15 (PII Redaction) Evaluation Protocols**:
   - Evaluated redaction performance across all 5 roles (`viewer`, `employee`, `analyst`, `manager`, `admin`) and all 9 API/system egress channels.
   - Evaluated precision against 120 benign numerical identifiers (order IDs, 16-digit tracking codes, dates, currencies) to detect false masking.
   - Documented out-of-scope identifier formats (Aadhaar, PAN, person names) and unmasked export channels (CSV/XLSX/PDF) as verified architectural scope gaps.

---

## Step 5 Reconnaissance Decisions (Design, Profiling, and Invariants for V1/V2 Evaluation)

1. **`runStructuredQuery` as Governed Harness Entry Point (V1)**:
   - To benchmark text-to-SQL generation directly under full CogniCore governance (`generateSql` $\rightarrow$ `cleanSqlOutput` $\rightarrow$ `prepareSql` $\rightarrow$ `validateSql` $\rightarrow$ `enforcePolicy` $\rightarrow$ `executeValidatedQuery`), the harness invokes `runStructuredQuery` ([server/src/core/engines/structured.engine.js:36](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L36)). This accepts a dependency-injected `llmProvider` without mutating module singletons, bypasses intent classifier regexes and agent tool interception in `core.engine.js`, and disables the 20-second markdown answer synthesis LLM call (`composeAnswer`), reducing evaluation latency from ~4.4s to ~2.5s per query.

2. **Mandatory Context Window Configuration (`num_ctx: 4096`)**:
   - Auditing all 15 fixture databases revealed that `H3_metropol` consumes 1,694 prompt tokens (82.7% of 2048). At Ollama's default context limit (2,048 tokens), recovery prompts (+150-250 tokens) risk context overflow and silent truncation. The harness must pass `options: { num_ctx: 4096 }` on all Ollama completion calls.

3. **Dedicated Raw Execution Wrapper (C0)**:
   - Mini-pilot testing confirmed that local LLMs wrap SQL in markdown code blocks (` ```sql ... ``` `) 100% of the time and include conversational filler 41.7% of the time under DDL prompts, causing direct SQLite execution to fail 100% of the time. The C0 harness extracts SQL via standard fence stripping and semicolon isolation before execution. Both C0 and V1 execute against identical SQLite database files with identical 1,000-row limits.

4. **Value-Set Metric for NL2SQL Ground Truth Comparison**:
   - Because LLMs frequently introduce valid column aliases (`AS avg_bal` vs `AVG(bal)`) or select equivalent expressions (`COUNT(acct_id)` vs `COUNT(*)`), strict JSON key equality produces false negatives. Step 5 evaluation must compare canonical row value sets (multisets of projected values) rather than raw JSON key-value objects.

5. **Formal Exclusion of 12 Reconnaissance Pilot Items**:
   - The 12 questions evaluated during R10 (`RECON-B1-01` through `RECON-H1-04`, covering counts, filters, joins, and aggregations across `B1_community`, `F1_quickbite`, and `H1_clinic`) are formally documented in `STEP5_RECON.md` along with their SHA-256 hashes and must be excluded from Step 5 experimental evaluation corpora.





---

## Step 5 Decisions (Spider V1 Benchmark Evaluation: Pilot Verification & Staged Main Run)

1. **Spider Benchmark Scope & Frozen Corpora**:
   - Evaluates the Spider V1 text-to-SQL development benchmark on frozen, verified artifacts (`frozen_sample_300.jsonl` SHA-256: `EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC`; `pilot.jsonl` SHA-256: `30D32F4F37E809182866B02BBF4781F34B9FA2115C02EA6B37BA2F26EF6EB068`).
   - The frozen 300-question sample is strictly quarantined from any model evaluation until operator launch via `run_spider_main.ps1`.

2. **Run Isolation & Database Invariance Verification**:
   - Every evaluation run creates fresh disposable copies under `cognicore_spider/runs/<run_id>/`:
     - `ro/` copy for C0 baseline and gold verification (`?mode=ro`, `PRAGMA query_only = ON`).
     - `gov/` copy for `ingestFile` and governed C4/C4nr execution.
   - Logical content hashes are computed before and after execution using `con.iterdump()` normalized SHA-256 with `text_factory = lambda b: b.decode('utf-8', errors='replace')` to guarantee determinism across non-UTF-8 characters. Any database modification constitutes an immediate run invalidation. In the 30-question pilot, 0 / 20 databases were modified.

3. **Execution Supervisor & Wall-Clock Timeout**:
   - The supervisor enforces a strict 60-second external wall-clock timeout per unit via process tree termination (`taskkill /T /F`). Timed-out units are scored as abstained/incorrect (`correct: 0`), duration >= 60,000 ms, and reported separately.

4. **Scoring Engine Specifications**:
   - Multiset equality of row tuples: column names are ignored, floating-point numbers are compared with relative tolerance `1e-6`, strings exact (case-sensitive), NULL equals NULL, and distinct types (integer vs string) are distinguished.
   - Ordered comparison is enforced ONLY when `order_unique == 1` (gold query has top-level `ORDER BY`, sort keys are output columns, and adjacent gold result rows contain no equal sort keys).

5. **Pilot Gate Verification & Staged Readiness**:
   - The 30-question pilot passed all 9 architectural gates (G1 through G9), demonstrating:
     - C0 accuracy = 50.0% (15/30) within the sanity band [20%, 85%].
     - C4nr accuracy = 56.7% (17/30).
     - C4 accuracy = 60.0% (18/30).
     - Multi-turn error recovery triggered 2 times and succeeded 1 time (`spider-dev-353`).
     - Zero database modifications across 20 databases.
     - 100% LLM cache reproducibility (5/5 hits, 0 misses).
   - Staged launch script `validation/run_spider_main.ps1` prepared for operator execution of the frozen 300-question sample.


---

## Step 5 Post-Run Audit Decisions (Spider V1 Post-Run Verification & Held-Out Sample B)

1. **Secondary Held-Out Sample B Freezing Protocol**:
   - Sample B (`frozen_sample_300_B.jsonl` SHA-256: `D1A35A18559C06393C1A36046674E619AB0B6604428E96BFAF5DBA80940D3B09`) was frozen from unused indices 401..1034 in `pool_order.json` strictly BEFORE inspecting any item-level discordances or outcomes of Sample A.
   - Applied identical eligibility rules: executes twice identically in Python read-only mode, < 1,000 rows, no LIMIT without ORDER BY, DB file exists.
   - Zero model calls performed on Sample B. Zero overlap with Pilot, Candidates, or Sample A.

2. **Three-Way Outcome Taxonomy & Selective Accuracy**:
   - Units partitioned into: Correct, Wrong-Executed, and Abstained by Cause (validator rejection with rule name, NO_QUERY_POSSIBLE, runtime error split into dqs_failure vs other, timeout, infra_error).
   - Selective accuracy defined strictly as `correct / answered` where `answered = (correct + wrong_executed)`.
   - Results: C0 raw 63.7% / selective 67.0%; C4nr raw 60.0% / selective 61.6%; C4 raw 60.0% / selective 61.2%.

3. **Value Normalization Classification Mechanics**:
   - `LOWER(TRIM(` rewriting occurs via `server/src/structured/result.checks.js:81` (`empty_result_diagnosis`), which triggers when initial query produces 0 rows.
   - In Spider evaluation, all 7 occurrences in C4 were in `flight_2` and all 7 failed against Spider gold query expectations. In C0, 0 occurrences were present.

4. **Layer Replay Protocol (Exploratory)**:
   - Evaluated step-by-step pipeline without model calls from cached completions: S1 (`cleanSqlOutput`), S2 (`prepareSql`), S3 (`validateSql`).
   - S3 achieved 97.3% agreement (292/300) with logged C4nr units; all 8 mismatches were traced to `empty_result_diagnosis` in `flight_2` converting an empty result into an executed non-empty result against a DQS-failed gold query.

5. **Correction of Analytical Overstatements in SPIDER_V1_FINAL_REPORT.md**:
   - Documented and corrected 4 unsupported claims:
     1. "+1 in 18 of 19 databases" was an arithmetic sign error: C4 actually trailed C0 by -3 items across the 18 databases (169 vs 172).
     2. "Zero schema hallucinations" was refuted by runtime errors where C4 hallucinated columns in `course_teach`, `student_transcripts_tracking`, `car_1`, and `concert_singer`.
     3. "54% fewer exceptions" reflected query execution errors reaching final output (13 vs 6), but did not translate into increased prediction accuracy.
     4. "232 ms latency" was an artifact of in-memory LLM cache reuse from C4nr; true uncached latency is ~4.4–7.0 seconds.
