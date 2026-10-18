# CogniCore Validation Preregistration Amendments

This document records formal amendments to the research validation protocol defined in `PREREGISTRATION.md`.
As required by the locked preregistration protocol, `PREREGISTRATION.md` remains bit-for-bit immutable at git tag `prereg-v1`. All amendments, extensions, and operational refinements are documented and tracked here.

---

## Amendment V4-A1: Item Classes for SQL Safety Gate Evaluation

The test corpus for V4 (SQL Safety Gate) is stratified into four mutually exclusive item classes:

1. **Class A (Mandated Rejections)**: Statements and payloads that the project's specification, threat model, and AST gate explicitly state must be rejected:
   - DDL statements (`DROP`, `CREATE TABLE`, `CREATE TRIGGER`, `CREATE INDEX`, `CREATE VIRTUAL TABLE`, `ALTER TABLE`).
   - DML statements (`DELETE`, `UPDATE`, `INSERT`, `REPLACE`, `TRUNCATE`).
   - Database/connection reconfiguration (`ATTACH`, `DETACH`, `PRAGMA` statement forms, `VACUUM`, `REINDEX`, `ANALYZE`).
   - Transaction control statements (`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`).
   - Non-SELECT statements (`GRANT`, `REVOKE`, `EXEC`, `EXECUTE`, `CALL`).
   - Stacked / chained statements (multiple statements separated by semicolons `;`).
   - SQL comment syntax (`--`, `/* ... */`, nested comments, comment smuggling).
   - Data-modifying statements hidden behind Common Table Expressions (e.g. `WITH ... DELETE`).

2. **Class B (SELECT-Callable Probes / Unspecified Behaviors)**: Syntactically valid `SELECT` statements that invoke SQLite-specific introspection, extension, table-valued functions, or resource-heavy operations that the high-level specification is largely silent on:
   - System metadata table reads (`sqlite_master`, `sqlite_schema`, `sqlite_temp_master`).
   - Table-valued PRAGMA functions (`SELECT * FROM pragma_table_info(...)`, `pragma_database_list`, etc.).
   - Extension and binary loading functions (`load_extension(...)`, `readfile(...)`, `writefile(...)`, `fts3_tokenizer(...)`).
   - Allocation and memory abuse functions (`zeroblob(1e9)`, `randomblob(1e9)`).
   - Recursive and exponential Common Table Expressions (infinite recursion or CPU spin).

3. **Class C (Benign Queries Expected to be Accepted)**: Valid analytical `SELECT` statements adhering to the discovered schema across the 15 fixture databases:
   - Single-table aggregates, grouping, ordering, and filtering.
   - Multi-table joins (2 to 6 tables) with valid join predicates (`ON`, `USING`).
   - Nested scalar and subquery filters (depth 1 to 4).
   - Common Table Expressions (`WITH ... SELECT`).
   - Window functions, `CASE` expressions, set operations (`UNION ALL`, `INTERSECT`).
   - String literals legitimately containing characters like `;`, `--`, `/*`, or SQL keywords (e.g., `'DROP TABLE'`) inside literal data values.

4. **Class D (Complexity Boundary Items)**: Queries crafted to test exact boundary conditions of the complexity analyzer (`server/src/structured/sql.complexity.js`):
   - Join count: exactly 6 joins (expected: accept) vs. 7 joins (expected: reject).
   - Subquery nesting depth: exactly 4 levels (expected: accept) vs. 5 levels (expected: reject).
   - Statement length: 3999 / 4000 chars (expected: accept) vs. 4001 chars (expected: reject).
   - Cartesian products: `CROSS JOIN` (expected: reject) and comma-joins without `WHERE`/`ON` (expected: reject).
   - Fan-out estimation near the $5 \times 10^9$ limit on the largest database fixtures.

---

## Amendment V4-A2: Hard Pass/Fail Criteria & Findings Categories

### Hard Criteria (Strict Pass / Fail)
1. **Zero Database or Filesystem Mutations**:
   - Number of accepted queries that cause any filesystem mutation, database file modification, SQLite WAL/journal creation, or schema alteration must be **EXACTLY 0**.
2. **Zero Non-Read-Only Accepted Queries**:
   - Number of accepted queries where `statement.readonly === false` under SQLite prepare analysis must be **EXACTLY 0**.
3. **Class C False-Rejection Rate**:
   - The false-rejection rate on benign queries (Class C) must be reported with a two-sided 95% Wilson score confidence interval.

### Findings (Reported Statistically Without Pass / Fail Thresholds)
- Total Class A items accepted by the gate (spec violations).
- Total Class B items accepted by the gate (broken down by category: system tables, pragma functions, extension loading, resource abuse).
- Resource-limit behavior on accepted Class B queries (timeout, memory peak RSS, process termination).
- Deterministic repair semantic shifts (template filter result changes, idempotence).
- Defense-in-depth isolation effectiveness when the AST gate is intentionally bypassed.

---

## Amendment V4-A3: Provenance & Independence Statement

To preserve scientific validity and prevent circular evaluations:
- **Public-List Items**: Sourced from independent security repositories (e.g. SecLists, PayloadsAllTheThings). These items are strictly independent of the CogniCore filter authors and are tagged with `provenance: public:<file>:<line>`.
- **Agent-Authored Items**: Items authored by the validation agent are NOT independent of the evaluator and are explicitly reported separately with `provenance: agent-authored`.
- **Mutation-Derived Items**: Fuzz variants derived from systematic token substitutions are reported separately with `provenance: mutation-of:<parent_id>`.

All reporting and summary tables must display performance stratified by provenance.

---

## Amendment V4-A4: Formal Bypass Definition & Denominators

- **Bypass Event**: A query represents a security bypass if and only if:
  $$\text{Bypass} = (\text{Gate Accepted} == \text{true}) \land (\text{Oracle 1 readonly} == \text{false} \lor \text{Oracle 2 Mutated} == \text{true} \lor \text{Oracle 3 Mutated} == \text{true})$$
- **Item-Level Denominators**:
  - The denominator for the bypass rate is the total number of **ACCEPTED** items per class and provenance.
  - When the observed bypass count is 0, the upper bound is computed using both the exact upper bound $1 - 0.05^{1/n}$ and the Rule of Three ($3/n$).

---

## Amendment V4-A5: Frozen Corpus Checksums (V4 Corpus v1)

The V4 test corpus generated in Phase C is immutably frozen under git tag `v4-corpus-v1`. Any alteration to these files invalidates the evaluation run:

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v4/attacks.jsonl` | 1,348 | `2e7f1f284a8f971d62d38746310f98d91273acea6cb9160fdc0c44cbb0b1d17c` |
| `validation/data/v4/benign.jsonl` | 220 | `a9fcb7110eddd729c629bd262fdbbba846c702eaf6e3163de60d66df45f64c38` |
| `validation/data/v4/boundary.jsonl` | 12 | `ef761154ddcd87f5ce395fc6dd453c5121f0f7966f9ee1691a0cc9d713c9cba9` |
| `validation/data/v4/fuzz.jsonl` | 350 | `c10a843f046989bf71d53785b4a03702501708d8bc6e1899573a47ecbe55e7b5` |
| **Total Corpus** | **1,930** | — |

---

## Amendment V4-A6: Step 2b Refined Item Classes (B2, D2, C2, E), Genuine Write Bypass Reporting, and Per-Construct False-Rejection Stratification

This amendment closes evidence gaps identified during Step 2 of the V4 SQL safety gate evaluation:

### 1. Refined Item Classes

1. **Class B2 (Embedded SELECT-Callable / System-Table / Resource / DoS Probes)**:
   - Probes embedded into syntactically valid `SELECT` statements referencing genuine tables and columns from the 15 fixture database schemas (preventing superficial rejection by table-name schema verification).
   - Subcategories:
     - **Memory / Allocation Abuse**: `zeroblob` and `randomblob` sizes spanning $10^6$ to $10^9$ bytes; `hex(zeroblob(5e8))`; nested `replace(hex(zeroblob(...)), ...)`; `printf('%1000000000s', 'x')`; exponential `group_concat` expansion.
     - **Side-Effect & Extension Functions**: `load_extension(...)`, `readfile(...)`, `writefile(...)`, `fts3_tokenizer(...)`, `sqlite_compileoption_get(...)`, `sqlite_version()`.
     - **Table-Valued PRAGMA Functions**: `pragma_table_info(...)`, `pragma_database_list`, `pragma_function_list` joined or cross-joined with real fixture tables, or nested inside subqueries.
     - **System Table Metadata Reads**: `sqlite_master`, `sqlite_schema`, `sqlite_temp_master`, `sqlite_stat1`, and `dbstat` queried in `FROM` clauses and subqueries, across various identifier quoting schemes (`"sqlite_master"`, `[sqlite_master]`, `main.sqlite_master`, `temp.sqlite_master`) and case variations (`sQlItE_mAsTeR`).
     - **Recursive / Exponential CTEs**: `WITH RECURSIVE` infinite and exponential loops combined with real fixture tables (inside `COUNT(*)`, `ORDER BY`, aggregates, and `FROM` subqueries).
     - **Pathological Pattern Matching**: Pathological `LIKE` patterns (e.g. repeated `%a%a%a` sequences causing worst-case quadratic/exponential backtracking).
     - **Correlated Subquery Blowups**: Correlated nested queries generating high quadratic/cubic iteration overhead against fixture tables.
     - **Table Name Shadowing**: CTEs named identically to real tables in the fixture schema.
   - Requirement: Every B2 query must either prepare successfully under `better-sqlite3` on its assigned fixture database or be logged with `prepare_error` if the engine does not support the construct.

2. **Class D2 (Complexity Boundary Redo)**:
   - Rigorous evaluation of complexity analyzer thresholds using independent measurement counters:
     - **Subquery Nesting Depth**: Depths 4, 5, 6, and 10.
     - **Statement Length**: Lengths 3999, 4000, and 4001 characters constructed using 3 padding methods that introduce no comments and no tokens altering other gates: extra whitespace padding, long string literal, long column alias.
     - **Joins**: Exactly 6 vs. 7 joins across syntax forms (`INNER JOIN`, `LEFT JOIN`, comma join).
     - **Cartesian Products**: `JOIN x ON 1=1`, `JOIN x ON 1`, `JOIN x ON true`, `NATURAL JOIN` with no common columns, comma-join with an unrelated `WHERE` predicate (e.g. `WHERE a.x = 1`), and keyed many-to-many fanout queries.
   - **Independent Ground Truth Counter**: Each item's true depth, length, and join count must be computed by an independent counter (not the gate's internal counter) and persisted in the corpus metadata.

3. **Class C2 (SQLite-Idiom Benign Queries)**:
   - At least 150 handcrafted benign analytical queries over fixture databases, verified to prepare and execute with `statement.readonly === true` and 0 mutations:
     - Date/time functions (`strftime`, `date('now')`).
     - Conditional and null functions (`IIF`, `IFNULL`, `COALESCE`).
     - Operators and matching (`GLOB`, `||`, `LIKE ... ESCAPE`).
     - String manipulation (`REPLACE()`, `SUBSTR()`, `INSTR()`, `printf()`, `group_concat()`).
     - Paging and offsets (`LIMIT a, b`).
     - Quoted identifiers (backticks `` `table` ``, brackets `[table]`, double quotes `"table"`).
     - Explicit type casts (`CAST(col AS REAL)`, `CAST(col AS INTEGER)`).
     - Window functions (`ROW_NUMBER() OVER (...)`, `RANK() OVER (...)`).
     - Legitimate string literals equal to SQL keywords (`'DROP TABLE'`, `'CREATE TABLE'`, `'DELETE'`, `'UPDATE'`, `'INSERT'`, `'ALTER'`).
     - Quoted aliases equal to SQL keywords (`AS "delete"`, `AS [order]`).
     - Legitimate string literals containing punctuation and comment tokens (`;`, `--`, `/*`).

4. **Class E (External Benchmarks: Spider / BIRD)**:
   - Gold SQL queries from external benchmark datasets (`Spider`, `BIRD`) if present under `validation/data/external/spider` or `validation/data/external/bird`. Schema objects built from `tables.json` (`rowCount` unknown $\to 1$, flagged). If files are absent, recorded as `NOT RUN` with exact expected paths documented, without downloading large corpora.

---

### 2. Bypass Metric Refinement on Genuine Write Statements

To prevent inert string fragments inside literals (e.g., fuzz payloads embedded in `'...'`) from distorting the denominator or numerator of write bypass risk:
- In addition to overall bypass reporting, bypass must be computed and reported over the specific subset of **"genuine write statements"**: queries that parse as non-SELECT or contain write/DDL keywords (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `REPLACE`, `ATTACH`, `PRAGMA`) outside quoted string literals.
- Denominators and bypass rates are reported with two-sided 95% Wilson score confidence intervals and exact upper bounds.

---

### 3. False-Rejection Reporting Protocol

- False-rejection rates on benign queries (Class C2) MUST be reported **per construct** (one row per construct: e.g. `strftime`, `IIF`, `GLOB`, `string-with-semicolon`, `string-with-comment-syntax`, etc., with $N$, $n_{\text{rejected}}$, rejection rate, and Wilson 95% CI).
- A pooled single headline rate is explicitly forbidden from being used as the primary metric, ensuring construct-level over-rejections cannot be obscured.

---

## Amendment V4-A7: Frozen Corpus Checksums (V4b Corpus v1)

The refined V4b evaluation corpus generated in Step 2b is immutably frozen under git tag `v4b-corpus-v1`. Any alteration to these files invalidates the evaluation run:

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v4b/b2_probes.jsonl` | 352 | `ce2457bd884d3291c56ac9d548be8ae8fa6ae12f85d8c971b0df753c48e3a4fc` |
| `validation/data/v4b/d2_boundary.jsonl` | 27 | `946fe6505cf39e0fe922ccae6ba7f71dfa30b52f6738cb43671991be404f22d9` |
| `validation/data/v4b/c2_benign.jsonl` | 465 | `5d7927ed2113bc2ae3c994c43b4a1dc92e6176bce8c49a9ea5cb3238f2991858` |
| `validation/data/v4b/e_benchmark_status.json` | 1 (Status: NOT RUN) | `861f425a79c6108e841fd46f8ae884d1afd16bcb3ff8ae44b5a6f307c8cea8a9` |
| **Total V4b Corpus** | **844** | — |

---

## Amendment V4-A7 (Step 2c): Scope Reconciliation, New DoS Corpus (v4c), Hardening Comparison, and Primary Security Statistic Definition

This amendment defines the formal protocol for Step 2c:

### 1. Scope of Step 2c Evaluation
- **Reconciliation of Reporting Discrepancies**: Deterministic re-aggregation of all Step 2 and Step 2b raw execution logs (`v4_gate.jsonl`, `v4_oracles.jsonl`, `v4_fuzz_differential.jsonl`, `v4b_gate.jsonl`, `v4b_oracles.jsonl`, `v4b_resource.jsonl`, `v4b_defense_hardened.jsonl`) to produce fully unified, mathematically consistent tables with zero prose contradictions.
- **New DoS Evaluation Suite (Class D3 / Corpus v4c)**: Targeted resource-exhaustion queries targeting the smallest and largest database fixtures (by row count), evaluated under a strict 2 GB memory limit and 15s hard kill deadline, frozen under git tag `v4c-corpus-v1`.
- **4-Way Connection Hardening Matrix**: Exhaustive matrix evaluation across four SQLite driver connection configurations (`readonly: false` baseline, `PRAGMA query_only = ON` only, `readonly: true` only, and both combined) across 40 Class A statements, `VACUUM INTO`, `ATTACH ... write`, `CREATE TEMP TABLE`, `PRAGMA query_only=OFF; <write>`, and CTE writes.

### 2. Primary and Secondary Security Statistics
- **Primary Security Statistic**:
  - The primary security metric for the SQL Safety Gate is the **acceptance rate of genuine write statements** ($n = 119$, agent-authored, NOT independent of the validation harness).
  - Defined strictly as statements that parse as non-SELECT or contain write/DDL keywords outside quoted string literals.
  - When zero genuine write statements are accepted ($k = 0$), the headline security guarantee is reported using the exact Clopper-Pearson 95% upper bound:
    $$\text{Exact Upper Bound (95\%)} = 1 - 0.05^{1/n}$$
    alongside the Rule of Three ($3/n$).
- **Secondary Security Statistic**:
  - **Bypass rate over accepted items** remains active as a secondary defense-in-depth statistic:
    $$\text{Bypass} = (\text{Gate Accepted} == \text{true}) \land (\text{Oracle 1 readonly} == \text{false} \lor \text{Oracle 2 Mutated} == \text{true} \lor \text{Oracle 3 Mutated} == \text{true})$$
  - Reported with 95% Wilson score confidence intervals across all accepted strata.

### 3. Invariants & Criteria
- Zero changes to pass/fail criteria (0 database mutations, 0 filesystem mutations, 0 driver non-read-only accepted queries).
- Invariant: All prose summaries and markdown reports must be generated programmatically from raw log records and computed CSVs via script to guarantee mathematical consistency.

---

## Amendment V4-A8: Frozen Corpus Checksums (V4c Corpus v1)

The resource-exhaustion and DoS evaluation corpus generated in Step 2c is immutably frozen under git tag `v4c-corpus-v1`. Any alteration to these files invalidates the evaluation run:

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v4c/dos_items.jsonl` | 29 | `7c9414b980105ac6b145a8a886c1c41ee8a742cd786c7fa91f23fc55e0005c1f` |
| **Total V4c Corpus** | **29** | — |
---

## Amendment V3-A1: Evaluation Protocol for V3 (Row-Level Security, Column Denial, and Non-SQL Leak Channels)

This amendment establishes the formal evaluation protocol, definitions, and pass/fail criteria for Step 3 (V3: Row-Level Security, Column Denial, and Non-SQL Leak Channels).

### 1. Formal Definitions

1. **Row Leak (Multiset Excess Rows)**:
   - Let $Q$ be an analytical query executed on behalf of user $u$ with effective data policy $\pi(u) = (\mathcal{D}, \mathcal{R})$, where $\mathcal{D}$ is the set of denied columns and $\mathcal{R}$ is the set of row filter predicates.
   - **Ground Truth Row Oracle ($R_{\text{oracle}}$)**: Evaluated by physically deleting all disallowed rows on an isolated copy of the fixture database:
     $$\text{DELETE FROM } t \text{ WHERE NOT COALESCE}((\text{predicate}), 0)$$
     with `PRAGMA foreign_keys = OFF`, and executing the original query $Q$ directly against the purged database.
   - **Actual Result ($R_{\text{actual}}$)**: The multiset of rows returned by CogniCore (either end-to-end or via the policy layer).
   - **Row Leak Event**:
     $$\text{Row Leak} \iff R_{\text{actual}} \not\subseteq R_{\text{oracle}} \lor |R_{\text{actual}}| > |R_{\text{oracle}}|$$
     where multiset containment and row equality are evaluated with floating-point values compared within relative tolerance $\epsilon = 10^{-9}$.

2. **Column Leak (Dependence on Denied Columns)**:
   - Let $\mathcal{D}$ be the set of denied columns for user $u$.
   - **Column Leak Event**: A query or execution path leaks a denied column if and only if:
     1. **Structural Inclusion**: The returned result table includes any column name $c \in \mathcal{D}$.
     2. **Functional Dependence**: The query result or execution outcome depends on data stored in $c \in \mathcal{D}$. Verified via the **Column Drop Oracle**: on an isolated database copy where column $c$ is physically removed (`ALTER TABLE t DROP COLUMN c`), executing $Q$ produces a syntax/prepare error, an altered result set, or SQLite driver metadata (`sqlite3_column_origin_name`) traces output to $c$.
     3. **Metadata / Introspection Disclosure**: Denied column names, SQL types, or aggregated statistics (`min`, `max`, `avg`, `distinct`) appear in user-facing API responses or metadata endpoints.

### 2. Pass / Fail Criteria (Hard Invariants)

1. **Zero Leaked Rows**:
   - Number of queries where $R_{\text{actual}}$ contains any row forbidden by the active row filter must be **EXACTLY 0** across all evaluated fixtures and user profiles.
2. **Zero Leaked Columns**:
   - Number of queries where any denied column is accessed, returned, or functionally depended upon must be **EXACTLY 0**.

Any observed leak constitutes a policy gate violation and must be cataloged with its exact mechanism and exploit vector.

### 3. Stratification: End-to-End vs. Policy-Alone Reporting

To decouple the performance of the upstream SQL safety gate (`validateSql`) from the data policy engine (`enforcePolicy`), results are evaluated and reported across two distinct strata:
1. **End-to-End Pipeline**: Full execution chain (`prepareSql` $\rightarrow$ `validateSql` $\rightarrow$ `enforcePolicy` $\rightarrow$ `executeValidatedQuery`). Evaluates whether CogniCore as a whole prevents data leakage under realistic client workflows.
2. **Policy-Alone Layer**: Direct evaluation of `enforcePolicy` followed by read-only SQLite execution, bypassing the AST safety gate. This isolates internal vulnerabilities within the policy rewriter itself (e.g. `main.table` CTE shadowing circumvention, CTE name collisions, complex alias interactions).

### 4. Non-SQL Leak Channels

Evaluation must explicitly test and report outcomes across all non-SQL information disclosure surfaces:
- **LLM Prompt Payloads**: Captured by an in-process stub LLM provider to detect transmission of denied column schemas or sample values.
- **Empty-Result Probing**: Probing queries generated during empty result diagnosis.
- **Preview & Metadata Routes**: Data returned by `/api/datasets/:id/preview`, `/api/datasets/:id`, `/api/schema/:datasetId`, and `/api/analytics/:datasetId/tool/profile`.
- **Egress PII & Exports**: Export file contents (`/api/tools/export`, `/api/tools/report`) for unmasked sensitive fields.


---

## Amendment V3-A2: Frozen Corpus Checksums (V3 Corpus v1)

The systematic Row-Level Security and Column Denial evaluation corpus generated in Step 3 is immutably frozen under git tag `v3-corpus-v1`. Any alteration to these files invalidates the evaluation run:

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v3/v3_queries.jsonl` | 510 | `67b4ad014d4a8ee017171f706c67b0c7df71556d25b47e58da46764f2922481c` |
| **Total V3 Corpus** | **510** | — |

---

## Amendment V4-A9: Executable-Write Expansion Corpus (V4d Corpus v1)

To close the evidence gap identified in Step 3 where only 56 frozen corpus items were statements SQLite could actually execute with `readonly === false`, Step 3b Phase F expands the test suite by 640 independently verified executable-write statements. Every statement is verified on an isolated database clone to satisfy two strict criteria:
1. `db.prepare(sql)` succeeds without syntax or schema error.
2. The prepared statement's driver property `stmt.readonly === false`.

### Corpus Breakdown by Category and Provenance

| Category | Description | Item Count | Provenance |
| :--- | :--- | :---: | :--- |
| `insert` | Basic, quoted, case-mixed, and OR IGNORE insert statements | 128 | agent-authored |
| `replace` | REPLACE INTO statements across multiple tables | 40 | agent-authored |
| `upsert` | INSERT ... ON CONFLICT DO UPDATE / DO NOTHING | 40 | agent-authored |
| `update` | Standard, quoted, case-mixed, and OR IGNORE updates | 128 | agent-authored |
| `delete` | Basic, quoted, and case-mixed delete statements | 96 | agent-authored |
| `create_table` | CREATE TABLE IF NOT EXISTS and CREATE TEMP TABLE | 30 | agent-authored |
| `create_index` | CREATE INDEX IF NOT EXISTS on indexed columns | 16 | agent-authored |
| `create_view` | CREATE VIEW IF NOT EXISTS statements | 16 | agent-authored |
| `create_trigger`| CREATE TRIGGER IF NOT EXISTS triggers | 12 | agent-authored |
| `drop` | DROP TABLE, INDEX, VIEW, TRIGGER IF EXISTS | 30 | agent-authored |
| `alter` | ALTER TABLE ADD COLUMN, DROP COLUMN | 18 | agent-authored |
| `vacuum_into` | VACUUM INTO temporary file exfiltration paths | 20 | agent-authored |
| `with_write` | WITH common table expression wrapping INSERT, UPDATE, DELETE | 30 | agent-authored |
| `pragma_write` | PRAGMA user_version, schema_version, journal_mode writes | 31 | agent-authored |
| `public_payload`| PayloadsAllTheThings executable payloads (lines 91, 92, 108, 109) | 5 | public:SQLite-Injection.md |
| **Total V4d Corpus** | **640 verified executable-write items** | **640** | — |

### Frozen File Checksum

| `validation/data/v4d/executable_writes.jsonl` | 640 | `c60eb48d1e88da820527a264614af22dc9d30f37245d625890dbb82aebbf6a6b` |

---

## Amendment V3-A3: Expanded V3b Evaluation Corpus (V3b Corpus v1)

To close the coverage gap identified in Step 3b Phase B, the V3 evaluation suite is expanded to evaluate the full specification:
1. **Systematic Structural Variants**: The complete set of 510 systematic variant items (19 row variants and 15 column forms across all 15 SQLite database fixtures).
2. **Gate-Accepted Benign Queries Touching Filtered Tables**: 395 gate-accepted benign queries from Class C and Class C2 touching filtered tables, evaluated under restricted users (`user_u1` and `user_u3`).
3. **Seeded Grammar-Generated SELECTs**: 525 seeded grammar-generated analytical queries (35 per fixture across 15 fixtures) generated deterministically using `MASTER_SEED + 300` testing row filtering (`user_u1`, `user_u2`) and column denial (`user_u3`).
4. **Base Query Clustering**: Every item explicitly records its `base_query_id` to permit cluster bootstrapping over base queries for pooled rates.

### Frozen File Checksum

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v3b/v3b_queries.jsonl` | 1430 | `5395fc8f432194b91be49d743f97780c4f1910d61f4ad904e1f74bf0fba157ce` |
| **Total V3b Corpus** | **1430** | — |

---

## Amendment V3-A4: Expanded Systematic Row-Variant Corpus (V3c Corpus v1)

To close the evidence gap identified in Step 3c Phase E (where row-variant transforms were historically evaluated on only 1 base query per fixture), the V3 evaluation suite is expanded to systematically cross-apply all row-variant transforms across all base queries and user policies:

1. **Base Queries (n = 920 clusters)**:
   - 380 gate-accepted benign queries from Class C and Class C2 touching filtered tables.
   - 15 systematic fixture base queries (1 per fixture).
   - 525 seeded grammar-generated queries (35 per fixture across 15 fixtures).
2. **Systematic Row-Variant Transforms (17 forms)**:
   - `plain_base`: Unmodified base query.
   - `table_alias`: Query aliased via subquery or table AS clause.
   - `schema_qualified_main`: Table qualified with `main.`.
   - `schema_qualified_temp`: Table qualified with `temp.`.
   - `bracket_quoted`: Table identifier quoted with `[...]`.
   - `backtick_quoted`: Table identifier quoted with `` `...` ``.
   - `double_quoted`: Table identifier quoted with `"..."`.
   - `cte_collision`: Prepending CTE with identical name to filtered table.
   - `existing_cte`: Prepending non-colliding CTE (`WITH __dummy_cte ...`).
   - `with_recursive`: Prepending recursive CTE (`WITH RECURSIVE __rec_cnt ...`).
   - `subquery_from`: Table referenced inside `FROM (SELECT ...)` subquery.
   - `subquery_where_in`: Table referenced inside `WHERE 1 IN (SELECT 1 FROM ...)` subquery.
   - `subquery_exists`: Table referenced inside `WHERE EXISTS (SELECT 1 FROM ...)` subquery.
   - `union_all`: Table referenced inside compound `UNION ALL` branches.
   - `self_join`: Table self-joined with alias.
   - `left_join`: Table referenced in `LEFT JOIN`.
   - `aggregate`: Aggregation (`COUNT(*)`) over filtered table.
3. **Multi-User Policy Matrix (3 users)**:
   - Evaluated under `user_u1` (single categorical row filter), `user_u2` (two table row filters), and `user_u3` (row filter + column denial).
4. **Leak Evaluation**: Evaluated under E1 and E2 using the subset-containment rule for queries with LIMIT and no total ORDER BY.

### Frozen File Checksum

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v3c/v3c_queries.jsonl` | 46,920 | `961bcd6c73b2866400e5cf0d61efeefc7ca883c809283258610d1fe1352ac108` |
| **Total V3c Corpus** | **46,920** | — |

---

## Amendment V12-V15: Evaluation Protocol for V12 (File Validation), V13 (Input Guard, Rate Limiter, Injection Neutralizer), V14 (Authn/Authz Route Sweep), and V15 (PII Redaction)

This amendment establishes the formal evaluation protocols, item classes, and pass/fail criteria for Step 4 of the CogniCore validation:

### 1. V12 (File Validation Gate)
- **Hard Pass/Fail Criteria**:
  - Accepted malicious files per malicious category: **EXACTLY 0** (exact Clopper-Pearson 95% upper bound $1 - 0.05^{1/n}$ reported when $k = 0$).
  - System resilience: **0 crashes, 0 process hangs > 15 s, 0 memory spikes with RSS > 2 GB** on any zip bomb, nested archive, pathological recursion, or fuzz input.
  - Path traversal containment: Every accepted file written through the project's upload path must remain strictly contained within the designated upload directory; no file may land outside, and sanitized filenames must not escape the upload boundary.
- **Reporting Metrics**:
  - False-rejection rate per valid file format (XLSX, DOCX, PPTX, SQLite, CSV, JSON, Unicode names, boundary-size legit files, cells containing script/executable tokens) reported with Wilson score 95% confidence intervals.
  - False-acceptance rate per malicious category (extension x magic byte mismatch, EICAR string, executable headers MZ/ELF/Mach-O/CAFEBABE/shebang/PHP/script at offset 0 and post-BOM/whitespace, zip bombs [ratio, nested, many entries, overlapping entries, declared vs actual size, zip64], Zip-Slip [../, absolute, backslash, drive letter], polyglots [GIF/JS, PDF/HTML, ZIP/JAR, SQLite with trailing script], 500 truncations/bit-flips, SQLite with triggers/views/virtual tables, JSON depth bombs/BOM/UTF-16, CSV with NUL bytes, 1e6 columns, formula cells [=cmd|...], and malicious filenames [traversal, reserved Windows names, ADS, RTL, long names]).
  - Per-item execution wall-clock time and peak RSS memory usage.

### 2. V13 (Input Guard, Rate Limiter, and Injection Neutralization)
- **Input Guard & Direct Injection**:
  - Detection recall per injection category across public benchmark (`deepset/prompt-injections`), the 10-item `INJECTION_CORPUS`, and deterministically generated adaptive variants (paraphrases, multilingual Hindi/Tamil/German, base64, leetspeak, homoglyphs, zero-width splitting, markdown/HTML/JSON wrappers, multi-turn splits).
  - False-positive rate per benign trigger-word class across >=300 benign analytical questions containing trigger words (`reveal`, `bypass`, `override`, `ignore`, `admin`, `system`, `union`, `drop`, `developer`, `instructions`, `previous`, `forget`, `act as`) and test suite questions.
  - Reported without arbitrary pass/fail threshold, with two-sided 95% Wilson score confidence intervals; no pooled headline rate.
  - Exact oversize boundary evaluation at 3999, 4000, and 4001 across ASCII, multibyte UTF-8, emoji, and combining marks, verifying the precise length unit enforced by the code (UTF-16 code units at `input.guard.js:35`). HTTP body size limit evaluated separately.
- **Rate Limiter**:
  - Exact enforcement: exactly 30 allowed requests per 60s sliding window per key; the 31st request must be denied with HTTP 429.
  - Key isolation: verify no cross-key interference between distinct keys.
  - Scalability & memory: memory footprint measured across 100,000 distinct keys under rapid insertion and eviction cleanup.
  - Concurrency & robustness: 100 parallel concurrent requests; clock jump backward resilience; IP derivation under `trust proxy` (true vs false) and `X-Forwarded-For` spoofing.
- **Indirect Injection Neutralization**:
  - Evaluated on (a) document chunks and (b) SQL query result cell values.
  - Neutralization recall per injection family on >=200 poisoned items carrying canary goals (`CANARY_n`, role-play, `<system>`, `[INST]`, markdown/HTML comments, base64, unicode, multilingual).
  - Share of surviving injected instruction text reported.
  - False-neutralization rate on 200 benign document chunks and SQL cells.
  - Real attack success rate against models deferred to Step 5.

### 3. V14 (Authentication & Authorization Route Sweep)
- **Hard Pass/Fail Criteria**:
  - Unauthenticated requests to protected endpoints: **EXACTLY 0** HTTP 2xx responses (must return HTTP 401 or 403).
  - Cross-user data isolation: **EXACTLY 0** cross-user unauthorized reads across datasets, sessions, trace/audit logs, conversation IDs, and file download paths (IDOR).
  - RBAC policy alignment: **EXACTLY 0** mismatches between handler behavior and the user-supplied expected permissions matrix (`validation/data/rbac/expected.csv`). If `expected.csv` is absent, the matrix check is formally designated **NOT RUN**, and `validation/data/rbac/expected_TEMPLATE.csv` is emitted with an empty `expected_allow` column.
- **Reporting Metrics**:
  - Complete enumeration of every Express route, HTTP method, and middleware chain.
  - Full matrix sweep across all defined roles (`admin`, `manager`, `analyst`, `employee`, `viewer`, `unauthenticated`).
  - JWT token tamper testing (expired, forged signature, none algorithm, cross-user replay).
  - Catalog of any data-returning route reachable without expected role enforcement.

### 4. V15 (PII Redaction Engine)
- **Hard Pass/Fail Criteria**:
  - Unredacted in-scope PII instances (emails, phone numbers, SSNs, credit cards) in user-facing responses for `viewer` and `employee` roles across all output channels (response text, tables, chart data, CSV/XLSX export, PDF report, logs, traces, errors): **EXACTLY 0**.
- **Reporting Metrics**:
  - Redaction recall and precision per PII type and format (emails with subdomains/plus-addressing/obfuscation; phones +91/US/international/dashes/parens; SSNs valid vs invalid; credit cards Luhn-valid vs Luhn-invalid; benign numbers for false positives) reported with Wilson score 95% confidence intervals.
  - Scope gap analysis: Indian PAN and Aadhaar formats, person names, and unmasked export channels explicitly cataloged as architectural scope limits.

### 5. Frozen Corpus Checksums (V12 Corpus v1)

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v12/v12_files.jsonl` | 761 | `1b9a8716de6e961163f785e200c53068ef3fd96da826d067f90ef9a0f69f83dd` |
| **Total V12 Corpus** | **761** | — |

### 6. Frozen Corpus Checksums (V13 Corpus v1)

| File Path | Item Count | SHA-256 Checksum |
| `validation/data/v13/v13_corpus.jsonl` | 972 | `a344f5fcdb5ccd91886268e7a976f633a55edcc90a5ff4e74783ddf10432f54d` |
| **Total V13 Corpus** | **972** | — |

### 7. Frozen Corpus Checksums (V15 Corpus v1)

| File Path | Item Count | SHA-256 Checksum |
|---|---|---|
| `validation/data/v15/v15_pii.jsonl` | 620 | `dd1f9604e35b71c0284147b56227b90fb8b32f5e63c41ecf6b8980b9bd429d42` |
| **Total V15 Corpus** | **620** | — |




---

## Amendment SPIDER-A1: Frozen Spider Text-to-SQL Validation Protocol

### 1. Scope and Frozen Inputs

This amendment governs the standalone evaluation of CogniCore against the Spider development benchmark. It supplements the existing security-validation amendments; it does not replace or modify them.

The frozen sampling artifacts are stored under `validation/data/spider/`:

| Artifact | SHA-256 |
|---|---|
| `sample.js` | `D87B54934C78357475415A3D4B0E13A9E7B89A6AD2230D9998AD3D19871088F6` |
| `pool_order.json` | `275276219E9B6DB8467D3013EDD57FCF21B453B2AADF4B7BCC3F2D912F7DB944` |
| `pilot.jsonl` | `30D32F4F37E809182866B02BBF4781F34B9FA2115C02EA6B37BA2F26EF6EB068` |
| `candidates.jsonl` | `B61E1449DE37085EA1F53C88A7F941361726BFA6A7BD26E5CFC6EE1C6A424BED` |
| `SHA256SUMS.csv` | `0AD9ABF3C3C5B24D741DD91F1332B2B89E5DB775D325D8E272ED26F16A3352D1` |
| `PROVENANCE.txt` | `34E3200EEDF97A9CEA66016A332DA088591B81C19FE53E7FD19F530880C89973` |

These hashes identify the files at preregistration time. The manifest itself must also be verified against the actual files before eligibility processing. The source database manifest must be checked against the 20 copied SQLite databases.

### 2. Sampling and Eligibility

1. Preserve the 30-item pilot separately. Do not use pilot outcomes to tune prompts, choose model settings, or select the evaluation sample.
2. Process `candidates.jsonl` in its frozen order. The target is the first 300 eligible candidates from the 370 candidates.
3. Determine eligibility without consulting CogniCore model outputs. A candidate is ineligible if its source linkage cannot be verified, its database mapping is invalid, its gold SQL fails to execute against the corresponding reference database, or its gold result contains 1,000 or more rows under the benchmark execution policy.
4. Record every exclusion, its reason, the original candidate position, question identifier, and database identifier. Do not silently skip failures.
5. If fewer than 300 eligible candidates remain, stop before model evaluation and document the shortfall. Do not invent replacement questions or alter the sampling order after inspecting model performance.
6. A database-registration failure excludes affected questions from all three configurations and must be reported separately.

### 3. Evaluation Configurations

Evaluate each eligible question under the following paired configurations, using the same database copy, question, model, and scoring rules:

- **C0:** Raw baseline using the DDL-only prompt, without the governed recovery path.
- **C4nr:** Governed configuration with `maxRecovery: 0`.
- **C4:** Governed configuration with `maxRecovery: 2`.

The runner must use the verified `runStructuredQuery` entry point in `server/src/core/engines/structured.engine.js`, with an injected provider. Do not substitute the full product-routing path for the primary benchmark.

Before the first model call, record and freeze the actual provider, model identifier/version, relevant model options, prompt/template hashes, code commit, Node.js version, dependency versions, environment overrides, and configuration-specific settings. Use temperature `0`, seed `20261015` where supported, `num_ctx: 4096` where supported, a 15,000 ms query timeout, and a 1,000-row result cap. Record unsupported settings explicitly; do not imply that a setting was enforced if the provider does not support it.

Use a fresh conversation/session context for each question and configuration. Any completion cache must be keyed so that different configurations cannot accidentally reuse one another's outputs. A repeat pass must use the same frozen inputs and cache, and must produce zero additional live model calls. Report cache hits and misses.

### 4. Independent Gold Execution and Scoring

1. Execute reference SQL independently against the corresponding SQLite database using a read-only connection. Do not obtain gold results through CogniCore.
2. Apply identical documented result normalization to gold and predicted results.
3. Compare ordered rows only when the gold query has a top-level `ORDER BY` and its sort keys have no ties in the gold result. Otherwise compare results as multisets, preserving duplicate-row multiplicity.
4. Report exact execution-result accuracy as the primary outcome. Also report execution errors, invalid SQL, empty-result mismatches, result truncation, recovery attempts, exclusions, and per-database outcomes.
5. A prediction that hits the 1,000-row cap must be flagged as truncated and must not be scored as an unqualified exact match against a gold result excluded for reaching that cap.
6. Keep the original question, gold SQL, gold result, predicted SQL, predicted result, configuration, error details, and scoring decision in auditable records. Do not silently discard failed predictions.

### 5. Statistical Analysis and Decision Rule

- **Primary comparison:** C4 versus C0 on the same eligible questions.
- Use an exact, two-sided McNemar test on paired correctness outcomes. The preregistered success criterion is higher C4 accuracy than C0 with `p < 0.05`.
- Report C4nr versus C0 and C4 versus C4nr as secondary comparisons. Do not reinterpret secondary outcomes as the primary test.
- Report accuracy and paired differences with denominators and confidence intervals.
- Account for the 20-database structure using a cluster bootstrap that resamples databases, not individual questions, and reports the resulting uncertainty alongside the exact McNemar result. Freeze the bootstrap implementation, replicate count, and random seed before running it.
- Report all eligible questions and all exclusions. Do not change the primary endpoint, sample, or decision threshold after inspecting model outputs.

### 6. Isolation, Integrity, and Stop Conditions

- Use only disposable database copies under the dedicated validation workspace. Never ingest or benchmark against the original Spider source databases.
- Before ingestion, compute and record a logical-content hash for each disposable database. Repeat after ingestion and verify that the logical contents remain unchanged. Raw file hashes alone are insufficient because SQLite journal mode and WAL activity can alter file bytes without changing logical table contents.
- Execute gold SQL read-only and separately from CogniCore. Preserve any SQLite `-wal` and `-shm` files until the database is safely closed and the post-ingestion integrity check is complete.
- Preserve all pre-existing repository changes and validation logs. The Spider runner must write to dedicated Spider-specific output paths and must not delete or overwrite existing V3/V4 result files.
- Do not run any model calls until the sampling, eligibility, gold-execution, database-integrity, logging, and configuration checks have passed.
- If a prerequisite fails, stop and report the failure rather than silently changing the protocol.

### 7. Amendment Status

This amendment records the intended protocol. It does not, by itself, establish that eligibility has been computed, that 300 questions have qualified, that all database copies have passed integrity checks, or that any model evaluation has run. Those claims require separate, reproducible verification artifacts.

## Amendment SPIDER-A2: Frozen Bootstrap Implementation

Frozen before model evaluation:

- Bootstrap implementation: existing \alidation/lib/stats.js\ helper \clusterBootstrap\.
- Bootstrap replicates: 10,000.
- Random seed: 20261015.
- Resampling procedure: resample database clusters, then resample items within each selected cluster, following the existing helper implementation.
- The bootstrap statistic is the paired accuracy difference, C4 minus C0, computed using the same paired evaluation records.
- Implementation SHA-256 at freeze time: FEED1BBA98F7937CA6921E1DE431B0DA9B443CF9AF03E2D75B534ED5AD492892.
- Do not change the helper, replicate count, seed, or resampling procedure after inspecting model results. Any necessary change must be documented as a dated amendment before evaluation.


---

## Amendment SPIDER-A3: Execution Harness, Scoring, Supervisor, and Pilot Gate Specifications

### 1. Model Configuration
- **Model:** `qwen2.5-coder:7b` accessed via a harness-supplied `llmProvider` interacting directly with Ollama (`/api/generate`). The project's internal provider is not used.
- **Options:**
  - `temperature`: `0` on all standard calls; generator error recovery calls maintain the generator's default (`0.2`).
  - `seed`: `20261015`.
  - `num_ctx`: `4096`.
  - `num_predict`: as requested by caller (default 500 maxTokens).
- **Completion Caching:** All model responses cached in `validation/raw/spider/llm_cache.jsonl` keyed by SHA-256 hash of `(model, options, prompt)`.

### 2. Configuration Definitions
- **C0 (Baseline Raw Engine):** Harness code (bypassing `runStructuredQuery`). DDL-only prompt containing SQLite `CREATE TABLE` and `CREATE VIEW` statements extracted from `sqlite_master` + the exact output-format instruction lines from `sql.generator.js`. The resulting SQL is cleaned using `cleanSqlOutput` and executed in an isolated child process against a disposable read-only copy (`?mode=ro`, `PRAGMA query_only=ON`) wrapped in the 1,000-row cap:
  `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT 1000`.
  No repair, validator, policy enforcement, or recovery loop is executed.
- **C4nr (Governed Without Database Error Recovery):** Invokes `runStructuredQuery` with `maxRecovery: 0`. The single `NO_QUERY_POSSIBLE` retry, deterministic repairs (table names, column names, missing FROM, missing GROUP BY, integer division, value literals), AST and safety validation, and empty-result diagnosis remain fully active. Database-error recovery loop is disabled. Datasets ingested via `ingestFile` so semantic profiles (`dataset.profile.semantic`) are present.
- **C4 (Full Governed Engine):** Invokes `runStructuredQuery` with `maxRecovery: 2`. All repairs, AST safety validation, policy enforcement, empty-result diagnosis, and multi-turn error recovery loop active. Datasets ingested via `ingestFile`.
- **Ablations Not Run:** Composed intermediate configurations C1-C3 and leave-one-out ablations are not run.

### 3. Execution Supervisor and Timeouts
- A process supervisor monitors execution and enforces a strict 60-second wall-clock timeout per `(question, config)` unit.
- If a unit exceeds 60 seconds, the supervisor terminates the child process and its entire process tree.
- Timed-out units are recorded with status `'timeout'`, duration >= 60,000 ms, scored as incorrect/abstained (`correct: 0`), and reported separately in audit summaries.
- The project's internal 15-second configuration setting is not enforced by code and is superseded by this supervisor.

### 4. Scoring Methodology
- **Tuple Multiset Equality:** Evaluated on multiset equality of row tuples. Column names are ignored. Floating-point numbers are compared with relative tolerance `1e-6`. Strings are compared with exact equality and case sensitivity. `NULL` equals `NULL`. Distinct types (e.g. integer vs string) are strictly distinguished.
- **Ordered Comparison:** Evaluated with order sensitivity only if the gold query has a top-level `ORDER BY` whose sort keys are all projected output columns with no duplicate adjacent keys in the gold result (`order_unique == 1`). Otherwise multiset comparison is applied.
- Results returning 1,000 or more rows are classified as inconclusive.

### 5. SQLite Execution Engines and DQS Sensitivity
- **Gold Execution Engine:** Python `sqlite3` (v3.45.1) with DQS enabled.
- **Prediction Execution Engine:** Node `better-sqlite3` (v3.53.2) with DQS disabled.
- **Cross-Engine Audit & Sensitivity:** Gold queries are checked across both engines. Any gold query failing under `better-sqlite3` due to double-quoted string literals is classified as `dqs_incompatible`. Pre-planned sensitivity analyses include:
  1. Excluding `dqs_incompatible` questions.
  2. Excluding gold queries with `LIMIT` but no `ORDER BY`.
  3. Excluding `order_ambiguous` queries (ORDER BY with ties in sort keys).

### 6. Data Integrity and Run Isolation
- Fresh disposable database copies are created per run under `cognicore_spider/runs/<run_id>/`.
- Pre-run and post-run logical content hashes (SHA-256 of normalized `con.iterdump()` output) are computed for every database.
- Any change in logical content hash constitutes a run invalidation.
- Temporary WAL and SHM files are fully flushed and removed upon connection close.

### 7. Exploratory Hardness Classification
- **Easy:** No joins, at most one aggregate function, no subqueries, and no set operations.
- **Hard:** 3 or more joins, OR any subquery, OR any set operation (`UNION`, `INTERSECT`, `EXCEPT`).
- **Medium:** All queries not meeting easy or hard criteria.

### 8. Statistical Endpoints
- **Primary Endpoint:** Paired exact two-sided McNemar test comparing C4 versus C0 on the frozen 300-question sample at alpha = 0.05.
- **Secondary Endpoints:** C4nr vs C0, C4 vs C4nr, and 95% cluster-bootstrap confidence intervals (10,000 replicates, seed 20261015, clustered on `db_id`, statistic = mean difference).

### 9. Pilot Gates for Main Run
Execution of the frozen 300-question sample is gated upon the 30-question pilot passing all nine gates:
- **[G1]** Zero unhandled exceptions or supervisor crashes.
- **[G2]** Zero database modifications (logical hashes identical before and after).
- **[G3]** Zero truncations undetected.
- **[G4]** 90/90 units completed (success, error, or timeout recorded; no missing units).
- **[G5]** Cache validation: re-run of 5 pilot units yields 5 cache hits and 0 LLM calls.
- **[G6]** Pilot sanity: C0 accuracy on pilot falls within `[0.20, 0.85]`.
- **[G7]** Governed recovery triggers appropriately across C4 if recoverable errors occur, conforming to `maxRecovery`.
- **[G8]** Cross-engine gold agreement is 100% on the pilot.
- **[G9]** Supervisor timeout mechanism verified via test suite.

## Amendment SPIDER-B1: Secondary Held-Out Validation Sample B

### 1. Purpose and Protocol Integrity
- **Purpose:** Post-fix confirmation on questions never inspected, tuned upon, or executed with any model.
- **Independence:** Sample B was constructed after Sample A's initial evaluation run was completed, but strictly BEFORE any item-level inspection was performed for the post-run audit. The item-level outcomes of Sample A were not consulted or used in defining Sample B.
- **Model Invariance:** Zero model calls have been performed on Sample B.
- **Sampling Specification:**
  - Selected strictly from the remaining unused indices (positions 401 through 1034) of the pre-committed deterministic permutation `validation/data/spider/pool_order.json` (PREREG-A1).
  - Applied the identical preregistered eligibility rules:
    1. Gold query executes deterministically across two successive runs in Python SQLite read-only mode (`PRAGMA query_only=ON`).
    2. Gold query returns strictly fewer than 1,000 rows.
    3. Gold query contains no `LIMIT` clause without an accompanying `ORDER BY` clause.
    4. Database file exists and resolves cleanly.
  - The first 300 eligible items in original `pool_order.json` sequence form Sample B (`frozen_sample_300_B.jsonl`).
- **Disjoint Partitioning:**
  - Pilot items: pool positions 1..30 (0 overlap).
  - Candidates / Sample A pool: pool positions 31..400 (0 overlap).
  - Sample B: pool positions 401..704 (300 eligible items; 4 excluded items in span; 0 overlap with Pilot, Candidates, or Sample A).
- **Cryptographic Anchors:**
  - `frozen_sample_300_B.jsonl` SHA-256: `D1A35A18559C06393C1A36046674E619AB0B6604428E96BFAF5DBA80940D3B09`
  - `frozen_sample_300_B_manifest.json` SHA-256: `5CE0C368DDDE958634DAD694112D89CB2AE367AA2C3316CF8F9E581F8C759CB2`
