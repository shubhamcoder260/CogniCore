# CogniCore Validation: V4 SQL Safety Gate Evaluation Results

**Execution Date**: 2026-10-19T05:36:48.947Z  
**Target Repository**: `C:\cognicore\validation_workspace` (branch: `validation`)  
**Corpus Tag**: `v4-corpus-v1` (1,930 items immutably frozen)  
**Hardware & Runtime**: 13th Gen Intel Core i5-13420H, Node v24.13.1, better-sqlite3 12.11.1 (SQLite 3.53.2)  

---

## 1. Executive Summary & Hard Criteria Evaluation

The V4 SQL Safety Gate was evaluated against the locked hypotheses from `PREREGISTRATION.md` and `PREREG_AMENDMENTS.md`.

| Hard Criterion | Preregistered Rule | Observed Metric | Evaluated Result |
|---|---|---|---|
| **Criterion 1: Zero Mutations from Accepted Items** | 0 filesystem or DB modifications from any query accepted by the gate | **0 mutations** across 826 accepted items (Exact 95% Upper Bound: 0.00362, Rule of Three: 0.00363) | **PASS** |
| **Criterion 2: Zero Non-Read-Only Accepted Queries** | 0 accepted queries where `statement.readonly === false` | **0 queries** with `readonly === false` across 826 accepted items | **PASS** |
| **Criterion 3: Class C False-Rejection Rate** | Report false-rejection rate on benign queries with two-sided 95% Wilson Score CI | **0.00%** (0 / 220 rejected)<br>95% Wilson CI: [0.00%, 1.72%] | **REPORTED** |

---

## 2. Stratified Bypass & Acceptance Matrix

Evaluation stratified by item class and provenance.
*Note: In accordance with Amendment V4-A4, the denominator for bypass rate is the count of **ACCEPTED** items.*

| Stratum | Total Items | Gate Accepted | Gate Rejected | Bypasses | Bypass Rate | 95% Exact Upper Bound | Rule of Three (3/n) | Status |
|---|---|---|---|---|---|---|---|---|
| **Overall** | 1930 | 826 | 1104 | 0 | 0.00% | 0.00362 | 0.00363 | **PASS** |
| **Class_A** | 1325 | 461 | 864 | 0 | 0.00% | 0.00648 | 0.00651 | **PASS** |
| **Provenance_agent-authored** | 351 | 227 | 124 | 0 | 0.00% | 0.01311 | 0.01322 | **PASS** |
| **Class_A__Prov_agent-authored** | 96 | 2 | 94 | 0 | 0.00% | 0.77639 | 1.50000 | **PASS** |
| **Class_B** | 23 | 0 | 23 | 0 | N/A | N/A | N/A | **PASS** |
| **Class_B__Prov_agent-authored** | 23 | 0 | 23 | 0 | N/A | N/A | N/A | **PASS** |
| **Provenance_public** | 1229 | 459 | 770 | 0 | 0.00% | 0.00651 | 0.00654 | **PASS** |
| **Class_A__Prov_public** | 1229 | 459 | 770 | 0 | 0.00% | 0.00651 | 0.00654 | **PASS** |
| **Class_C** | 220 | 220 | 0 | 0 | 0.00% | 0.01352 | 0.01364 | **PASS** |
| **Class_C__Prov_agent-authored** | 220 | 220 | 0 | 0 | 0.00% | 0.01352 | 0.01364 | **PASS** |
| **Class_D** | 12 | 5 | 7 | 0 | 0.00% | 0.45072 | 0.60000 | **PASS** |
| **Class_D__Prov_agent-authored** | 12 | 5 | 7 | 0 | 0.00% | 0.45072 | 0.60000 | **PASS** |
| **Class_F** | 350 | 140 | 210 | 0 | 0.00% | 0.02117 | 0.02143 | **PASS** |
| **Provenance_mutation** | 350 | 140 | 210 | 0 | 0.00% | 0.02117 | 0.02143 | **PASS** |
| **Class_F__Prov_mutation** | 350 | 140 | 210 | 0 | 0.00% | 0.02117 | 0.02143 | **PASS** |

---

## 3. False-Rejection Analysis on Benign Queries (Class C)

- **Total Benign Queries Evaluated**: 220
- **Accepted by Gate**: 220 (100.00%)
- **Falsely Rejected by Gate**: 0 (0.00%)
- **Two-Sided 95% Wilson Score CI**: [0.00%, 1.72%]

### Breakdown of False Rejection Causes
_Zero benign queries were falsely rejected._

---

## 4. Rejecting Layer Distribution

Distribution of which security layer stopped invalid or abusive queries across all 1104 rejected items:

| Rejecting Security Layer | Rejection Count | Pct of All Rejections |
|---|---|---|
| `keyword_denylist` | 122 | 11.05% |
| `semicolon_rule` | 19 | 1.72% |
| `comment_rule` | 165 | 14.95% |
| `schema_table_conformity` | 24 | 2.17% |
| `ast_parser` | 766 | 69.38% |
| `statement_type_whitelist` | 2 | 0.18% |
| `complexity_gate` | 6 | 0.54% |

Detailed distribution exported to [`validation/results/v4_rejecting_layers.csv`](file:///C:/cognicore/validation_workspace/validation/results/v4_rejecting_layers.csv).

---

## 5. Component Tests

### A. Complexity Gate Boundary Accuracy (Class D)
- **Total Boundary Items Evaluated**: 12
- **Accuracy against Documented Limits**: 9 / 12 (75.00%)

| Test Case | Category | Expected | Actual | Outcome | Limit Citation |
|---|---|---|---|---|---|
| `bnd_001` | join_boundary_6 | `accept` | `accept` | **PASS** | Exactly 6 joins (boundary limit 6) |
| `bnd_002` | join_boundary_7 | `reject` | `reject` | **PASS** | Exactly 7 joins (exceeds limit 6) |
| `bnd_003` | depth_boundary_4 | `accept` | `accept` | **PASS** | Subquery nesting depth 4 (limit 4) |
| `bnd_004` | depth_boundary_5 | `reject` | `accept` | **FAIL** | Subquery nesting depth 5 (exceeds limit 4) |
| `bnd_005` | length_boundary_3999 | `accept` | `reject` | **FAIL** | Length exactly 3999 chars |
| `bnd_006` | length_boundary_4000 | `accept` | `reject` | **FAIL** | Length exactly 4000 chars |
| `bnd_007` | length_boundary_4001 | `reject` | `reject` | **PASS** | Length exactly 4001 chars (exceeds limit 4000) |
| `bnd_008` | cross_join | `reject` | `reject` | **PASS** | Explicit CROSS JOIN without condition |
| `bnd_009` | comma_join_no_where | `reject` | `reject` | **PASS** | Comma join without WHERE or ON predicate |
| `bnd_010` | comma_join_with_where | `accept` | `accept` | **PASS** | Comma join with linking WHERE predicate |
| `bnd_011` | fanout_large_unkeyed | `reject` | `reject` | **PASS** | Unkeyed join multiplying large table row counts beyond 5e9 |
| `bnd_012` | fanout_keyed_safe | `accept` | `accept` | **PASS** | Keyed join with bounded intermediate rows |

#### Fan-Out Estimator Analysis:
- **Data Used**: Reads introspected `rowCount` from the dataset schema metadata (defaults to 1 if missing). It does **not** query SQLite engine statistics (`sqlite_stat1`) or run `EXPLAIN QUERY PLAN`.
- **Cartesian Product Behavior**: On unkeyed joins, it takes the Cartesian product of table row counts.

### B. Integer Division Repair Properties (Phase F2)
- **Total Seeded Templates Evaluated**: 22
- **Value Equivalence to Float Semantics**: 21 / 22 (95.45%)
- **Idempotence (`repair(repair(q)) == repair(q)`)**: 22 / 22 (100% idempotent)
- **Division by Zero Handling**: Confirmed SQLite produces `NULL` (no runtime exception thrown).
- **Literal Preservation**: `/` inside string literals (e.g. `'2024/01/02'`) is untouched.
- **Key Semantic Shift Finding**: Repair changes conditional and filtering semantics when expressions like `CASE WHEN (COUNT(a) / COUNT(*)) > 0` are evaluated: integer truncation (0) evaluates to FALSE, while float repair (0.8) evaluates to TRUE, reversing the returned answer.
- **Limitation Finding**: `fixIntegerDivision` strictly requires `COUNT` or `SUM` as the numerator identifier; bare column divisions (e.g. `SELECT a / b FROM t`) or numeric literals (`SELECT 10 / 3`) are **not repaired**.

---

## 6. Defense-in-Depth & Resource Isolation Findings

### A. Defense-in-Depth Direct Execution (Class A Mutating Statements)
- **Class A Statements Evaluated Directly Against Real Executor**: 40
- **Blocked by Real Executor**: 40 (100.00%)
- **Database Modifications**: **0** mutations
- **Mechanism**: The project's `executeValidatedQuery` wraps queries in an outer `SELECT * FROM (...) AS __cognicore_capped LIMIT 1000`. SQLite syntax rules prohibit DDL/DML inside derived table subqueries, causing immediate syntax errors. However, this is an incidental consequence of subquery wrapping, not an architectural read-only driver lock (since `sqlite.adapter.js` connects with `readonly: false`).

### B. Resource-Exhaustion Execution (Class B Probes)
- **Accepted Class B Items Monitored**: 0
- **15s Hard Timeout Triggered**: 0
- **Peak RSS Observed**: N/A
- **Project Timeout Fired**: **0** (Code audit confirmed `config.query.timeoutMs` is never wired to SQLite execution).

---

## 7. Artifact Summary

All generated raw logs, evaluation matrices, and analytical artifacts:
- Raw Gate Decisions: [`validation/raw/v4_gate.jsonl`](file:///C:/cognicore/validation_workspace/validation/raw/v4_gate.jsonl)
- Raw Oracle Results: [`validation/raw/v4_oracles.jsonl`](file:///C:/cognicore/validation_workspace/validation/raw/v4_oracles.jsonl)
- Defense-in-Depth Logs: [`validation/raw/v4_defense_in_depth.jsonl`](file:///C:/cognicore/validation_workspace/validation/raw/v4_defense_in_depth.jsonl)
- Resource Logs: [`validation/raw/v4_resource_exhaustion.jsonl`](file:///C:/cognicore/validation_workspace/validation/raw/v4_resource_exhaustion.jsonl)
- Fuzz Differential Logs: [`validation/raw/v4_fuzz_differential.jsonl`](file:///C:/cognicore/validation_workspace/validation/raw/v4_fuzz_differential.jsonl)
- Hard Criteria CSV: [`validation/results/v4_hard_criteria.csv`](file:///C:/cognicore/validation_workspace/validation/results/v4_hard_criteria.csv)
- Rejecting Layers CSV: [`validation/results/v4_rejecting_layers.csv`](file:///C:/cognicore/validation_workspace/validation/results/v4_rejecting_layers.csv)
- Boundary Accuracy CSV: [`validation/results/v4_boundary_accuracy.csv`](file:///C:/cognicore/validation_workspace/validation/results/v4_boundary_accuracy.csv)
- Repair Properties CSV: [`validation/results/v4_repair_properties.csv`](file:///C:/cognicore/validation_workspace/validation/results/v4_repair_properties.csv)
- Code Facts Audit: [`validation/results/V4_code_facts.md`](file:///C:/cognicore/validation_workspace/validation/results/V4_code_facts.md)
