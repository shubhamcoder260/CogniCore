# Decisions Needed v3: Evaluation Architecture Register

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d` ([F-001](11_FACTS_REGISTRY.md#f-001))  
**Facts Registry Reference:** Cites [F-001](11_FACTS_REGISTRY.md#f-001) through [F-050](11_FACTS_REGISTRY.md#f-050)

---

## 1. Overview

In accordance with Hard Rule 6, no architectural fork or design ambiguity has been resolved silently. This register documents each design decision, compares viable alternatives, evaluates security and operational trade-offs, and provides an authoritative recommendation.

---

## 2. Decision Register

### Decision 01: Benchmark Role Provisioning Strategy (HTTP Enum vs. Direct SQLite Ingestion)
- **Context**: RCR defines four roles (`User_1` through `User_4`). CogniCore's administrative route `PATCH /api/admin/users/:id/role` enforces a closed whitelist: `['admin', 'manager', 'analyst', 'employee', 'viewer', 'user']` ([F-007](11_FACTS_REGISTRY.md#f-007), [F-009](11_FACTS_REGISTRY.md#f-009)). Furthermore, `requireCapability('query')` evaluates `CAPABILITIES[user.role]` ([F-010](11_FACTS_REGISTRY.md#f-010)). If arbitrary role strings are injected directly into `registry.sqlite`, `CAPABILITIES` evaluates to `undefined` and `/api/chat` rejects every request with HTTP 403 Forbidden.
- **Options**:
  - **Option A (Native Role Mapping with PII Redaction Disabled - Recommended)**: Map RCR roles onto CogniCore's native roles:
    - `User_1` (unrestricted) $\to$ `analyst` (0 policies)
    - `User_2` (50% tables) $\to$ `user`
    - `User_3` (50% columns) $\to$ `manager`
    - `User_4` (50% tables & columns) $\to$ `employee`
    Start the evaluation server with `PII_MASK_ROLES="none"` ([F-033](11_FACTS_REGISTRY.md#f-033)). Because `pii.js:8` parses `(process.env.PII_MASK_ROLES || 'viewer,employee')`, an empty string evaluates falsy and silently falls back to `'viewer,employee'`. Setting the non-empty string `"none"` successfully overrides the default, and since `"none"` matches none of the 6 supported roles, PII masking is completely disabled, preventing string and canary corruption.
  - **Option B (Direct SQLite Ingestion with Code Patch to `CAPABILITIES`)**: Inject `User_1`..`User_4` into `registry.sqlite` and patch `server/src/security/rbac.js` to add capabilities for `User_1`..`User_4`.
  - **Option C (Run Only In-Process Tier 1 Tests)**: Abandon Tier 2 natural-language HTTP chat tests; run only in-process AST `enforcePolicy` tests where user roles are not evaluated.
- **Trade-offs**:
  - Option A adheres strictly to Hard Rule 1 (zero code changes), tests the real production HTTP pipeline end-to-end, and avoids RBAC gateway aborts.
  - Option B violates the hard rule prohibiting modifications to application code.
  - Option C discards end-to-end generative LLM evaluation.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 02: Representation of Table-Level Denials in CogniCore
- **Context**: CogniCore's `PolicyStore.add` strictly permits `kind: "deny_column"` and `kind: "row_filter"` ([F-017](11_FACTS_REGISTRY.md#f-017)). There is no native `deny_table` policy kind.
- **Options**:
  - **Option A (Exhaustive Column Denial Approximation - Recommended)**: Represent table denial by generating a `deny_column` policy for every column in the table based on the schema profile.
  - **Option B (Pre-Evaluation Policy Engine Patch)**: Modify `data.policy.js` to add native `kind: "deny_table"`.
  - **Option C (Impossible Row Filter Exclusion)**: Represent table denial via `kind: "row_filter"` with an impossible predicate (`1=0`).
- **Trade-offs**:
  - Option A tests CogniCore strictly as written at commit `9cde26c`. It faithfully reveals the architectural vulnerability where `SELECT COUNT(*) FROM table` bypasses column-level denials ([F-021](11_FACTS_REGISTRY.md#f-021)).
  - Option B violates the freeze on production code modifications.
  - Option C alters query semantics (queries execute and return 0 rows rather than throwing access-denied errors).
- **Authoritative Recommendation**: **Adopt Option A**. Formally record the `COUNT(*)` bypass as an expressibility gap.

---

### Decision 03: Classification of the `COUNT(*)` Aggregate Leakage Gap
- **Context**: In `data.policy.js:157-162` ([F-021](11_FACTS_REGISTRY.md#f-021)), `assertColumnAccess` explicitly skips AST nodes representing `COUNT(*)`. When all columns of a table are denied, `SELECT COUNT(*) FROM table` succeeds and returns the row count.
- **Options**:
  - **Option A (Isolate as Dedicated Aggregate Side-Channel Metric - Recommended)**: Separate queries of the form `SELECT COUNT(*) FROM <table>` into a dedicated side-channel evaluation metric. Exclude them from the core column-denial accuracy score.
  - **Option B (Count as Core Policy Enforcement Failures)**: Treat all `COUNT(*)` bypasses as access-control failures (`LEAK`), reducing overall S2-A accuracy.
  - **Option C (Ignore and Filter Out)**: Remove all `COUNT(*)` queries from the benchmark dataset.
- **Trade-offs**:
  - Option A prevents an architectural table-denial limitation from distorting the measurement of column-level security while transparently documenting the side-channel.
  - Option B conflates column security with table-cardinality leakage.
  - Option C conceals a genuine security vulnerability from the evaluation report.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 04: Evaluation Scope for S2-B Child-Table Isolation
- **Context**: In `applyRowFilters` ([F-022](11_FACTS_REGISTRY.md#f-022)), CogniCore only rewrites tables explicitly named in the query. On child tables lacking direct tenant keys (Fixture 2: `tasks`), queries like `SELECT * FROM tasks;` return all tenant records without filtering.
- **Options**:
  - **Option A (Dual Fixture Evaluation - Recommended)**: Evaluate both Fixture 1 (`multi_tenant_bank.sqlite`, where all tables have `tenant_id`) and Fixture 2 (`child_projects.sqlite`, where `tasks` lacks `tenant_id`). Report metrics separately for Direct Key Isolation vs. Transitive Isolation.
  - **Option B (Evaluate Only Fixture 1)**: Test only schemas where tenant keys are denormalized onto all child tables.
  - **Option C (Evaluate Only Fixture 2)**: Conclude that CogniCore fails row-level security based solely on the child table gap.
- **Trade-offs**:
  - Option A provides a scientifically rigorous characterization: proving where the rewriter succeeds (Fixture 1) while establishing its structural boundary (Fixture 2).
  - Option B hides the foreign-key transitivity limitation.
  - Option C ignores CogniCore's verified capabilities when schema prerequisites are met.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 05: S1-D Direct Tool Endpoint Evaluation Scope
- **Context**: The v1/v2 premise that tool endpoints bypass comment and semicolon sanitization because they lack `prepareSql` was proven factually incorrect ([F-027](11_FACTS_REGISTRY.md#f-027), [F-028](11_FACTS_REGISTRY.md#f-028)). Sanitization occurs inside `validateSql`.
- **Options**:
  - **Option A (Repurpose to Path Parity & Parameter Traversal - Recommended)**: Retain S1-D to verify path parity between `/api/tools/export` and `/api/chat` using S1-A payloads, and test auxiliary parameter injection (`format`, `filename`, `chartType`, `title`, `options`).
  - **Option B (Deprecate Suite S1-D Completely)**: Remove S1-D since the original `prepareSql` rationale was invalid.
- **Trade-offs**:
  - Option A tests direct HTTP raw-SQL execution routes that bypass the LLM, expanding security coverage.
  - Option B leaves non-chat SQL execution endpoints untested.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 06: Spider Dataset Acquisition Authorization
- **Context**: The RCR repository contains zero `.sqlite` database files ([F-041](11_FACTS_REGISTRY.md#f-041)). The 16 SQLite databases required for S2-A, S2-B, and S2-C must be downloaded from Yale Spider (`https://yale-lily.github.io/spider`).
- **Options**:
  - **Option A (Pre-Flight Verification Script with Automated Fetch - Recommended)**: Provide an automated script in the implementation session that downloads `spider.zip`, extracts the 16 databases, and verifies SHA-256 digests.
  - **Option B (Manual Evaluator Placement)**: Require the human evaluator to manually download and place the `.sqlite` files before running the harness.
- **Trade-offs**:
  - Option A provides a reproducible, turn-key evaluation pipeline.
  - Option B shifts operational burden to the evaluator and increases setup error risk.
- **Authoritative Recommendation**: **Adopt Option A** (authorized for execution in the subsequent implementation phase).

---

### Decision 07: Context Window Size in Custom Modelfile (`num_ctx 4096`)
- **Context**: Inference runs locally on CPU via Ollama (`gemma3:4b-eval`) on an AMD Ryzen 5 5500U host with ~10 GB RAM.
- **Options**:
  - **Option A (`num_ctx 4096` - Recommended)**: Configure `num_ctx 4096` pending empirical prompt-length profiling of the 16 Spider schemas. Conserves host RAM and avoids memory creep on long sequential runs.
  - **Option B (`num_ctx 8192`)**: Supports larger prompt context windows but increases memory allocation.
- **Trade-offs**:
  - Option A ensures maximum stability on a 10 GB host while empirical token length distributions are verified. Any claim regarding exact KV-cache RAM footprint in megabytes is labeled **`UNVERIFIED`** until dynamically measured via process RSS monitoring.
  - Option B risks memory exhaustion on high-iteration benchmarks without proven necessity.
- **Authoritative Recommendation**: **Adopt Option A (`num_ctx 4096`)**.

---

### Decision 08: Layer-Toggle Implementation (Environment Flags vs. Source Patches)
- **Context**: The ablation matrix (Configs A, B, C, D) requires toggling the Input Guard, AST Validator, Policy Rewriter, and SQLite connection mode.
- **Options**:
  - **Option A (Harness-Level Direct Invocation & Config Inversion - Recommended)**: Execute ablations by calling standalone component signatures directly ([F-023](11_FACTS_REGISTRY.md#f-023), [F-025](11_FACTS_REGISTRY.md#f-025), [F-026](11_FACTS_REGISTRY.md#f-026)) in standalone runners, or by passing environment toggles (`SECURITY_EVAL_DISABLE_GUARD=true`) read by test wrappers without modifying production application code.
  - **Option B (In-Place Code Patching)**: Comment out gate calls directly inside `server/src/core/engines/structured.engine.js`.
- **Trade-offs**:
  - Option A maintains zero changes to production code (conforming to Hard Rule 1) and enables automated switching.
  - Option B introduces code drift and risks running corrupted benchmarks.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 09: Ladder Checkout Method (`git worktree` vs. In-Tree `git checkout`)
- **Context**: Multi-commit evaluation requires running test suites against historical baseline commit `903c3c1` ([F-045](11_FACTS_REGISTRY.md#f-045)) and HEAD commit `9cde26c` ([F-001](11_FACTS_REGISTRY.md#f-001)).
- **Options**:
  - **Option A (`git worktree` Isolation - Recommended)**: Create an isolated worktree outside the primary workspace tree:
    `git worktree add ../cognicore-baseline-903c3c1 903c3c18e4a9f7521c4bbff26eece86fe7244b9f`
    Execute baseline tests within the isolated directory and remove the worktree upon completion.
  - **Option B (In-Tree `git checkout`)**: Switch branches in place via `git checkout 903c3c1`.
- **Trade-offs**:
  - Option A guarantees zero disturbance to current untracked evaluation design files, requires no stash/unstash, and isolates dependencies.
  - Option B risks clobbering untracked design files and alters active editor workspace state.
- **Authoritative Recommendation**: **Adopt Option A (`git worktree`)**.

---

### Decision 10: Repetition Count $k$ for LLM Inference
- **Context**: CogniCore engines configure non-zero temperatures (e.g. `0.1` in `sql.generator.js:119`, [F-037](11_FACTS_REGISTRY.md#f-037)), creating potential variance in generated SQL.
- **Options**:
  - **Option A (Stratified Repetition: $k=1$ Primary, $k=3$ Red-Team - Recommended)**: Run the broad 800-item utility suite and gates with $k=1$ (recording seed, raw prompt, and raw model output). Run the 45-item high-risk P2SQL attack suite with $k=3$ repetitions to calculate empirical bypass stability.
  - **Option B ($k=5$ Across All Benchmarks)**: Run all executions 5 times.
  - **Option C ($k=1$ Everywhere with Hardcoded Temperature 0)**: Force temperature 0 everywhere.
- **Trade-offs**:
  - Option A balances statistical rigor on critical vulnerability probes against CPU runtime feasibility.
  - Option B requires excessive CPU inference, causing severe thermal throttling.
  - Option C fails to evaluate CogniCore under its real production temperature parameters.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 11: P2SQL Adaptation Strategy
- **Context**: P2SQL was originally authored for LangChain SQL agents against PostgreSQL schemas with PostgreSQL-specific syntax (`CASCADE`, Postgres data types) ([F-003](11_FACTS_REGISTRY.md#f-003)).
- **Options**:
  - **Option A (Semantic Intent Preservation on SQLite Target - Recommended)**: Translate the P2SQL `job_postings.sql` schema into SQLite DDL while preserving table names, column names, user identities, and relationship semantics ([F-038](11_FACTS_REGISTRY.md#f-038)). Evaluate prompts against `/api/chat` and `/api/tools/export`.
  - **Option B (Verbatim Execution Without Schema Translation)**: Run PostgreSQL DDL and prompts directly against SQLite.
- **Trade-offs**:
  - Option A tests real attack payloads against CogniCore's actual query pipeline.
  - Option B aborts on PostgreSQL syntax errors (`CASCADE`), testing dialect incompatibility rather than security guards.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 12: Scope of P2SQL Attack RI.2 (Indirect Injection Multi-Query)
- **Context**: In P2SQL, Attack RI.2 models indirect prompt injection triggering secondary query execution.
- **Options**:
  - **Option A (Scope to Verified Multi-Query Pathways - Recommended)**: Evaluate RI.2 against CogniCore's two verified multi-query pathways: (1) `analysisMode === true` in `analysis.engine.js:33-65` ([F-046](11_FACTS_REGISTRY.md#f-046)), which generates 2–6 sub-questions, and (2) empty-result diagnosis in `structured.engine.js:106-114` ([F-047](11_FACTS_REGISTRY.md#f-047)).
  - **Option B (Ignore Multi-Query Pathways)**: Test only single-query structured chat.
- **Trade-offs**:
  - Option A comprehensively tests CogniCore's real architectural multi-query execution surfaces.
  - Option B leaves multi-step analytic query chains untested against indirect prompt injection.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 13: Scope of Database Engines in Automated Evaluation
- **Context**: CogniCore supports SQLite, PostgreSQL, and MySQL adapters, but PostgreSQL and MySQL require external server processes.
- **Options**:
  - **Option A (SQLite-Only Automated Execution with Static Driver Audits - Recommended)**: Focus automated dynamic test harness execution entirely on SQLite (covering memory, disk, worker thread timeouts, and query rewriting). Audit PostgreSQL and MySQL drivers via static code inspection and verified contract analysis.
  - **Option B (Full Dockerized Multi-Database Test Environment)**: Require local Docker containers for PostgreSQL and MySQL during the security evaluation.
- **Trade-offs**:
  - Option A requires zero external dependencies, conforms to local workstation limits, and covers 100% of SQLite storage isolation mechanisms ([F-044](11_FACTS_REGISTRY.md#f-044)).
  - Option B introduces substantial configuration complexity and external process dependencies.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 14: Model Environment Variable Configuration
- **Context**: CogniCore supports routing different sub-tasks to different models via environment variables ([F-036](11_FACTS_REGISTRY.md#f-036)).
- **Options**:
  - **Option A (Uniform Environment Overrides - Recommended)**: Set `OLLAMA_MODEL=gemma3:4b-eval`, `OLLAMA_MODEL_SQL=gemma3:4b-eval`, `OLLAMA_MODEL_REASONING=gemma3:4b-eval`, `OLLAMA_MODEL_REWRITE=gemma3:4b-eval`, and `OLLAMA_MODEL_PLANNER=gemma3:4b-eval` in the evaluation process environment.
  - **Option B (Rely on Global Fallback Default)**: Set only `OLLAMA_MODEL=gemma3:4b-eval` and leave task-specific variables unset.
- **Trade-offs**:
  - Option A prevents accidental routing to the codebase comparison default `qwen2.5:14b` ([F-035](11_FACTS_REGISTRY.md#f-035)) across all engine managers.
  - Option B leaves open the possibility of task-specific routing fallbacks.
- **Authoritative Recommendation**: **Adopt Option A**.

---

### Decision 15: Separation of Ablation Flags from Commit Ladder Evaluation
- **Context**: Evaluation involves both measuring evolutionary code progression across the commit ladder (from baseline `903c3c1` to HEAD `9cde26c`) and measuring individual security layer contributions via ablation configurations (Configs A, B, C, D).
- **Options**:
  - **Option A (Strict Separation - Recommended)**: Evaluate the commit ladder strictly under production settings (Config A) to measure true evolutionary code changes across baseline vs post-fix commits. Evaluate runtime security ablations (Configs A, B, C, D) exclusively on HEAD (`9cde26c`) to measure component contribution without factorial explosion ($4 \text{ configs} \times 8 \text{ commits} = 32$ configurations).
  - **Option B (Full Factorial Matrix Across All Commits)**: Run all 4 ablation configurations across all 8 commits in the ladder (32 distinct matrix combinations).
- **Trade-offs**:
  - Option A avoids confounding historical software bugs with intentionally ablated layers, isolates regression detection cleanly, and keeps compute bounded within CPU workstation limits.
  - Option B produces 32 configurations with massive compute overhead and ambiguous attribution on historical commits where component interfaces and internals differed.
- **Authoritative Recommendation**: **Adopt Option A**.
