# Risks, Unverified Claims & v1 Contradictions Register v2

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d`  
**P2SQL External Repository Commit:** `ff5a0226b6c63407ae19ba5567ae251b51d4f98e`  
**RCR External Repository Commit:** `9179b2ec6d84df56803cbbeb2650cd86b7c1b56f`

---

## 1. Unverified Items Register

In strict conformance with Hard Rule 5, the following items cannot be empirically verified via read-only inspection of the local workspace and local clone directories. They remain designated as **`UNVERIFIED`**:

1. **`UNVERIFIED: Spider SQLite Database Schema Alignment`**:
   - The original Yale Spider SQLite `.sqlite` binary databases have not been downloaded or inspected (prohibited under Hard Rule 1). Whether table and column names in the official Yale Spider release match the RCR schema definitions in `data/spider/SCHEMA.md` with 100% case-sensitive fidelity cannot be confirmed until data acquisition in a later session.
2. **`UNVERIFIED: Ollama Gemma-3 4B SQL Generation Quality`**:
   - The exact baseline execution accuracy ($EX$) and spider SQL valid generation rate for `gemma3:4b` on this specific local setup has not been measured because running inference or server commands is prohibited during the design phase.
3. **`UNVERIFIED: Native Postgres Driver Vulnerabilities in CogniCore`**:
   - `server/src/ingestion/adapters/postgres.adapter.js` and `server/src/structured/postgres.worker.js` cannot be dynamically evaluated because no PostgreSQL server is running on the local host. Driver-level behaviors (e.g., multi-statement query separation under `node-postgres`) are verified by code inspection only.
4. **`UNVERIFIED: P2SQL Automated Corpus Distribution (RQ3)`**:
   - While `RQ3/red-team/prompts.csv` was verified to contain 17,099 rows, the automated directory `RQ3/automated/` contains only generated prompt counts and Python scripts; full runtime generation outputs were not checked via script execution.

---

## 2. Inventory of v1 Design Errors & Document Contradictions

Grounding inspection in `08_BASELINE_AND_SPOT_CHECKS.md` revealed that the v1 design files (`00_CODEBASE_GROUNDING.md` through `07_RISKS_AND_UNVERIFIED.md`) and project documentation contained serious factual errors, incorrect code citations, and broken statistical formulas.

### 2.1 Critical v1 Design Errors

| # | v1 Design Claim | Code Reality (`9cde26c`) | Correction in v2 |
| :--- | :--- | :--- | :--- |
| **1** | **v1 S1 Funnel**: Claimed $ASR = P(L_1) \cdot P(L_2) \cdot P(L_3)$ with independent stages. | Tautological and mathematically incorrect. $L_2$ is strictly conditional on $L_1$, and $L_3$ is conditional on $L_2$. | Replaced with true conditional probabilities $\hat{P}(L_2 \mid L_1)$, $\hat{P}(L_3 \mid L_2)$, and Wilson Score / Rule of Three confidence bounds (`02_S1_DESIGN_v2.md`). |
| **2** | **v1 S2 Table Policy**: Claimed CogniCore supports `kind: "deny_table"`. | `data.policy.js:37` strictly permits only `deny_column` and `row_filter`. Passing `deny_table` throws an unhandled fatal error. | Formally documented expressibility gap; table denial translated into exhaustive column denials (`03_S2_DESIGN_v2.md`). |
| **3** | **v1 Role Assumption**: Claimed `user` is an alias of `analyst` and receives analyst policies. | `data.policy.js:53` performs exact string matching: `p.role === user.role`. Policies for `analyst` are completely ignored for users with role `user`. | Harness must provision accounts with explicit role strings matching policies (`User_1`..`User_4`) (`03_S2_DESIGN_v2.md`). |
| **4** | **v1 Input Guard Assumption**: Claimed `screenQuestion` blocks SQL injection attempts in natural language. | `input.guard.js:42-43` only throws if `result.findings.some(f => f.type === 'prompt_injection' \|\| f.type === 'oversized_input')`. SQLi findings are logged but **NEVER blocked**! | Re-calibrated S1-A first-stop attribution oracle to reflect true guard behavior (`02_S1_DESIGN_v2.md`). |
| **5** | **v1 RCR Dataset Contents**: Assumed RCR repository contained SQLite databases. | Verified in `09_EXTERNAL_REPOS_INSPECTION.md` that RCR contains only JSONL, Python scripts, and a Postgres Dockerfile. No `.sqlite` files exist. | Added explicit Spider SQLite database acquisition plan (`04_DATA_ACQUISITION_PLAN_v2.md`). |
| **6** | **v1 P2SQL Mapping**: Fabricated generic SQL injection prompts instead of real attack prompts. | `~/scratch/P2SQL/RQ1/prompts/` contains specific, empirical prompt injection templates (`U1`..`U3`, `RD1`..`RD2`, `RI1`..`RI2`). | Mapped exact prompt files, templates, and failed attempt variants (`02_S1_DESIGN_v2.md`). |
| **7** | **v1 Validation Corpus Size**: Claimed total validation records were ~3,578. | Line count across `validation/data/` is actually **53,481 lines**. v1 omitted subsets `v3b`, `v3c`, `v3d`, `v4b`, `v4c`, `v4d`. | Full inventory corrected in `08_BASELINE_AND_SPOT_CHECKS.md`. |
| **8** | **v1 Default Model**: Stated default model was `gemma3:4b`. | `server/src/config/env.js:26` defaults to `qwen2.5:14b`. | Local evaluation explicitly configures `gemma3:4b` to avoid OOM on 10 GB host (`04_DATA_ACQUISITION_PLAN_v2.md`). |
| **9** | **v1 Tools Endpoint Parity**: Assumed tools endpoints execute identically to chat pipeline. | `tools/shared.js:34-45` completely omits `prepareSql`, creating a live evasion surface. | Created dedicated direct-SQL suite **S1-D** (`02_S1_DESIGN_v2.md`). |

---

## 3. Operational & Systemic Evaluation Risks

### 3.1 Hardware & Runtime Bottlenecks
- **Thermal Throttling on AMD Ryzen 5 5500U**:
  - Continuous CPU inference on 6 cores without dedicated GPU will cause package temperatures to rise, inducing CPU frequency throttling (from 4.0 GHz down to ~2.1 GHz) and doubling request latencies over a multi-hour run.
  - *Mitigation*: The test runner enforces a mandatory 2.0-second idle pause between Ollama invocations (`T_pause = 2.0s`).
- **Ollama Memory Accumulation / Leakage**:
  - Prolonged execution of hundreds of generation requests against Ollama can lead to resident set size (RSS) memory creep, threatening system stability on a 10 GB RAM host.
  - *Mitigation*: The master orchestrator operates with a persistent checkpoint file (`checkpoint.json`). If Ollama terminates or the process is killed, execution can resume immediately without loss of progress.

### 3.2 Evaluation Integrity Risks
- **`COUNT(*)` Access Control Evasion**:
  - In `server/src/security/data.policy.js:157-162`, `assertColumnAccess` skips AST nodes representing `COUNT(*)`. A client can determine table cardinalities or confirm the existence of confidential rows even when all table columns are strictly denied.
- **Cached Schema Metadata Leakage**:
  - `server/src/routes/schema.js:25` returns the unmasked semantic profile to any authenticated user. Denied column names, data types, and primary/foreign key topologies are visible to low-privilege roles regardless of policy rules.
- **Direct Tool Raw-SQL Ingestion**:
  - `server/src/routes/tools/shared.js` accepts client-supplied SQL directly and bypasses `prepareSql`. Any discrepancy between CST parsing and naive string execution can be exploited via `/api/tools/export`.

---

## 4. Manual Verification Checklist for Subsequent Execution Session

Before initiating any automated scripts in the execution phase, the evaluator must perform the following manual checks:
1. Verify Ollama is running and responding locally: `curl -s http://localhost:11434/api/tags`.
2. Verify `gemma3:4b` is present in Ollama model list: `ollama list | grep gemma3`.
3. Verify download and integrity of Spider SQLite database archive:
   - Download `spider.zip` from official Yale repository.
   - Extract `database/` folder into `security-eval/data/golden/`.
   - Run `sha256sum` on all 16 sampled `.sqlite` files and record in `spider_hashes.sha256`.
4. Run `node security-eval/harness/oracles/oracle_selftest.js` to ensure logical hash and directory snapshot oracles pass all unit tests before production evaluation.
EOF
