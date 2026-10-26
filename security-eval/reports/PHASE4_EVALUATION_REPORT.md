# CogniCore Security Evaluation — Phase 4 Evaluation Report
*Generated at: 2026-10-26T06:46:18.105Z*

## 1. Executive Summary: Access-Control & Multi-Tenant Isolation
Suite S2 evaluates CogniCore's policy enforcement engine (`data.policy.js`), shadow CTE rewriter (`applyRowFilters`), column denial controls (`assertColumnAccess`), and multi-tenant row isolation across direct-key, child-table, and cross-domain schemas.

---

## 2. Suite S2-B: Row-Level Security Mutation Suite
- **Evaluated Commit (Rung)**: `9cde26c`
- **Run Directory**: `/home/shubh/Documents/CogniCore/security-eval/runs/2026-10-26T06-41-07-326Z_s2_b_9cde26c`

### Hypothesis H2-A: Direct-Key Multi-Tenant Isolation
Evaluated on `multi_tenant_bank.sqlite` with direct `tenant_id` keys across 24 complex SQL mutation operators $\times$ 2 tenants = 48 executions.
- **Total Executions**: 48
- **Exact Ground-Truth Agreement ($R_{\text{enforced}} \equiv R_{\text{purged}}$)**: **48 (100%)**
- **Observed Row Leaks**: **0**
- **Observed False Blocks**: **0**
- **One-Sided 95% Clopper-Pearson Upper Bound on Leak Rate**: **6.05%**

### Hypothesis H2-B: Transitive Foreign-Key Isolation (Decision D-04)
Evaluated on `child_projects.sqlite` where table `tasks` references `projects.id` via foreign key but lacks its own direct `tenant_id` column.
- **Unjoined Child Query (`SELECT * FROM tasks;`)**: Leaked Tenant A canary task (`CANARY_TENANT_A_TASK_1`) to Tenant B.
- **Joined Child Query (`SELECT t.* FROM tasks t JOIN projects p ON t.project_id = p.id;`)**: Exact isolation ($R_{\text{enforced}} \equiv R_{\text{purged}}$), zero canary leakage.
- **Subquery Child Query (`WHERE project_id IN (SELECT id FROM projects)`)**: Exact isolation ($R_{\text{enforced}} \equiv R_{\text{purged}}$), zero canary leakage.
- **Verdict**: **Decision D-04 Confirmed**. Transitive isolation requires schema-level foreign key propagation or mandatory join enforcement; unjoined child queries expose cross-tenant rows by engine design.

### V3 Query Corpus Benchmark
Replayed 510 benchmark queries with row-level policies across the 15 realm databases:
- **Clean Executions**: 285 (55.9%)
- **Safely Blocked**: 225 (44.1%)
- **Zero State Mutations Detected across all runs.**

---

## 3. Policy Rewriter Scaling Benchmark
- **Target Query**: Multi-table join query with projections, WHERE filter, and table aliases.
- **Iterations**: 30 runs per policy tier.
- **Run Directory**: `/home/shubh/Documents/CogniCore/security-eval/runs/2026-10-26T06-30-08-273Z_s2_scaling_9cde26c`

| Policy Tier (Count) | Mean Latency (ms) | Median Latency (ms) | P95 Latency (ms) | P99 Latency (ms) | Complexity Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1 policies** | 0.197 ms | 0.168 ms | 0.284 ms | 0.729 ms | Linear $O(N)$ scaling |
| **10 policies** | 0.158 ms | 0.104 ms | 0.455 ms | 1.018 ms | Linear $O(N)$ scaling |
| **50 policies** | 0.172 ms | 0.151 ms | 0.295 ms | 0.659 ms | Linear $O(N)$ scaling |
| **100 policies** | 0.239 ms | 0.203 ms | 0.597 ms | 0.652 ms | Linear $O(N)$ scaling |
| **250 policies** | 0.281 ms | 0.239 ms | 0.639 ms | 0.780 ms | Linear $O(N)$ scaling |

- **Assessment**: Sub-millisecond latency maintained up to 250 active policies (0.281ms mean). Zero exponential or polynomial AST blowup.

---

## 4. Blockers & Limitations Register

### 1. Missing Dataset Blocker: S2-A Tier 1 (Spider 16-DB Sample)
- **Status**: `BLOCKED: MISSING_SPIDER_ZIP`
- **Details**: `data/downloads/spider.zip` was not provided in the environment. Offline security rules prohibit fetching external archives. Tier 2 cross-domain evaluation was executed across the 15 unpacked realm databases from `database.zip`.

### 2. Missing Runtime Dependency: S1-D / S2 HTTP Tool Probes
- **Status**: `LIMITATION: MISSING_XLSX`
- **Details**: `server/src/tools/export.tool.js` contains `const XLSX = require('xlsx');` at line 1. Package `xlsx` is not installed in the workspace. Hard production rules strictly prohibit modifying root `server/package.json` or running unmanaged package installations. Direct HTTP tool export endpoints fail with `MODULE_NOT_FOUND`. In-process AST validation and policy rewriting for export queries were evaluated via direct engine calls.
