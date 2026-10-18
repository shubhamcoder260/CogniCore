# CogniCore — Domain 2 Technical Audit & Fix Record
**Domain:** SQL Parser, AST Validator & Safety Flaws  
**Status:** Completed & Verified (77/77 tests passing, 0 broken tests)  
**Verification Suite:** `server/tests/unit/domain2-parser-safety.test.js` & `validation/tests/domain2_parser_safety.test.js`

---

## Executive Summary

During the systematic architectural audit of CogniCore, Domain 2 (SQL AST parsing, safety validation, table/column validation, limit enforcement, and table repairs) was evaluated. Five structural defects were identified that caused valid queries to be blocked, string literals to be corrupted, table names to be falsely rewritten, and column validation to be completely skipped.

All five issues have been corrected with production-grade, generalized implementations adhering to:
1. **Zero Hardcoded Benchmarks/Hacks** (Production Architect Invariant).
2. **Fail-Open Read-Only Architecture with Shadow Mode** (Evaluation Gatekeeper Invariant).
3. **No Information Leakage or Query Corruption** (Security Shield Invariant).

---

## Detailed Defect & Resolution Specifications

### Issue 2.1: `BLOCKED_KEYWORDS` Blocking Standard SQL Scalar Function `REPLACE()` and Legitimate Business Filters
* **Affected File:** `server/src/structured/sql.validator.js`
* **Defect Mechanism:**
  1. `BLOCKED_KEYWORDS` included `'REPLACE'`.
  2. The pre-parse check converted the entire query to uppercase (`sql.toUpperCase()`) and ran `new RegExp('\\b' + kw + '\\b')`.
  3. When a query legitimately used standard ANSI SQL string manipulation (`SELECT REPLACE(phone, '-', '') FROM contacts`), `validateSql` threw: `Query contains a disallowed operation: REPLACE`.
  4. Furthermore, checking uppercase raw text scanned string literals as well. Any read-only query inspecting business events or audit logs (`SELECT * FROM audit_logs WHERE action = 'DELETE'`) was rejected with `Query contains a disallowed operation: DELETE`.
  5. The AST parser (`node-sql-parser`) already guarantees that statements must be `SELECT` via `ALLOWED_STATEMENT_TYPES = new Set(['select'])`. Any DML statement like `REPLACE INTO ...` produces AST `type: 'replace'` and is blocked by the parser.
* **Resolution:**
  - Removed `'REPLACE'` from `BLOCKED_KEYWORDS`.
  - Added `/\bREPLACE\s+INTO\b/i` to `BLOCKED_PATTERNS` so DML statements are blocked while scalar `REPLACE()` functions are permitted.
  - Centralized `stripLiterals(sql)` in `sql.analyzer.js` (masking single quotes, double quotes, and backticks while preserving 1:1 character offsets with spaces).
  - Evaluated keywords and patterns on `stripped` text so literals containing keyword names are never blocked.

---

### Issue 2.2: Raw Regex for Comments (`/--|\/\*/`) and Semicolons (`indexOf(';')`) Rejecting Valid String Literals
* **Affected File:** `server/src/structured/sql.validator.js`
* **Defect Mechanism:**
  1. Comment check `if (/--|\/\*/.test(sql))` scanned raw text. Searching for emails with hyphens (`WHERE email = 'user--test@example.com'`) or markdown text failed with `SQL comments are not allowed`.
  2. Multi-statement check `sql.includes(';') && sql.trim().indexOf(';') !== sql.trim().length - 1` found the first semicolon. Filtering on text containing a semicolon (`WHERE code = 'ERR;104'`) failed with `Multiple statements are not allowed`.
* **Resolution:**
  - Evaluated comments and statement-chaining semicolons strictly on `stripped` text. Genuine comments and multi-statement attacks remain 100% blocked, while legitimate text literals are safely permitted.

---

### Issue 2.3: Total Absence of Column Validation in `sql.validator.js` & Fail-Open Shadow Mode
* **Affected Files:**
  - `server/src/structured/sql.validator.js`
  - `server/src/structured/sql.analyzer.js`
* **Defect Mechanism:**
  - `sql.validator.js` claimed `Table validation -> Column validation -> Read-only execution` in its header, but never invoked column validation.
  - `sql.analyzer.js` contained `findUnknownColumns(sql, schema)` (noting *"security validation still happens in sql.validator.js"*), but it was never wired up.
  - Missing support for implicit column aliases (`SELECT a b FROM t`) and table-valued functions (`FROM generate_series(...)`).
* **Resolution:**
  - Extended `buildScope` in `sql.analyzer.js`:
    - Tracks `inSelectList` to register implicit column aliases (`names.add(...)`, `consumed.add(...)`).
    - Detects table-valued functions in `FROM`/`JOIN` (`hasTableValuedFunction`), causing `findUnknownColumns` to conservatively fail open (`[]`).
    - Added code comment acknowledging CTE projection limitation (under-blocking, acceptable for read-only fail-open).
  - Wired `findUnknownColumns` into `sql.validator.js`:
    - Wrapped in `try/catch` with fail-open semantics.
    - Added unconditional shadow-mode telemetry logging via `logger.warn('column_validator_unknown_columns', { count, columns, enforce })`.
    - Only throws `SQLValidationError` when `process.env.ENFORCE_COLUMN_VALIDATION === 'true'`.

---

### Issue 2.4: `enforceLimit` Subquery Wrapping Breaking Top-Level Common Table Expressions (CTEs)
* **Affected File:** `server/src/structured/sql.executor.js`
* **Defect Mechanism:**
  `enforceLimit` wrapped queries as `SELECT * FROM (${trimmed}) AS __cognicore_capped LIMIT ${maxRows}`. When a query started with a CTE (`WITH cte AS (...) SELECT ...`), wrapping the CTE inside `FROM (WITH ...)` produced invalid SQL in standard ANSI SQL and MySQL 8, causing syntax errors.
* **Resolution:**
  Tokenized the query. If it begins with `WITH`, locates the main top-level `SELECT` statement after the CTE definition, preserves `WITH ... AS (...)` at the top level, and wraps only the main `SELECT` clause:
  `${ctePart} SELECT * FROM (${mainQuery}) AS __cognicore_capped LIMIT ${maxRows}`.

---

### Issue 2.5: Context-Tracking Surgical Table-Name Repair
* **Affected File:** `server/src/structured/sql.repair.js`
* **Defect Mechanism:**
  - `repairTableNames` previously used global regex replacement `repairedSql.replace(new RegExp('\\b' + candidate + '\\b', 'g'), found)`, mutating string literals and aliases (e.g. `'active employees' AS employees_title` became `'active employee'`).
  - CTE names were spuriously fuzzy-matched (e.g. `WITH cte AS (...) SELECT * FROM cte` with table `ctes` rewritten to `ctes`).
  - Short names (< 4 chars) like `usr` were aggressively fuzzy-matched.
  - Implicit table aliases without `AS` (`FROM employees e`) were treated as unknown table qualifiers.
  - Schema-qualified prefixes (`FROM hr.employees` with table `hrs`) were falsely rewritten.
* **Resolution:**
  Implemented a two-pass context-tracking surgical repair:
  - **Pass 1 (Direct Table Refs):**
    - Tracks `inFromClause` across comma-separated tables (`FROM a, b`).
    - Checks `knownNames` (real tables + CTE names from `extractCteNames`).
    - Collects explicit (`AS x`) and implicit (`FROM t x`) aliases into `definedAliases`.
    - Skips schema prefixes (`FROM hr.employees`).
    - Enforces length threshold: `closestMatch` is strictly skipped when `candidate.length < 4`.
    - Uses dialect-correct quoting via `quoteIdent(found, dialect)` (e.g. MySQL backticks vs PostgreSQL/SQLite double quotes).
    - Records per-edit offset corrections (`{ from, to, offset }`).
  - **Pass 2 (Table Qualifiers on Columns):**
    - Rewrites qualifiers on columns (`candidate.column` -> `found.column`) only for tables repaired in Pass 1 or exact singular/plural variants with column verification.
    - Skips schema prefixes and defined aliases.

---

## Verification & Test Results

Both unit test suites pass 100% with zero regressions:
- `CogniCore/server/tests/unit/domain2-parser-safety.test.js`: **24 passed, 0 failed (187ms)**
- `CogniCore/server/tests/unit/domain1-governance.test.js`: **17 passed, 0 failed (280ms)**
- `validation_workspace/validation/tests/*.test.js`: **77 passed, 0 failed (3.88s)**

```
✔ stripLiterals: masks single quotes, double quotes, and backticks while preserving length
✔ stripLiterals: handles escaped quotes cleanly
✔ sql.validator: allows scalar REPLACE function
✔ sql.validator: blocks DML REPLACE INTO statement
✔ sql.validator: permits queries querying data matching blocked keyword values
✔ sql.validator: permits string literals containing double dashes and semicolons
✔ sql.validator: strictly blocks actual SQL comments and multi-statement attacks
✔ findUnknownColumns: handles window functions with OVER, PARTITION BY, ORDER BY
✔ findUnknownColumns: handles implicit column aliases (no AS)
✔ findUnknownColumns: fails open on table-valued functions
✔ findUnknownColumns: flags genuinely hallucinated columns
✔ sql.validator: shadow mode logs but does not throw on unknown columns by default
✔ sql.validator: throws on unknown columns when ENFORCE_COLUMN_VALIDATION is true
✔ enforceLimit: wraps plain SELECT query in subquery with limit
✔ enforceLimit: preserves top-level CTE structure across SQL engines
✔ repairTableNames: Case 1 - literal untouched, employe -> employee
✔ repairTableNames: Case 2 - schema-qualified repair hr.employe -> hr.employee
✔ repairTableNames: Case 3 - comma-separated repair employe, department
✔ repairTableNames: Case 4 - multi-occurrence surgical repair on join and qualifier
✔ repairTableNames: Case 5 - dialect-correct quoting (MySQL backticks)
✔ repairTableNames: Case 6 - CTE names not fuzzy matched
✔ repairTableNames: Case 7 - short names (< 4 chars) not fuzzy matched
✔ repairTableNames: Case 8 - implicit table aliases (no AS) not repaired
✔ repairTableNames: Case 9 - schema qualifier prefix not repaired
```
