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




