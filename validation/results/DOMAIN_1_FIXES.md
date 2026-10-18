# CogniCore — Domain 1 Technical Audit & Fix Record
**Domain:** Text-to-SQL & Governance Engine  
**Status:** Completed & Verified (53/53 tests passing, 0 broken tests)  
**Verification Suite:** `validation/tests/domain1_governance.test.js` & `server/tests/unit/domain1-governance.test.js`

---

## Executive Summary

During the systematic architectural audit of CogniCore, Domain 1 (Text-to-SQL generation, schema relationship detection, join planning, and execution governance) was evaluated. Five structural defects were identified that caused semantic corruption, broken join syntax, alias collisions, and false-positive relationship inferences.

All five issues have been corrected with production-grade, generalized implementations adhering to:
1. **Zero Hardcoded Benchmarks/Hacks** (Production Architect Invariant).
2. **Deterministic Golden Tests & Strict Error Boundaries** (Evaluation Gatekeeper Invariant).
3. **No Information Leakage or Query Corruption** (Security Shield Invariant).

---

## Detailed Defect & Resolution Specifications

### Issue 1.1: Destructive Query Overwriting via `diagnoseEmptyResult`
* **Affected Files:**
  - `server/src/structured/result.checks.js`
  - `server/src/core/engines/structured.engine.js`
* **Defect Mechanism:**
  When a generated SQL query returned 0 rows, `diagnoseEmptyResult` probed string filters and automatically synthesized a `repairedSql` containing `LOWER(TRIM(col)) = LOWER(TRIM('...'))`. `structured.engine.js` then intercepted this and executed the mutated query, silently overwriting the original query and results. In benchmark auditing (Spider `flight_2`), this caused 7 out of 7 query regressions where empty-row outcomes were valid or where column casing had semantic significance.
* **Failure Example:**
  ```sql
  -- Original model query returning 0 rows legitimately:
  SELECT flight_id FROM flights WHERE status = 'Cancelled';
  -- Destructively rewritten and silently substituted:
  SELECT flight_id FROM flights WHERE LOWER(TRIM(status)) = LOWER(TRIM('Cancelled'));
  ```
* **Resolution:**
  - Decoupled diagnosis from execution.
  - `diagnoseEmptyResult` now returns purely diagnostic findings (`{ findings: [...] }`) without generating or returning `repairedSql`.
  - Removed the automatic query overwrite and re-execution loop from `structured.engine.js`.
* **Before Code (`server/src/structured/result.checks.js`):**
  ```javascript
  if (ci > 0) {
    findings.push({ column: col.name, literal: f.literal, type: 'case_or_whitespace_mismatch', matches: ci });
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if ((tk.t === 'word' || tk.t === 'qid') && tk.v.toLowerCase() === f.column.toLowerCase() && tokens[i + 1]?.v === '=' && tokens[i + 2]?.t === 'str' && tokens[i + 2].v === f.literal) {
        const start = tokens[i - 1]?.v === '.' ? tokens[i - 2].s : tk.s;
        edits.push({ s: start, e: tokens[i + 2].e, to: `LOWER(TRIM(${sql.slice(start, tk.e)})) = LOWER(TRIM('${lit}'))` });
      }
    }
  }
  // ...
  return { repairedSql: out, findings };
  ```
* **After Code (`server/src/structured/result.checks.js`):**
  ```javascript
  if (ci > 0) {
    findings.push({ column: col.name, literal: f.literal, type: 'case_or_whitespace_mismatch', matches: ci });
  } else {
    const rows = (await adapter.executeQuery(`SELECT ${cq} AS v, COUNT(*) AS n FROM ${tq} WHERE ${cq} IS NOT NULL GROUP BY ${cq} ORDER BY n DESC LIMIT 8`)).rows;
    findings.push({ column: col.name, literal: f.literal, type: 'value_not_found', available: rows.map((r) => r.v) });
  }
  // ...
  return { findings };
  ```

---

### Issue 1.2: Naive Semicolon Splitting Truncating Valid Literals
* **Affected File:** `server/src/structured/sql.generator.js` (`cleanSqlOutput`)
* **Defect Mechanism:**
  `cleanSqlOutput` used `raw.indexOf(';')` to isolate the first SQL statement. Any query containing a semicolon inside a string literal (e.g., `WHERE err_msg = 'code: 101; fatal'`) or a quoted column name was prematurely truncated at the internal semicolon, generating an unclosed string and an unrecoverable SQL syntax error.
* **Failure Example:**
  ```sql
  -- Model output:
  SELECT * FROM audit_logs WHERE payload LIKE '%;%';
  -- Truncated output:
  SELECT * FROM audit_logs WHERE payload LIKE '%
  -- Result: SQLite Syntax Error: unterminated string
  ```
* **Resolution:**
  Implemented a quote-aware scanner that tracks single-quote (`'...'`) and double-quote (`"..."`) state boundaries (including SQL escaped quotes `''` and `""`). Semicolons encountered while inside quote contexts are ignored; only top-level statement terminators are split.
* **Before Code (`server/src/structured/sql.generator.js`):**
  ```javascript
  const firstSemicolon = sql.indexOf(';');
  if (firstSemicolon !== -1) sql = sql.slice(0, firstSemicolon);
  ```
* **After Code (`server/src/structured/sql.generator.js`):**
  ```javascript
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let splitIndex = -1;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") { i++; continue; } // Escaped quote ''
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      if (inDoubleQuote && sql[i + 1] === '"') { i++; continue; }
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === ';' && !inSingleQuote && !inDoubleQuote) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex !== -1) sql = sql.slice(0, splitIndex);
  ```

---

### Issue 1.3: Rigid Regex Failing on Conversational Prefixes
* **Affected File:** `server/src/structured/sql.generator.js` (`cleanSqlOutput`)
* **Defect Mechanism:**
  Markdown fence stripping was anchored strictly to string beginnings: `sql.replace(/^```(sql)?/i, '')`. When an LLM produced conversational pleasantries prior to the code fence (e.g. *"Here is your query:\n```sql\nSELECT ...```"*), the regex failed to match. The conversational preamble remained attached to the SQL string, causing parser failure.
* **Resolution:**
  Replaced rigid prefix regex with an unanchored block extraction regex `/```(?:sql)?\s*([\s\S]*?)```/i` that extracts the SQL query content regardless of preceding or trailing conversational commentary.
* **Before Code (`server/src/structured/sql.generator.js`):**
  ```javascript
  sql = sql.replace(/^```(sql)?/i, '').replace(/```$/, '').trim();
  ```
* **After Code (`server/src/structured/sql.generator.js`):**
  ```javascript
  const fenceMatch = sql.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    sql = fenceMatch[1].trim();
  } else {
    sql = sql.replace(/^```(?:sql)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  ```

---

### Issue 1.4: Join Hints vs Literal Copy-Pasteable Skeleton & Prefix Aliasing Collisions
* **Affected File:** `server/src/schema/join.planner.js`
* **Defect Mechanism:**
  1. **Hint vs Template**: Previously, `renderJoinHints` emitted vague path hints: `To combine "concert" with "singer": JOIN using ... (via singer_in_concert)`. Weak LLMs failed to assemble junction tables into valid SQL and omitted intermediate tables from the `FROM` clause.
  2. **Alias Collisions on 3-Char Slices**: Naive aliasing schemes based on slicing table names (e.g. `tableName.slice(0, 3)`) collided on common prefixes: `users`, `user_settings`, and `user_sessions` all received `use1`, resulting in duplicate alias crashes in SQLite.
  3. **Multi-Hop Pollution via Self-Refs / Audit Guesses**: When self-references or heuristic audit edges entered the relationship graph, `shortestJoinPath` routed multi-hop paths through them (e.g., `employees -> employees (via manager_id) -> projects`), altering query semantics.
  4. **Silent Drop of Multiple Self-References**: `.find()` returned only the first self-reference, dropping `mentor_id` or `parent_id` when `manager_id` was present.
* **Resolution:**
  - Implemented `buildJoinSkeleton()`: emits literal, copy-pasteable `FROM ... JOIN ... ON` syntax.
  - Implemented query-scoped counter aliasing (`t1, t2, t3...`) whenever table repetition occurs.
  - Introduced `MIN_TRAVERSABLE_CONFIDENCE = 0.4` to isolate multi-hop path searches from low-confidence heuristics or self-ref loops.
  - Added direct-pair fallback in `renderJoinHints` to surface 1-hop audit edges for direct queries without allowing them to chain into multi-hop paths.
  - Render multiple self-references per table (capped at 3).
* **Before Code (`server/src/schema/join.planner.js`):**
  ```javascript
  lines.push(`To combine "${relevant[i]}" with "${relevant[j]}": JOIN using ${path.map(cond).join(' AND ')} (via ${[...new Set(path.flatMap((r) => [r.fromTable, r.toTable]))].join(' -> ')})`);
  ```
* **After Code (`server/src/schema/join.planner.js`):**
  ```javascript
  const MIN_TRAVERSABLE_CONFIDENCE = 0.4;

  function buildJoinSkeleton(startTable, path) {
    let curr = startTable;
    const steps = [];
    const tableOccurrences = { [curr.toLowerCase()]: 1 };

    for (const r of path) {
      let currCol, nextTable, nextCol;
      if (r.fromTable.toLowerCase() === curr.toLowerCase()) {
        currCol = r.fromColumn;
        nextTable = r.toTable;
        nextCol = r.toColumn;
      } else {
        currCol = r.toColumn;
        nextTable = r.fromTable;
        nextCol = r.fromColumn;
      }
      const nextLower = nextTable.toLowerCase();
      tableOccurrences[nextLower] = (tableOccurrences[nextLower] || 0) + 1;
      steps.push({ fromTable: curr, fromCol: currCol, toTable: nextTable, toCol: nextCol });
      curr = nextTable;
    }

    const hasRepeats = Object.values(tableOccurrences).some((count) => count > 1);
    let globalAliasIndex = 0;

    const getLabel = (tableName) => {
      if (!hasRepeats) {
        return { tableExpr: `"${tableName}"`, refName: `"${tableName}"` };
      }
      globalAliasIndex++;
      const alias = `t${globalAliasIndex}`;
      return { tableExpr: `"${tableName}" AS "${alias}"`, refName: `"${alias}"` };
    };

    const first = getLabel(startTable);
    const lines = [`FROM ${first.tableExpr}`];
    let prevRef = first.refName;

    for (const step of steps) {
      const next = getLabel(step.toTable);
      lines.push(`JOIN ${next.tableExpr} ON ${prevRef}."${step.fromCol}" = ${next.refName}."${step.toCol}"`);
      prevRef = next.refName;
    }

    return lines.join('\n  ');
  }
  ```

---

### Issue 1.5: False Positive ID Regex, Missing Role Self-References, and Audit-to-User Detection
* **Affected File:** `server/src/schema/relationship.detector.js`
* **Defect Mechanism:**
  1. **False Positive English Words**: Regex `/^(.*?)(?:_id|Id|ID)$/` matched valid English words ending in `id` (`valid`, `rigid`, `hybrid`, `fluid`, `lucid`, `candid`). If a table named `val` or `flu` existed, fake foreign keys were inferred.
  2. **Missing Role-Based Self-References**: Hierarchical self-referencing foreign keys named by role (`manager_id`, `parent_id`, `supervisor_id`, `mentor_id`, `reports_to_id`) did not match the table stem (`employee`) and were dropped.
  3. **Unhandled Audit/Role Columns to User Tables**: Columns like `created_by_id`, `assigned_to_id`, `author_id` pointing to `users` or `accounts` tables were unhandled when no declared foreign keys existed.
* **Resolution:**
  - Enforced strict word boundaries in `extractIdStem()`: requires either snake_case `_id` or camelCase with a lowercase letter preceding `Id`/`ID`, rejecting dictionary words.
  - Established a strict 4-tier relationship detection hierarchy:
    - **Priority A (Confidence 0.5):** Outbound FK to external tables (exact, plural, singular).
    - **Priority B (Confidence 0.35):** Structural self-reference (stem embeds table name, e.g. `parent_category_id` in `categories`).
    - **Priority C (Confidence 0.3):** Role-based self-reference (`ROLE_SELF_REF_STEMS`: `parent`, `manager`, `supervisor`, `mentor`, etc.).
    - **Priority D (Confidence 0.3):** Audit/role outbound reference to entity user table (`AUDIT_USER_STEMS`: `created_by`, `assigned_to`, `author`, etc. targeting `users`/`accounts`/`employees`/`staff`).
* **Before Code (`server/src/schema/relationship.detector.js`):**
  ```javascript
  const idPattern = /^(.*?)(?:_id|Id|ID)$/;
  // ...
  const m = col.name.match(idPattern);
  if (!m) continue;
  const stem = m[1].toLowerCase();
  // ...
  ```
* **After Code (`server/src/schema/relationship.detector.js`):**
  ```javascript
  function extractIdStem(columnName) {
    const snakeMatch = columnName.match(/^(.+)_id$/i);
    if (snakeMatch) return snakeMatch[1].toLowerCase();

    const camelMatch = columnName.match(/^([a-zA-Z0-9]*[a-z])(?:Id|ID)$/);
    if (camelMatch) return camelMatch[1].toLowerCase();

    return null;
  }

  const ROLE_SELF_REF_STEMS = new Set([
    'parent', 'manager', 'supervisor', 'owner', 'creator',
    'reports_to', 'replaces', 'predecessor', 'successor', 'mentor',
    'head', 'lead', 'boss', 'managed_by',
  ]);

  const AUDIT_USER_STEMS = new Set([
    'created_by', 'modified_by', 'updated_by', 'deleted_by',
    'assigned_to', 'author', 'owner', 'approved_by', 'reviewed_by',
    'submitted_by', 'resolved_by', 'closed_by', 'user',
  ]);

  const USER_TABLE_CANDIDATES = ['users', 'accounts', 'employees', 'staff', 'members'];
  ```

---

## Verification & Test Results

Both test suites pass 100% with zero regressions:
- `CogniCore/server/tests/unit/domain1-governance.test.js`: **17 passed, 0 failed (280ms)**
- `validation_workspace/validation/tests/*.test.js`: **53 passed, 0 failed (3.86s)**

```
✔ cleanSqlOutput: preserves semicolons within single-quoted string literals
✔ cleanSqlOutput: preserves escaped single quotes and semicolons within string literals
✔ cleanSqlOutput: preserves semicolons within double-quoted identifiers
✔ cleanSqlOutput: cleanly extracts SQL from markdown code fences amidst conversational text
✔ extractIdStem: correctly extracts stems for valid foreign key column conventions
✔ extractIdStem: rejects common non-FK English words ending in "id"
✔ detectRelationships: assigns confidence 0.5 to external outbound naming heuristic
✔ detectRelationships: detects structural self-references at confidence 0.35
✔ detectRelationships: detects role-based self-references at confidence 0.3
✔ detectRelationships: detects audit/role user reference pointing to users table at confidence 0.3
✔ buildJoinSkeleton: generates clean unaliased join skeleton for distinct tables
✔ buildJoinSkeleton: generates collision-free query-scoped counter aliases (t1, t2) for self-joins
✔ buildJoinSkeleton: handles repeating tables in multi-hop chains without 3-char prefix collision
✔ shortestJoinPath: enforces MIN_TRAVERSABLE_CONFIDENCE (0.4) and excludes self-refs in multi-hop paths
✔ renderJoinHints: renders up to 3 self-join hints for tables with multiple self-refs
✔ renderJoinHints: direct-pair fallback surfaces 1-hop audit edges for direct queries
✔ diagnoseEmptyResult: returns pure findings without mutating query or producing repairedSql
```
