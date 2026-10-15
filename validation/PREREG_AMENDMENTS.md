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
