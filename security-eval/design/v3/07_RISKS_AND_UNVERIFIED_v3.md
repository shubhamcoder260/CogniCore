# Risks, Unverified Claims & Invariants Register v3

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d` ([F-001](11_FACTS_REGISTRY.md#f-001))  
**P2SQL External Repository Commit:** `ff5a0226b6c63407ae19ba5567ae251b51d4f98e` ([F-003](11_FACTS_REGISTRY.md#f-003))  
**RCR External Repository Commit:** `9179b2ec6d84df56803cbbeb2650cd86b7c1b56f` ([F-005](11_FACTS_REGISTRY.md#f-005))

---

## 1. Executive Summary

This register formalizes all residual operational, statistical, and architectural risks identified during the v3 consolidation of the CogniCore security evaluation design. In strict conformance with Hard Rules, no external repositories have been extracted to disk, no model inference has been executed, and no local databases have been initialized. All unobservable attributes remain categorized as `UNVERIFIED`.

---

## 2. Unverified Items Register

Under Hard Rule 5, any claim that cannot be verified by read-only inspection of the local workspace and local clone directories is designated as **`UNVERIFIED`**:

1. **`UNVERIFIED: Spider SQLite Database Schema Alignment`**:
   - The upstream Yale Spider SQLite database archive (`spider.zip`) has not been downloaded or extracted (Hard Rule 1).
   - Whether table and column names in the official Yale Spider `.sqlite` files match the casing and constraints in RCR schema DDL (`data/spider/SCHEMA.md`) cannot be empirically verified until data acquisition. Any case-sensitivity discrepancies under SQLite's identifier rules could induce false syntax or column errors.
2. **`UNVERIFIED: Ollama Gemma-3 4B Execution Accuracy and Latency on Host`**:
   - Running inference commands or starting local LLM engines is prohibited during this design phase.
   - The baseline execution accuracy ($EX$) on Spider prompts, valid SQL generation rate, token generation throughput (tokens/sec), and exact inference latency for `gemma3:4b` on the local AMD Ryzen 5 5500U CPU remain unmeasured.
3. **`UNVERIFIED: Native Postgres and MySQL Driver Runtime Behavior`**:
   - `server/src/ingestion/adapters/postgres.adapter.js` and `server/src/ingestion/adapters/mysql.adapter.js` have been inspected statically, but live execution against PostgreSQL or MySQL instances cannot occur because no external servers are provisioned. Multi-statement query execution and driver-specific error codes remain verified by code inspection only.
4. **`UNVERIFIED: Automated P2SQL Prompt Corpus Runtime Distribution (RQ3)`**:
   - While `scratch/P2SQL/RQ3/red-team/dataset/prompts.csv` was verified to contain 17,099 rows ([F-040](11_FACTS_REGISTRY.md#f-040)), the automated generation scripts under `scratch/P2SQL/RQ3/automated/` have not been executed. The exact runtime success distribution across automated variants remains unmeasured.
5. **`UNVERIFIED: Ollama KV-Cache Memory Allocation`**:
   - The exact resident set size (RSS) memory consumption in megabytes for Ollama's KV-cache under `num_ctx 4096` or `num_ctx 8192` on this specific Linux kernel has not been dynamically measured; theoretical estimates are omitted until live process profiling occurs.
6. **`UNVERIFIED: Validation Benchmark Producing Git Commits`**:
   - Although `validation/MANIFEST.json` and fix reports record specific milestone commits (`20a2164`, `6f2dd4c`, `d053729`, `8205910`, `965ba48`, `971d171`), raw JSONL files in `validation/raw/*.jsonl` omit git commit hashes in their item metadata.

---

## 3. Architectural & Design Flaws in Target Codebase

Grounding inspection of the CogniCore codebase at commit `9cde26c` confirmed several architectural limitations that impact evaluation design and security boundaries:

### 3.1 Table Denial Expressibility Gap ([F-017](11_FACTS_REGISTRY.md#f-017))
- **Code Reality**: `server/src/security/data.policy.js:43` strictly permits only `deny_column` and `row_filter`. Passing a table denial throws an unhandled error: `"Policy kind must be 'deny_column' or 'row_filter'"`.
- **Evaluation Impact**: S2 test cases that specify whole-table denial must be simulated in CogniCore by registering exhaustive `deny_column` policies for every column in the target table schema (Decision D-02).

### 3.2 Wildcard Aggregate Leakage via `COUNT(*)` ([F-021](11_FACTS_REGISTRY.md#f-021))
- **Code Reality**: `server/src/security/data.policy.js:157-162` explicitly returns early on `COUNT(*)` or `COUNT(1)` without performing column access checks (`assertColumnAccess`).
- **Evaluation Impact**: An attacker can infer table cardinality and confirm the existence of confidential records even when all table columns are denied. S2 evaluation suites must isolate `COUNT(*)` queries into a dedicated aggregate leakage probe rather than conflating them with direct column exfiltration (Decision D-03).

### 3.3 Transitive Child-Table Isolation Gap ([F-022](11_FACTS_REGISTRY.md#f-022))
- **Code Reality**: In `server/src/security/data.policy.js:327-347`, row filter rewriting checks only tables directly referenced in the AST. If a row filter is defined on a parent table (e.g. `projects`), querying an unconstrained child table (e.g. `tasks`) without joining the parent bypasses tenant isolation.
- **Evaluation Impact**: Multi-table RCR access control evaluation must evaluate dual fixtures to establish the direct vs. transitive isolation boundary (Decision D-04).

### 3.4 Unmasked Schema Metadata Exposure ([F-032](11_FACTS_REGISTRY.md#f-032))
- **Code Reality**: `server/src/api/routes/schema.js:25` returns the full, unmasked semantic schema profile to any user who possesses dataset read permission (`canRead`), with zero policy masking applied.
- **Evaluation Impact**: Denied column names, table structures, and relationships are fully readable by untrusted roles via the schema endpoint prior to query generation.

### 3.5 Direct Tool Execution Surface ([F-028](11_FACTS_REGISTRY.md#f-028), [F-029](11_FACTS_REGISTRY.md#f-029))
- **Code Reality**: `server/src/tools/shared.js:33-49` executes raw SQL through `validateSql` -> `enforcePolicy` -> `createAdapter` -> `executeValidatedQuery`, completely bypassing the AST normalization in `prepareSql` ([F-027](11_FACTS_REGISTRY.md#f-027)).
- **Evaluation Impact**: S1 evaluation must include a direct SQL suite (S1-D) targeting `/api/tools/export` to detect path parity discrepancies and parameter injection surfaces (Decision D-05).

### 3.6 PII Role Masking Parsing & Short-Circuit Default ([F-033](11_FACTS_REGISTRY.md#f-033))
- **Code Reality**: `server/src/guardrails/pii.js:8` defines:
  ```javascript
  const MASK_ROLES = new Set((process.env.PII_MASK_ROLES || 'viewer,employee').split(',').map((s) => s.trim()).filter(Boolean));
  ```
- **Parsing Bug**: In JavaScript, an empty string `""` evaluates falsy. Setting `PII_MASK_ROLES=""` triggers the logical OR default and silently restores `'viewer,employee'`.
- **Evaluation Impact**: Benchmark queries executed under `employee` or `viewer` roles will have values redacted into `[EMAIL]`, inducing false negative execution mismatches against gold ground-truth results.
- **Remediation**: The test environment must explicitly set `PII_MASK_ROLES="none"`. Because `"none"` is non-empty, it overrides the default, and since `"none"` matches none of the six valid roles ([F-007](11_FACTS_REGISTRY.md#f-007)), masking is completely disabled (Decision D-01).

---

## 4. Hardware, Systemic & Operational Risks

### 4.1 Thermal Throttling on AMD Ryzen 5 5500U Host
- **Risk**: The evaluation host is equipped with an AMD Ryzen 5 5500U (6 cores / 12 threads) without discrete GPU acceleration. Sustained CPU inference across thousands of LLM generations will cause die temperatures to exceed thermal limits, triggering dynamic CPU frequency scaling (throttling from 4.0 GHz boost down to ~2.1 GHz base).
- **Impact**: Request latency may double or triple over a multi-hour benchmark run, potentially triggering HTTP client timeouts.
- **Mitigation**:
  1. The execution runner enforces an inter-request cooldown period ($\Delta t = 2.0\text{ s}$) between consecutive Ollama calls.
  2. The harness employs an incremental progress journal (`checkpoint.json`), enabling restart from the exact failed item if thermal shutdown or process termination occurs.

### 4.2 Host Memory Exhaustion (OOM)
- **Risk**: The host possesses ~10 GB RAM. Running the Node.js harness alongside the Ollama daemon and local worker processes risks OOM kills if Ollama experiences memory creep or context fragmentation over long runs.
- **Mitigation**:
  1. The harness restricts Ollama context window to 4,096 tokens (`num_ctx 4096`) pending empirical prompt length profiling (Decision D-07).
  2. The runner evaluates one prompt at a time (strictly sequential, concurrency = 1).

### 4.3 LLM Generation Non-Determinism ([F-037](11_FACTS_REGISTRY.md#f-037))
- **Risk**: CogniCore pipeline engines configure non-zero temperatures (e.g. `temperature = 0.1` in `sql.generator.js:119`). Identical natural language inputs may yield different SQL outputs across runs.
- **Mitigation**:
  1. The test runner logs raw prompt strings, model parameters, and raw model responses alongside extracted SQL for 100% audit reproducibility.
  2. The 45-item P2SQL red-team suite runs with $k = 3$ repetitions (Decision D-10).
  3. S1-B ablation experiments run on fixed pre-generated SQL corpora in addition to live end-to-end prompt evaluations.

### 4.4 Statistical Power Limitation on Small Corpora
- **Risk**: The P2SQL RQ1 red-team prompt suite contains only $N = 45$ prompt injection templates.
- **Statistical Bound**: If CogniCore achieves 0 bypasses across all 45 attacks ($k = 0$), the Clopper-Pearson exact 95% confidence upper bound on Attack Success Rate is:
  $$\text{Upper Bound} = 1 - 0.05^{1/45} \approx 6.45\%$$
- **Impact**: A sample size of $N = 45$ is mathematically incapable of demonstrating an ASR below 1% or 5% at standard 95% confidence. The evaluation report must state the exact Clopper-Pearson interval $[0.00\%, 6.45\%]$ and avoid claiming absolute robustness.

---

## 5. Pre-Execution Manual Verification Checklist

Prior to initiating any automated execution in subsequent phases, the evaluator must verify the following prerequisites:

| Check | Verification Target | Expected Result | Pass / Fail |
| :--- | :--- | :--- | :--- |
| **C-01** | `curl -s http://localhost:11434/api/tags` | Ollama daemon is reachable and responding | [ ] |
| **C-02** | `ollama list \| grep gemma3` | Model `gemma3:4b` is locally pulled and cached | [ ] |
| **C-03** | `sha256sum spider.zip` | Matches official Yale Spider archive checksum | [ ] |
| **C-04** | Preflight SQLite casing check | Table/column names in `.sqlite` match RCR schema DDL | [ ] |
| **C-05** | Shared harness self-test | `node harness/oracles/oracle_selftest.js` exits with code 0 | [ ] |
| **C-06** | Ingestion pipeline check | Uploaded SQLite databases pass magic-byte validation ([F-015](11_FACTS_REGISTRY.md#f-015)) | [ ] |
| **C-07** | Admin bypass verification | Confirm admin role bypasses policy enforcement ([F-020](11_FACTS_REGISTRY.md#f-020)) | [ ] |
| **C-08** | Dataset share verification | Confirm non-owner users receive read access via sharing ([F-013](11_FACTS_REGISTRY.md#f-013)) | [ ] |
| **C-09** | PII disable verification | Confirm `PII_MASK_ROLES="none"` disables masking for `employee` ([F-033](11_FACTS_REGISTRY.md#f-033)) | [ ] |
