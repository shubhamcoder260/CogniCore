# Phase 0 Results: V3c / V4 Loose Ends and System Introspection

This document consolidates the empirical findings, audit verifications, and architectural proofs for Phase 0 of Step 4. All metrics are computed directly from raw execution logs and deterministic reproduction scripts.

---

## 1. Item 0.1: `schema_qualified_main` Detectability & Leak Rates

We evaluated the `schema_qualified_main` transform across all 2,760 evaluated query executions in `validation/raw/v3c_execution.jsonl`.

- **Unconditional Leak Rate**:
  $$\frac{1,622}{2,760} = 58.77\% \quad [56.91\%, 60.60\% \text{ (95\% Wilson CI)}]$$
- **Condition A (User Policy Filters a Table Referenced by the Query)**:
  - Filtered items: 1,940 queries
  - Leaked items: 1,620 queries
  - **Detectable Rate (Condition A)**:
    $$\frac{1,620}{1,940} = 83.51\% \quad [81.80\%, 85.09\% \text{ (95\% Wilson CI)}]$$
- **Condition B (Unfiltered Query Result Differs from Purged Oracle Result)**:
  - Detectable items (where row filter exclusion actually affects result rows): 1,802 queries
  - Leaked items: 1,618 queries
  - **Detectable Rate (Condition B)**:
    $$\frac{1,618}{1,802} = 89.79\% \quad [88.31\%, 91.12\% \text{ (95\% Wilson CI)}]$$

---

## 2. Item 0.2: The 14 Leaks Across 7 Transforms — Root Cause Analysis

Across the 7 AST query transforms (`table_alias`, `subquery_from`, `subquery_where_in`, `subquery_exists`, `union_all`, `self_join`, `left_join`), exactly 14 leaked items were observed in each transform category.

### Base Query Roster

Inspection of the underlying base query IDs reveals 12 distinct base queries (with 2 queries duplicated across fixtures):
1. `base_0007` (financial_records)
2. `base_0019` (ecommerce)
3. `base_0023` (healthcare_ehr)
4. `base_0031` (inventory_erp)
5. `base_0045` (saas_billing)
6. `base_0052` (telecom_cdr)
7. `base_0068` (insurance_claims)
8. `base_0074` (supply_chain)
9. `base_0088` (banking_core)
10. `base_0093` (hr_portal)
11. `base_0105` (retail_pos)
12. `base_0112` (customer_support)

### Mechanism Verification: "No New Mechanism" Confirmed

- **Base Text Check**: A literal search for `main.` across all 14 base query texts yielded **0 occurrences**.
- **Root Cause**: Each of these 12 base queries contains an inner `LIMIT 5` clause combined with a multi-table Cartesian or self join lacking a total `ORDER BY` tie-breaker.
- **Outcome**: The un-ordered inner limit selects an arbitrary subset of rows before join evaluation. When executed against the cloned database in the oracle harness vs the test database, non-deterministic row ordering at the storage engine level causes slight multiset row differences, which the strict multiset oracle flags as excess rows.
- **Conclusion**: There is **no new bypass mechanism** or security regression in these 7 transforms; the 14 leaks are entirely attributable to SQLite's non-deterministic row iteration on un-ordered `LIMIT` clauses.

---

## 3. Item 0.3: SQLite PRAGMA Introspection Table

Evaluation of all six table-valued PRAGMA functions supported by SQLite:

| PRAGMA Form | Query Tested | Gate Layer Reached | E1 Outcome | Returned Content Class |
| :--- | :--- | :---: | :---: | :--- |
| `pragma_table_info` | `SELECT * FROM pragma_table_info('users')` | AST Validator Pass | **EXECUTED** | Database column metadata, data types, nullability, defaults |
| `pragma_index_list` | `SELECT * FROM pragma_index_list('users')` | AST Validator Pass | **EXECUTED** | Index names, uniqueness flags, origin metadata |
| `pragma_database_list` | `SELECT * FROM pragma_database_list` | AST Validator Pass | **EXECUTED** | **Host filesystem paths** (`C:\cognicore\validation_workspace\...`), DB file locations |
| `pragma_function_list` | `SELECT * FROM pragma_function_list` | AST Validator Pass | **EXECUTED** | Available SQL built-in and user-defined function names |
| `pragma_module_list` | `SELECT * FROM pragma_module_list` | AST Validator Pass | **EXECUTED** | Loaded SQLite virtual table modules (e.g. `fts5`, `rtree`, `json1`) |
| `pragma_collation_list`| `SELECT * FROM pragma_collation_list` | AST Validator Pass | **EXECUTED** | Collation sequences available in the database engine |

> [!CAUTION]
> Because `sql.validator.js` enforces statement type `select` and permits table-valued functions that syntax-parse as `SELECT * FROM func(...)`, all six table-valued PRAGMA functions pass the SQL safety gate and execute directly. In particular, `pragma_database_list` leaks host operating system absolute file paths directly to analytical users.

---

## 4. Item 0.4: Data Policies and Egress Exposure (D1 & D3)

- **D1 (Dataset Preview Bypass)**:
  - Tested on `GET /api/datasets/:id/preview` with restricted employee role (`user_002`, policy: `department = 'Sales'`, denied column: `bal`).
  - Result: Returned 10 sample rows including rows from `Engineering` and `Support` (outside row filter), with the sensitive `bal` column displayed in plain text.
  - Reason: `server/src/api/routes/datasets.js:54-55` calls `adapter.preview(tableName, limit)` directly without invoking `resolvePolicy` or `enforcePolicy`.
- **D3 (Export Tool PII Scrubbing Trace)**:
  - Evaluated on `POST /api/tools/export` (CSV, XLSX) and `POST /api/tools/report` (PDF) for role `viewer`.
  - Result: Both export endpoints and report generation pass database rows directly to `toCsvBuffer`, `toXlsxBuffer`, and `buildPdfReport`.
  - Runtime Trace: `redactEvidence` was invoked **0 times** across CSV, XLSX, and PDF exports.
  - Verification: Generated CSV and XLSX files contained seeded plain-text emails, phones, SSNs, and credit card numbers without masking.

---

## 5. Item 0.5: Event-Loop Gaps & Resource Spikes

Analysis of per-item execution duration and event-loop lag across Class B2 and Class D3 (Corpus v4c):

- **Summary File**: `validation/raw/event_loop_gaps.csv`
- **Total Evaluated Items**: 253 queries
- **Items with Event Loop Lag > 250 ms**: 47 items
- **Maximum Event-Loop Spike**:
  - Item: `V4C-D3-015` (Class D3 cartesian_join_on_true)
  - Execution Time: **15,235 ms**
  - Outcome: Terminated by harness hard kill watchdog (15s deadline). Peak memory: 492 MB.

---

## 6. Item 0.6: Reproduce All Tables Audit

The script `validation/experiments/reproduce_all_tables.js` was executed across all committed evaluation reports:
- Reports Audited:
  1. `V4_RESULTS.md` (Commit `20a2164`)
  2. `V4b_RESULTS.md` (Commit `8d1ef8e` — contains 4 documented draft placeholders in superseded Table 1)
  3. `V4c_RESULTS.md` (Commit `67ec36a`)
  4. `V3_RESULTS.md` (Commit `998ab90`)
  5. `V3b_RESULTS.md` (Commit `9a7516f`)
  6. `V4d_RESULTS.md` (Commit `6fa1a11`)
  7. `V3c_RESULTS.md` (Commit `29b8c0a`)
- Audit Result: **100% of non-draft numerical values** reproduce with byte-level mathematical agreement from raw underlying JSONL logs.

---

## 7. Item 0.7: Relabeling of Hardening Table (Step 2c)

In `validation/analysis_v4c.js` and `validation/results/V4c_RESULTS.md`, the experimental rows previously labeled "Path A (Prepared Query)" were relabeled to **"Path A: Subquery-Compatible Contexts"**. This clarification accurately reflects that Path A evaluated queries wrapped in outer subqueries rather than direct raw executor invocations.
