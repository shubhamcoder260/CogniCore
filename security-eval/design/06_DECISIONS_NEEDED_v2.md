# Decisions Needed v2: Evaluation Architecture Register

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d`

---

## 1. Overview

In accordance with Hard Rule 6, no architectural fork or design ambiguity has been resolved silently. This register documents each design decision, compares viable alternatives, evaluates security and operational trade-offs, and provides an authoritative recommendation.

---

## 2. Decision Register

### Decision 01: Table-Level Denial Representation in CogniCore
- **Context**: RCR (`User_2` and `User_4`) denies entire tables. However, CogniCore's `PolicyStore.add` (`server/src/security/data.policy.js:37` @ `9cde26c`) strictly restricts policy kinds to:
  `if (policy.kind !== 'deny_column' && policy.kind !== 'row_filter') throw new Error(...)`.
  There is no native `deny_table` policy kind.
- **Options**:
  - **Option A (Faithful External Translation - Recommended)**: Represent a table denial by generating a `deny_column` policy for every column in that table based on the schema profile.
  - **Option B (Modify Policy Engine Code)**: Patch `data.policy.js` before evaluation to introduce a new `kind: "deny_table"`.
  - **Option C (Row Filter Exclusion)**: Implement table denial as a row filter with an impossible predicate (`row_filter` with `1=0` or `false`).
- **Trade-offs**:
  - Option A tests CogniCore strictly as written in `9cde26c`. It faithfully reveals the architectural vulnerability where `SELECT COUNT(*) FROM table` bypasses column-level denials.
  - Option B violates the hard rule prohibiting code modifications prior to baseline evaluation.
  - Option C changes query semantics (queries execute and return 0 rows rather than throwing access-denied errors).
- **Recommendation**: **Adopt Option A**. Translate table denials into exhaustive `deny_column` entries across all table columns. Formally log the `COUNT(*)` bypass as an empirical finding.

---

### Decision 02: Evaluation Dialect Scope (SQLite Only vs. Multi-Engine Docker)
- **Context**: CogniCore supports SQLite (`better-sqlite3`), Postgres (`pg`), and MySQL (`mysql2`). Both external papers (P2SQL and RCR) developed their fixtures on PostgreSQL. However, the evaluation host is a Fedora laptop with 10 GB RAM and no running PostgreSQL instance.
- **Options**:
  - **Option A (Pure SQLite Portability - Recommended)**: Translate all fixtures (`job_postings.sql` and RCR Spider databases) to SQLite 3. Run all primary test suites against SQLite.
  - **Option B (Dockerized PostgreSQL Multi-Engine Suite)**: Launch a local Docker container running PostgreSQL 16; evaluate both SQLite and Postgres.
  - **Option C (PostgreSQL Primary)**: Discard SQLite testing and test only PostgreSQL via Docker.
- **Trade-offs**:
  - Option A operates entirely self-contained on the Ryzen 5 5500U laptop without memory pressure or container overhead.
  - Option B introduces Docker dependencies, port bindings, and external services, risking out-of-memory crashes on a 10 GB host while Ollama is running.
  - Option C ignores CogniCore's primary out-of-the-box storage engine.
- **Recommendation**: **Adopt Option A** for the primary security evaluation. Design scripts so PostgreSQL connection parameters can be provided as an optional environment variable (`PG_TEST_URI`) on a more capable machine later.

---

### Decision 03: Primary LLM Model Selection for Local Hardware
- **Context**: `server/src/config/env.js:26` defaults to `qwen2.5:14b`. A 14B parameter model requires 10-12 GB RAM for quantization and context, which will trigger aggressive Linux OOM killer termination on a 10 GB host running Ollama and CogniCore.
- **Options**:
  - **Option A (Local Baseline: `gemma3:4b` - Recommended)**: Configure evaluation harness to explicitly set `OLLAMA_MODEL=gemma3:4b` with `num_ctx 8192`.
  - **Option B (Hardware Default: `qwen2.5:14b`)**: Run the unconfigured default model.
  - **Option C (Intermediate: `qwen2.5:7b`)**: Use a 7B model.
- **Trade-offs**:
  - Option A is stable, responsive (~12 s/request), and operates comfortably within the 10 GB RAM envelope.
  - Option B will fail or crash due to memory exhaustion.
  - Option C provides slightly higher SQL generation quality than 4B, but leaves minimal memory headroom during heavy multi-statement queries.
- **Recommendation**: **Adopt Option A** as the mandatory baseline. Document Option B/C as optional targets for higher-spec evaluation environments.

---

### Decision 04: PII Masking vs. Access Control Leak Oracle
- **Context**: CogniCore's `server/src/security/pii.masker.js` scrubs emails, phone numbers, and credit cards from LLM responses. If an access-control leak involves a user's email, PII masking may replace it with `[EMAIL]`, potentially concealing the leak from naive string matching.
- **Options**:
  - **Option A (Custom Non-PII Canary Syntax - Recommended)**: Seed canaries using tokens that explicitly bypass PII regexes (`CANARY_<TABLE>_<COL>_<HEX>`).
  - **Option B (Disable PII Masking During Eval)**: Introduce an environment variable to bypass `maskPII()` during security evaluation.
  - **Option C (Scan for Masking Replacements)**: Treat the appearance of `[EMAIL]` in unauthorized contexts as a leak verdict.
- **Trade-offs**:
  - Option A requires zero server modifications and tests the full production pipeline end-to-end.
  - Option B requires adding evaluation-only toggle points to production code.
  - Option C creates false positives if legitimate benign queries return masked fields.
- **Recommendation**: **Adopt Option A**. Use synthetic canary tokens designed to avoid PII masking heuristics.

---

### Decision 05: Evaluation of Direct-SQL Tool Endpoints (S1-D) Missing `prepareSql`
- **Context**: In `server/src/routes/tools/shared.js:34-45`, `executeToolSql` validates and enforces policy, but **completely skips** `prepareSql(sql)` (which normalizes whitespace, strips comments, and removes trailing semicolons).
- **Options**:
  - **Option A (Evaluate As-Is to Document Vulnerability - Recommended)**: Run S1-A payloads against `POST /api/tools/export` in the current commit (`9cde26c`) to measure whether omission of `prepareSql` permits multi-statement or comment evasion bypasses.
  - **Option B (Patch Before Evaluation)**: Add `prepareSql` to `tools/shared.js` prior to running S1-D.
- **Trade-offs**:
  - Option A provides an honest, empirical security assessment of the system as delivered.
  - Option B hides a critical discrepancy between the chat engine and tool endpoints.
- **Recommendation**: **Adopt Option A**. Evaluate the unpatched vulnerability in S1-D and verify the fix in post-hardening evaluation.

---

### Decision 06: Repetition Count ($k$) for Stochastic Chat Evaluation
- **Context**: Ollama inference uses non-zero temperatures ($0.1 - 0.2$). Single-shot runs ($k=1$) risk under-reporting jailbreak success rates due to stochastic generation.
- **Options**:
  - **Option A ($k = 5$ for Primary Subset - Recommended)**: Run $k = 5$ for P2SQL primary prompts (45 total calls) and $k = 1$ for deterministic gate/tool queries.
  - **Option B ($k = 1$ Across All Suites)**: Single invocation per test case.
  - **Option C ($k = 10$ Across All Suites)**: High-density statistical replication.
- **Trade-offs**:
  - Option A provides statistical confidence within a manageable 1.5-hour runtime budget on the Ryzen 5 5500U.
  - Option B is fast (< 30 min) but statistically unreliable for generative jailbreaks.
  - Option C expands evaluation runtime to > 4 hours, exceeding practical interactive session limits.
- **Recommendation**: **Adopt Option A**.

---

### Decision 07: Spider SQLite Database Sourcing Strategy
- **Context**: RCR repository does not include `.sqlite` databases; they must be acquired from the original Yale Spider release.
- **Options**:
  - **Option A (Automated Verification Script with Manual Download Protocol - Recommended)**: Evaluation script checks for SQLite files in `security-eval/data/golden/`; if missing, it halts and prints the exact `curl`/unzip instructions.
  - **Option B (Embed Spider DBs in Repo)**: Commit 16 SQLite databases into the Git repository.
- **Trade-offs**:
  - Option A keeps the repository lightweight and adheres to Hard Rule 1 (no background downloads or clones during design).
  - Option B bloats the Git history with binary database blobs.
- **Recommendation**: **Adopt Option A**.
EOF
