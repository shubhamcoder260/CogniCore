# V4d Empirical Evaluation Report: Executable-Write Statement Expansion

**Workspace**: `C:\cognicore\validation_workspace`  
**Branch**: `validation`  
**Date**: October 2026  
**Evaluation Suite**: V4d Executable-Write Gate Defense (Step 3b Phase F)  
**Corpus**: `validation/data/v4d/executable_writes.jsonl` (640 items)  
**Corpus Git Tag**: `v4d-corpus-v1`  
**Execution Invariant**: Every tested statement was pre-verified on an isolated SQLite database clone: `db.prepare(sql)` succeeds AND driver property `stmt.readonly === false`.

---

## 1. Executive Summary

To close the empirical evidence gap identified in Step 3—where only 56 frozen corpus items across all prior test corpora were statements that SQLite could genuinely execute with write privileges (`readonly === false`)—**Step 3b Phase F expanded the executable write suite by 640 verified items**.

Across all **640 executable write statements**:
- **Gate Rejection Rate**: **640 / 640 (100.00%)**
- **Gate Acceptance Rate**: **0 / 640 (0.00%)**
- **Exact 95% Clopper-Pearson Upper Bound ($1 - 0.05^{1/n}$)**: **0.47%**
- **Rule of Three 95% Upper Bound ($3/n$)**: **0.47%**

When pooled with the 56 Phase 0 executable write statements, CogniCore's SQL safety gate achieved **0 / 696 acceptances (0.00%)**, establishing an exact 95% statistical upper bound of **0.43%** (Rule of Three: **0.43%**).

---

## 2. Table 1: Executable-Write Outcomes by Provenance

| Provenance Stratum | Description & Source | $N$ | Accepted | Rejected | Acceptance Rate | Exact 95% Upper Bound | Author Independence |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Public Payloads** | PayloadsAllTheThings `SQLite-Injection.md` (lines 91, 108, 109) | 3 | 0 | 3 | 0.00% | 63.16% | **STRICTLY INDEPENDENT** |
| **Agent-Authored** | Systematic grammar & mutation expansion (14 SQL write categories) | 637 | 0 | 637 | 0.00% | 0.47% | Harness Derived |
| **Step 3b Corpus v4d Total** | All Phase F executable write statements | **640** | **0** | **640** | **0.00%** | **0.47%** | Combined |
| **Pooled Total (v4 + v4d)** | All executable write statements across all frozen corpora | **696** | **0** | **696** | **0.00%** | **0.43%** | Benchmark Grand Total |

### Plain Statement of Provenance Independence
- **Public Payloads (`public:SQLite-Injection.md`)**: These payloads were authored by independent external security researchers and retrieved directly from the upstream PayloadsAllTheThings repository. They represent realistic exploit primitives (e.g. creating web shells, scheduling cron tasks) and are **strictly independent of the harness author**.
- **Agent-Authored Payloads**: These statements were authored by the research validation harness to provide dense coverage across SQLite's write dialect constructs (DML, DDL, PRAGMA writes, and CTE-wrapped writes). While verified executable by the SQLite engine, they share author provenance with the evaluation test harness.

---

## 3. Table 2: Executable-Write Breakdown by SQL Construct Category

| Category | Description | $N$ | Accepted | Rejected | Rejection Rate | Primary Rejecting Layer |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| `create_table` | CREATE_TABLE executable write variants | 33 | 0 | 33 | 100.00% | `keyword_denylist` / `safety_validator` |
| `insert` | INSERT executable write variants | 128 | 0 | 128 | 100.00% | `keyword_denylist` / `safety_validator` |
| `replace` | REPLACE executable write variants | 40 | 0 | 40 | 100.00% | `keyword_denylist` / `safety_validator` |
| `upsert` | UPSERT executable write variants | 40 | 0 | 40 | 100.00% | `keyword_denylist` / `safety_validator` |
| `update` | UPDATE executable write variants | 128 | 0 | 128 | 100.00% | `keyword_denylist` / `safety_validator` |
| `delete` | DELETE executable write variants | 96 | 0 | 96 | 100.00% | `keyword_denylist` / `safety_validator` |
| `create_index` | CREATE_INDEX executable write variants | 16 | 0 | 16 | 100.00% | `keyword_denylist` / `safety_validator` |
| `create_view` | CREATE_VIEW executable write variants | 16 | 0 | 16 | 100.00% | `keyword_denylist` / `safety_validator` |
| `create_trigger` | CREATE_TRIGGER executable write variants | 12 | 0 | 12 | 100.00% | `keyword_denylist` / `safety_validator` |
| `drop` | DROP executable write variants | 24 | 0 | 24 | 100.00% | `keyword_denylist` / `safety_validator` |
| `alter` | ALTER executable write variants | 12 | 0 | 12 | 100.00% | `keyword_denylist` / `safety_validator` |
| `vacuum_into` | VACUUM_INTO executable write variants | 20 | 0 | 20 | 100.00% | `keyword_denylist` / `safety_validator` |
| `with_write` | WITH_WRITE executable write variants | 30 | 0 | 30 | 100.00% | `keyword_denylist` / `safety_validator` |
| `pragma_write` | PRAGMA_WRITE executable write variants | 45 | 0 | 45 | 100.00% | `keyword_denylist` / `safety_validator` |

---

## 4. Verification and Security Verdict

1. **Zero Write Leakage**: Across 640 freshly generated write operations and 696 pooled write operations across all evaluation phases, CogniCore's SQL safety gate permitted **zero write statements to execute**.
2. **Defensive Invariant Confirmed**: Because every item was pre-verified to execute with `readonly === false` on native SQLite, the 100% rejection rate confirms that the keyword denylist and AST validator effectively intercept all standard DDL, DML, PRAGMA, and CTE-wrapped write vectors before database execution.
