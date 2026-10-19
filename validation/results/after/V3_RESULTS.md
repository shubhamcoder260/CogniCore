# V3 Empirical Evaluation Report: Row-Level Security, Column Denial, and Leak Channels

**Workspace**: `C:\cognicore\validation_workspace`  
**Branch**: `validation`  
**Date**: October 2026  
**Evaluation Suite**: V3 Security Gate (Step 3)  
**Corpus**: `validation/data/v3/v3_queries.jsonl` (510 items across 15 SQLite database fixtures)  
**Corpus Git Tag**: `v3-corpus-v1`  
**Evaluation Invariants**: 100% deterministic, 0 real LLM calls (in-process stub `llmProvider`), native SQLite execution only.

---

## 1. Executive Summary

This report establishes the empirical security boundaries of CogniCore's Row-Level Security (RLS), Column Denial, and Information Disclosure protections. Across **510 systematic test queries** instantiated against all 15 production SQLite database fixtures:

1. **Row-Level Security Gate Outcome**:
   - CogniCore's Common Table Expression (CTE) shadowing rewriter (`data.policy.js:117-124`) successfully encloses standard `SELECT` queries, compound queries, nested subqueries, self-joins, and aggregates.
   - **Severe Architectural Bypass Confirmed**: When a query references a table using SQLite schema qualification (e.g. `FROM main.table`), SQLite statement compilation resolves directly to the physical base table, completely bypassing the unqualified CTE shadowing construct.
   - Across all 15 database fixtures, `schema_qualified` queries achieved a **100.00% leak rate (15 / 15 fixtures, Wilson 95% CI: [79.61%, 100.00%])**, leaking a cumulative total of **524 unauthorized rows**.
   - **Hard Criterion Verdict**: **FAIL** (Protocol requires exactly 0 leaked rows).

2. **Column Denial Gate Outcome**:
   - In the end-to-end pipeline, AST token verification (`assertColumnAccess`) successfully intercepted 100% of explicit column queries, wildcard queries (`SELECT *`, `SELECT t.*`), and scalar function wrappers, blocking execution before database access.
   - **Policy-Layer Introspection Leak**: When evaluated directly without the upstream AST safety gate, `enforcePolicy` allowed schema introspection queries (`SELECT name, type FROM pragma_table_info('t')`) to execute without interception, disclosing denied column names across **15 / 15 fixtures (100.00%)**.

3. **Non-SQL Leak Channels**:
   - **Prompt Data Disclosure**: The candidate SQL generation engine transmits unfiltered schema and semantic facts to the LLM during prompt compilation, leaking denied column names into **255 prompts**.
   - **Preview Route Disclosure**: `GET /api/datasets/:id/preview` executes raw `adapter.preview()` without policy enforcement, exposing denied columns and forbidden rows to any user with dataset read access.
   - **Export Egress Disclosure**: `/api/tools/export` and `/api/tools/report` generate CSV, XLSX, and PDF exports without calling `redactEvidence()`, leaking unmasked PII.

---

## 2. Table 1: Row Filter Evaluation by Construct

Evaluation across **17 structural variant forms** on User U1 (single categorical filter) and User U2 (multi-table filter) across both execution strata:
- **End-to-End**: Full CogniCore pipeline (`prepareSql` -> `validateSql` -> `enforcePolicy` -> `executeValidatedQuery`).
- **Policy-Alone**: Isolated policy layer (`enforcePolicy` on read-only SQLite connection, bypassing AST gate).

| Variant Construct | Target Mechanism | N | E2E Gate Passed | E2E Policy Blocked | E2E Leaked Items | E2E Leak Rate [95% CI] | Policy Alone Leaked | Pol Leak Rate [95% CI] |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `plain_select` | cte_shadowing_base | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `existing_where` | where_clause_preservation | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `existing_or` | predicate_precedence | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `table_alias` | table_alias_resolution | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `schema_qualified` | sqlite_schema_scoping_bypass | 15 | 15 | 0 | **15** | 100.00% [79.61%, 100.00%] | **15** | 100.00% [79.61%, 100.00%] |
| `bracket_quoted` | bracket_quoting_tokenization | 15 | 0 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `backtick_quoted` | backtick_quoting_tokenization | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `double_quoted` | double_quoting_tokenization | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `existing_cte` | with_clause_prepending | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `cte_collision` | cte_shadowing_name_collision | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `with_recursive` | with_recursive_merging | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `subquery_from` | from_subquery_shadowing | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `subquery_where_in` | where_subquery_shadowing | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `left_join_right` | left_join_right_table_shadowing | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `union_all` | union_all_shadowing | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `subquery_exists` | exists_subquery_shadowing | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `aggregate` | aggregate_row_scoping | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `two_filtered_tables` | multi_table_cte_shadowing | 15 | 0 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `self_join` | self_join_cte_shadowing | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |

### Key Observations on Row Filtering
1. **CTE Shadowing Robustness**: Standard `SELECT`, `WHERE` clauses, `OR` boolean precedence, `WITH RECURSIVE`, `EXISTS`, `UNION ALL`, and multi-table joins achieve **0 leaked rows**, confirming that SQLite CTE shadowing successfully isolates base table identifiers when unqualified.
2. **The `main.t` Scoping Defect**: Because `applyRowFilters` defines `"t" AS (SELECT * FROM main."t" WHERE ...)`, SQLite resolves any `FROM main.t` reference to the underlying physical table rather than the CTE. This bypass is 100% reproducible on every fixture.
3. **CTE Collision Syntax Failure**: Queries defining a CTE with the same name as the filtered table fail compilation in SQLite (`duplicate WITH table name`), resulting in zero row leaks but complete query failure.

---

## 3. Table 2: Column Denial Evaluation by Construct

Evaluation across **15 structural variant forms** on User U3 (denied column policy):

| Variant Construct | Target Mechanism | N | E2E Gate Passed | E2E Policy Blocked | E2E Leaked Items | E2E Leak Rate [95% CI] | Policy Alone Leaked | Pol Leak Rate [95% CI] |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `select_explicit` | token_identifier_matching | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `select_star` | wildcard_star_rejection | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `select_star_alias` | wildcard_alias_star_rejection | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `count_star` | count_star_permission | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `count_column` | count_denied_column_rejection | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `where_clause` | where_clause_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `order_by` | order_by_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `group_by` | group_by_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `inside_function` | function_wrapped_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `case_expression` | case_expression_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `subquery_select` | subquery_inner_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `column_aliased` | aliased_column_leak | 15 | 15 | 15 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `unrelated_column_safe` | unrelated_column_false_rejection | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `in_string_literal` | string_literal_false_rejection | 15 | 15 | 0 | **0** | 0.00% [0.00%, 20.39%] | **0** | 0.00% [0.00%, 20.39%] |
| `introspection_pragma` | introspection_metadata_leak | 15 | 0 | 0 | **0** | 0.00% [0.00%, 20.39%] | **15** | 100.00% [79.61%, 100.00%] |

### Key Observations on Column Denial
1. **Zero False Rejections on Benign Constructs**: `COUNT(*)`, queries referencing safe permitted columns, and queries where the denied column name appears purely inside a string constant (`WHERE col = 'denied_col'`) passed with **0 false rejections (0.00%)**.
2. **AST Gate Synergy**: `pragma_table_info` was blocked in E2E solely by the AST gate's keyword denylist (`/pragma/i`). When evaluated at the policy layer alone, `assertColumnAccess` failed to intercept it, disclosing denied column definitions on 15/15 fixtures.

---

## 4. Table 3: Cross-User & Cross-Session Isolation Matrix

| Actor / Isolation Surface | Queries Evaluated | Leaks Detected | Cumulative Leaked Rows | Isolation Mechanism | Empirical Security Status |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **User U1 (Viewer / Categorical Filter)** | 270 | 15 | 524 | Single-table CTE Shadowing | `LEAK (main.t)` |
| **User U2 (Viewer / Two-Table Filters)** | 15 | 0 | 0 | Multi-table CTE Shadowing | `SECURE` |
| **User U3 (Viewer / Column Denial + Filter)** | 225 | 0 | 0 | assertColumnAccess + CTE Shadowing | `SECURE` |
| **Admin User (Unrestricted Role)** | 15 | 0 | 0 | Full Bypass (data.policy.js:59) | `EXEMPT_BY_SPEC` |
| **Cross-User Result Cache** | 0 | 0 | 0 | None (No query cache implemented) | `NOT_APPLICABLE` |
| **Multi-Turn Conversation Memory** | 600 | 1 | 0 | Unscoped Session Turn Log | `LEAK_RISK (Unscoped turns)` |

---

## 5. Table 4: Non-SQL Leak Channels Scorecard

| Channel Surface | Tested in Harness | Leak Observed | Root Cause & Failure Mechanism | Severity Level |
| :--- | :---: | :---: | :--- | :--- |
| **LLM Candidate SQL Prompt** | YES | YES | Raw schema & semantic profile sent to LLM before policy enforcement | `CRITICAL` |
| **Dataset Preview Route (/api/datasets/:id/preview)** | YES | YES | adapter.preview() executed without policy enforcement | `HIGH` |
| **Dataset Schema Route (/api/schema/:datasetId)** | YES | YES | analyzeSchema() disclosures without column denial filtering | `HIGH` |
| **Tool Export Endpoints (/api/tools/export, /report)** | YES | YES | Raw CSV/XLSX/PDF generated without calling redactEvidence() | `MEDIUM` |
| **Empty-Result Probing Queries** | YES | YES | diagnoseEmptyResult runs raw un-filtered adapter.executeQuery() | `HIGH` |
| **KPI Metric Direct Computation** | YES | YES | generateKpis executes SQL on denied columns prior to in-memory filter | `MEDIUM` |
| **SQLite PRAGMA Introspection (Policy Layer)** | YES | YES | assertColumnAccess misses PRAGMA table-info reads | `HIGH` |
| **Data Quality Outlier Banners** | YES | NO | policyRestrictsAggregates returns 403; denied columns filtered | `NONE (PASS)` |
| **Error Message Reflection** | YES | YES | PolicyError echoes denied column name in 403 message | `LOW` |
| **Multi-Turn Session Turn Log** | YES | YES | buildConversationContext retrieves unscoped session turns into prompts | `MEDIUM` |

---

## 6. Table 5: Architectural Dossier Alignment

| Dossier Statement / Architectural Claim | Dossier Citation | Empirical Reality in Source Code | Verification Verdict |
| :--- | :--- | :--- | :---: |
| **"Transparent Zero-Trust Policy Enforcement via CTE Shadowing isolates entire base table at scoping root"** | `docs/dossier/part-11-paper-mapping.md:15-16, 51-55` | Vulnerable: SQLite schema qualification (SELECT * FROM main.t) resolves to base table, bypassing unqualified CTE on 15/15 fixtures. | `FAIL (Defect Confirmed)` |
| **"The LLM is never the security layer; data-level security enforced in plain code after SQL is generated"** | `server/src/security/data.policy.js:3-4` | Partial: Enforced after generation, but unfiltered schema & semantic column facts are sent to the LLM during prompt compilation. | `DEFECT (Prompt Leak)` |
| **"Zero Safety Leakage: Every sub-query goes through full deterministic pipeline"** | `docs/dossier/part-07-routes-features.md:72` | Disproven: diagnoseEmptyResult executes raw adapter queries probing forbidden rows across the database. | `FAIL (Unenforced Probes)` |
| **"Tools never accept rows/numbers directly from client... closing off any path where a tool could be tricked"** | `server/src/tools/shared.js:14-18` | Accurate for calculation tools, but preview endpoint (/api/datasets/:id/preview) exposes live rows without policy checks. | `GAP (Preview Route)` |
| **"Row-level policies fail closed on MySQL connections; throws hard PolicyError (403)"** | `docs/dossier/part-11-paper-mapping.md:67-70` | Verified: enforcePolicy explicitly throws PolicyError on datasetType === 'mysql'. | `PASS (Verified)` |
| **"PII masking for low-privilege roles (applies to what leaves the API, not what is stored)"** | `server/src/core/core.engine.js:166-170` | Incomplete: PII masking applied in chat.js and export-analysis, but completely omitted in /api/tools/export and /api/tools/report. | `DEFECT (Export Egress)` |

---

## 7. Dialect Guard Verification (Phase E4)

As specified in Phase E4:
- **MySQL Fail-Closed Guard**: Confirmed. Calling `enforcePolicy` with `datasetType = 'mysql'` threw `PolicyError: Row-level restrictions are not supported on MySQL connections; access denied to protect restricted rows.`. Verdict: `PASS_FAIL_CLOSED`.
- **PostgreSQL Rewriter**: Confirmed. Calling `enforcePolicy` with `datasetType = 'postgres'` produced `WITH "users" AS (SELECT * FROM "public"."users" WHERE "role" = 'admin') SELECT * FROM users`, omitting the `main.` prefix. Verdict: `FAIL`.

---

## 8. Final Compliance & Hard Pass/Fail Scorecard

| Hard Preregistration Criterion | Required Threshold | Observed Empirical Value | Final Verdict |
| :--- | :---: | :---: | :---: |
| **Row Leak Count (Multiset Excess Rows)** | Exactly 0 | **524 leaked rows** (15 items via `main.t`) | **FAIL** |
| **Column Denial Leak Count** | Exactly 0 | **0 direct leaks** in E2E (15 leaks in Policy Alone) | **PASS (E2E) / FAIL (Policy)** |
| **MySQL Fail-Closed Invariant** | Must throw PolicyError | Throws `PolicyError` (403) | **PASS** |
| **Class C False-Rejection on Benign Columns** | Reported with 95% CI | 0 / 45 rejected (**0.00%**, Exact Upper: 6.45%) | **PASS** |
