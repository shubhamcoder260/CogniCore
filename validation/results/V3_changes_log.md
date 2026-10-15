# Disclosure of Changes Between V3 Evaluation Runs

**Workspace**: `C:\cognicore\validation_workspace`  
**Branch**: `validation`  
**Target Specification**: Step 3b Phase A  
**Reproducibility Command**: `node validation/experiments/reproduce_v3_log.js`  

---

## 1. Executive Summary of Disclosed Changes

During the execution of Step 3 (V3 evaluation suite), two distinct test iterations were executed against the 510-query test corpus across 15 SQLite database fixtures:
1. **First-Run (Initial Pipeline Run, Task 1203)**:
   - Reported **94 leaks** in End-to-End (E1) and **94 leaks** in Policy-Alone (E2).
   - Suffered from two distinct technical flaws:
     - **Leak-Definition Flaw**: The harness classified queries where `originLeak` was true (the query attempted to reference a denied column) as leaks *even when the policy blocked execution before any data could be retrieved*.
     - **Non-Deterministic Ordering Flaw**: Three query constructs containing `LIMIT` clauses without explicit multi-column `ORDER BY` produced arbitrary SQLite B-tree scan order discrepancies against physical DB clones, registering 4 false row differences.
2. **Final-Run (Re-evaluated & Committed Pipeline Run, Commit `025767f`)**:
   - Reported **15 leaks** in End-to-End (E1, all 15 being `schema_qualified` `main.t` base table bypasses).
   - Reported **30 leaks** in Policy-Alone (E2, 15 `schema_qualified` row leaks + 15 `introspection_pragma` column metadata disclosures).

---

## 2. Granular Git History & Code Edit Log

| Sequence | Target File & Lines | Commit / Step | What Changed | Why | Classification |
| :---: | :--- | :---: | :--- | :--- | :---: |
| **1** | `run_v3_evaluation.js:152-165` | Step 1242 | Conditioned `isLeak` on `runResult?.execResult` and actual returned data disclosure. | Blocked column denial queries (`PolicyError`, 403 Forbidden) were incorrectly marked as leaks because `originLeak` was true in the static oracle check. | `leak-definition change` |
| **2** | `run_v3_evaluation.js:272-285` | Step 1246 | Conditioned E2 `isLeak` on successful query execution and actual data/metadata disclosure. | Same as Sequence 1; isolated policy layer blocked queries must not be counted as leaks if no rows were returned. | `leak-definition change` |
| **3** | `v3_build_corpus.js:151,165,179` | Commit `7b1f5d1` | Added explicit multi-column `ORDER BY` to `left_join_right`, `subquery_exists`, and `two_filtered_tables` prior to `LIMIT`. | SQLite Cartesian joins with `LIMIT 50` have non-deterministic tie-breaking across different query plans (CTE vs purged clone), causing 4 false row discrepancies. | `oracle tie-break` |
| **4** | `validation/data/v3/v3_queries.jsonl` | Commit `7b1f5d1` | Regenerated 510 systematic queries with deterministic multi-column ordering. | Incorporates tie-break fix into frozen corpus. | `oracle tie-break` |
| **5** | `PREREG_AMENDMENTS.md:264-268` | Commit `7b1f5d1` | Updated SHA-256 hash of `v3_queries.jsonl` to `67b4ad014d4a8ee017171f706c67b0c7df71556d25b47e58da46764f2922481c`. | Kept amendment ledger in sync with frozen corpus file bytes. | `scope change` |
| **6** | `MANIFEST.json:185` | Commit `7b1f5d1` | Updated `checksums.corpus_v3` with final SHA-256. | Environment snapshot integrity synchronization. | `scope change` |
| **7** | `validation/lib/v3_oracles.js` | Commit `7b1f5d1` | None. Oracle implementation remained identical throughout all V3 runs. | Ground truth multiset diff and column drop logic was sound; issue was how `run_v3_evaluation.js` interpreted oracle outputs on blocked queries. | `no change` |

---

## 3. Empirical Comparison: First-Run vs. Final-Run Leak Counts

### End-to-End Pipeline Execution (E1)

| Variant Construct | First-Run Leaks (Raw) | Final-Run Leaks (Current) | Re-Computed Under First-Run Def | Net Difference & Impact Explanation |
| :--- | :---: | :---: | :---: | :--- |
| `schema_qualified` | 15 | 15 | 15 | Unchanged: True RLS bypass via `main.t` shadowing circumvention (100% leak rate). |
| `select_explicit` | 15 | 0 | 15 | -15: Corrected false leak. Gate/policy threw `PolicyError`; 0 rows returned. |
| `select_star` | 15 | 0 | 15 | -15: Corrected false leak. Gate/policy blocked wildcard access; 0 rows returned. |
| `select_star_alias` | 15 | 0 | 15 | -15: Corrected false leak. Gate/policy blocked table wildcard; 0 rows returned. |
| `subquery_select` | 15 | 0 | 15 | -15: Corrected false leak. Subquery column leak blocked by policy. |
| `column_aliased` | 15 | 0 | 15 | -15: Corrected false leak. Aliased column reference blocked by policy. |
| `left_join_right` | 4 | 0 | 0 | -4: Non-deterministic tie-break eliminated by adding multi-column `ORDER BY`. |
| *All other 27 constructs* | 0 | 0 | 0 | Unchanged. |
| **Total E1 Leaks** | **94** | **15** | **90** | **-79 total (75 false column leaks + 4 ordering tie-breaks)** |

### Isolated Policy-Layer Execution (E2)

| Variant Construct | First-Run Leaks (Raw) | Final-Run Leaks (Current) | Re-Computed Under First-Run Def | Net Difference & Impact Explanation |
| :--- | :---: | :---: | :---: | :--- |
| `schema_qualified` | 15 | 15 | 15 | Unchanged: True RLS bypass via `main.t` (100% leak rate). |
| `introspection_pragma` | 0 | 15 | 15 | +15: Disclosed genuine policy-layer defect (`pragma_table_info` leaks column names). |
| `select_explicit` | 15 | 0 | 15 | -15: Corrected false leak (blocked by policy layer). |
| `select_star` | 15 | 0 | 15 | -15: Corrected false leak (blocked by policy layer). |
| `select_star_alias` | 15 | 0 | 15 | -15: Corrected false leak (blocked by policy layer). |
| `subquery_select` | 15 | 0 | 15 | -15: Corrected false leak (blocked by policy layer). |
| `column_aliased` | 15 | 0 | 15 | -15: Corrected false leak (blocked by policy layer). |
| *All other 27 constructs* | 0 | 0 | 0 | Unchanged. |
| **Total E2 Leaks** | **94** | **30** | **105** | **-64 net difference (-75 false column leaks + 15 PRAGMA leaks - 4 tie-breaks)** |

---

## 4. Reproducibility Proof

To reproduce these exact comparative numbers from the committed raw logs at any time, run:
```bash
node validation/experiments/reproduce_v3_log.js
```
The script loads `v3_e2e_results.jsonl` and `v3_policy_alone_results.jsonl` directly, evaluates every record against both definitions, and outputs the exact counts shown above.
