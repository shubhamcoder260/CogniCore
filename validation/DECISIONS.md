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

