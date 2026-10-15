# PART 3 — STAGE-BY-STAGE DEEP DIVE (18 STAGES)

This chapter provides a research-grade, exhaustive specification for all eighteen stages comprising the CogniCore structured query processing pipeline. Every stage is detailed according to the standardized 15-point specification template.

---

## 1. Input Screening (`input_guardrails`)

1. **Stage Name (Verbatim Trace Name)**: `input_guardrails` (emitted at `server/src/core/core.engine.js:49`).
2. **Source File and Exported Function Name**: `server/src/guardrails/input.guard.js:30`, function `screenQuestion(question)`.
3. **Classification**: DETERMINISTIC. Pure algorithmic regex evaluation; LLM is never invoked.
4. **Trigger Condition**: Executes unconditionally as Step 1 on every inbound request in `handleUserQuery` (`server/src/core/core.engine.js:48`).
5. **Inputs**:
   - `question`: `string` (user prompt).
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       blocked: boolean,
       flags: string[], // e.g. ['prompt_injection', 'sql_injection_attempt', 'oversized_input']
       message: string | null
     }
     ```
     Constructor receipt: `server/src/guardrails/input.guard.js:37-44`.
7. **Determinism**: Fully deterministic. Pure function over input string with no side effects or randomness.
8. **Failure Modes**: Does not throw on non-string inputs due to explicit `String(question || '')` conversion (`server/src/guardrails/input.guard.js:31`).
9. **Fail-Closed vs Fail-Open**: Fail-closed. If `screen.blocked === true`, execution terminates immediately at `server/src/core/core.engine.js:50-55`, returning `routeType: 'BLOCKED'` and an advisory refusal message.
10. **Disable-ability**: NO (hardcoded at `server/src/core/core.engine.js:48-55`).
11. **Statefulness**: Stateless. Reads zero external process memory, disk, or databases.
12. **LLM Call Details**: None.
13. **Security Checks Performed**:
    - Prompt injection detection via 10 regexes (`server/src/guardrails/input.guard.js:9-20`), including jailbreaks (`DAN`, `developer mode`), instruction overrides (`ignore previous instructions`), role hijacking (`act as admin/root`), and delimiter smuggling (`<system>`, `### system`).
    - SQL injection pattern detection via 5 regexes (`server/src/guardrails/input.guard.js:22-28`), flagging stacked mutations (`; DROP`), `UNION SELECT`, `OR '1'='1'`, and trailing comment dashes (`--`).
    - Input size ceiling: flags `oversized_input` if string length exceeds 4,000 characters (`server/src/guardrails/input.guard.js:35`).
14. **Unit Test Coverage**: `server/tests/unit/guardrails.test.js:10` ("input guardrails: blocks prompt-injection patterns") and line 17 ("input guardrails: flags SQL-injection-like user questions").
15. **Monkey-Patchability**: Constrained. Destructured at module load time in `server/src/core/core.engine.js:10`:
    ```javascript
    const { screenQuestion } = require('../guardrails/input.guard');
    ```
    Monkey-patching `input.guard.screenQuestion` after `core.engine.js` is loaded does not alter the bound reference. Replacement requires intercepting `require.cache` prior to requiring `core.engine.js`.

---

## 2. Intent Classification (`intent`)

1. **Stage Name (Verbatim Trace Name)**: `intent` (emitted at `server/src/core/core.engine.js:79`).
2. **Source File and Exported Function Name**: `server/src/agent/agent.js:38`, exporting `classifyIntent` (which re-exports from `server/src/agent/intent.classifier.js:26`).
3. **Classification**: DETERMINISTIC. First-match regex rule evaluation.
4. **Trigger Condition**: Runs unconditionally after follow-up query rewriting at `server/src/core/core.engine.js:78`.
5. **Inputs**:
   - `question`: `string` (`effectiveQuestion`).
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       intent: string, // 'scenario' | 'overview' | 'action' | 'report' | 'quality' | 'explore' | 'describe' | 'kpi' | 'correlation' | 'forecast' | 'anomaly' | 'trend' | 'compare' | 'query'
       rule?: string   // regex source excerpt if matched
     }
     ```
     Constructor receipt: `server/src/agent/intent.classifier.js:28-29`.
7. **Determinism**: Fully deterministic. Sequential scan over static array `RULES` (`server/src/agent/intent.classifier.js:10-24`).
8. **Failure Modes**: Safe against non-string arguments via `String(question || '')` (`server/src/agent/intent.classifier.js:27`).
9. **Fail-Closed vs Fail-Open**: Fail-safe fallback: default return is `{ intent: 'query' }`, ensuring unclassified natural language routes to standard pipeline.
10. **Disable-ability**: NO (hardcoded at `server/src/core/core.engine.js:78`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Action intent routing gates side-effecting operations into the administrative approval queue (`server/src/core/core.engine.js:80-83`), preventing automated execution.
14. **Unit Test Coverage**: `server/tests/unit/agent.test.js:14` ("intent classifier: maps analytical questions to correct tools").
15. **Monkey-Patchability**: Constrained. Destructured at load time in `server/src/core/core.engine.js:16`:
    ```javascript
    const { tryAgent, classifyIntent } = require('../agent/agent');
    ```

---

## 3. Schema Resolution (`schema_context`)

1. **Stage Name (Verbatim Trace Name)**: `schema_context` (emitted at `server/src/core/engines/structured.engine.js:59`).
2. **Source File and Exported Function Name**: `server/src/core/engines/structured.engine.js:48-50` utilizing `server/src/schema/schema.analyzer.js:20` (`analyzeSchema`) and `server/src/semantic/meanings.store.js:46` (`applyMeanings`).
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Runs upon entering `runStructuredQueryInner` whenever structured routing occurs.
5. **Inputs**:
   - `schema`: `{ tables: Table[] }`
   - `profile`: `{ relationships?: Relationship[], semantic?: SemanticModel }`
   - `datasetId`: `string`
6. **Outputs**:
   - Extracted schema, relationship graph, and catalog definitions passed to query generator.
7. **Determinism**: Fully deterministic.
8. **Failure Modes**: Handled gracefully; if relationships missing from profile, falls back to `analyzeSchema(schema, dataset.profile).relationships` (`server/src/core/engines/structured.engine.js:49`).
9. **Fail-Closed vs Fail-Open**: Fail-closed if `dataset.schema` is invalid or empty.
10. **Disable-ability**: NO (hardcoded at `server/src/core/engines/structured.engine.js:48-50`).
11. **Statefulness**: Reads SQLite registry table `meanings` via `Meanings.list(dataset.dataset_id)` (`server/src/semantic/meanings.store.js:46`).
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Restricts resolved tables to the authenticated dataset ID.
14. **Unit Test Coverage**: `server/tests/unit/relationship.detector.test.js:12` and `server/tests/unit/semantic-quality.test.js:18`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/core/engines/structured.engine.js:8, 17`.

---

## 4. Candidate Selection

1. **Stage Name (Verbatim Trace Name)**: Executed inline as part of `buildPrompt` (`server/src/structured/sql.generator.js:26-39`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.generator.js:14`, function `buildSchemaDescription(schema)` and `server/src/schema/join.planner.js:35` (`renderJoinHints`).
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Invoked on every SQL generation prompt build.
5. **Inputs**:
   - `schema`: `{ tables: Table[] }`
   - `relationships`: `Relationship[]`
   - `question`: `string`
6. **Outputs**:
   - Formatted string blocks: table schema dumps, primary/foreign key mappings, and candidate join paths.
7. **Determinism**: Fully deterministic string assembly based on discovered schema metadata.
8. **Failure Modes**: None. Returns `(none detected)` for relationships if empty.
9. **Fail-Closed vs Fail-Open**: Fail-closed if schema has no tables.
10. **Disable-ability**: NO (hardcoded in `server/src/structured/sql.generator.js:30-38`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**: None.
14. **Unit Test Coverage**: `server/tests/unit/sql-analyzer.test.js:50` ("join planner finds multi-hop path").
15. **Monkey-Patchability**: Destructured at module load time in `server/src/structured/sql.generator.js:10`:
    ```javascript
    const { renderJoinHints } = require('../schema/join.planner');
    ```

---

## 5. Few-Shot Retrieval (`selectPatternHints`)

1. **Stage Name (Verbatim Trace Name)**: Executed inline as part of prompt assembly (`server/src/structured/sql.generator.js:38`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.patterns.js:53`, function `selectPatternHints(question, dialect)`.
3. **Classification**: DETERMINISTIC. Rule-based regex pattern selector.
4. **Trigger Condition**: Evaluated on every prompt build.
5. **Inputs**:
   - `question`: `string`
   - `dialect`: `'sqlite' | 'postgres' | 'mysql'`
6. **Outputs**:
   - `string`: dialect-specific pattern recipe templates (percentages, time grouping, ranking, moving averages).
7. **Determinism**: Fully deterministic regex matching over question tokens.
8. **Failure Modes**: Returns empty string `""` if no regexes match.
9. **Fail-Closed vs Fail-Open**: Fail-open (empty string omitted from prompt).
10. **Disable-ability**: NO (hardcoded at `server/src/structured/sql.generator.js:38`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Enforces dialect-appropriate date and string functions to prevent runtime dialect errors.
14. **Unit Test Coverage**: `server/tests/unit/integer-division.test.js` and `server/tests/unit/sql-analyzer.test.js`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/structured/sql.generator.js:11`.

---

## 6. Prompt Assembly (`buildPrompt`)

1. **Stage Name (Verbatim Trace Name)**: Executed inline inside `generateSql` (`server/src/structured/sql.generator.js:78`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.generator.js:26`, function `buildPrompt(opts)`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Evaluated on every generation call (initial attempt and error recovery retries).
5. **Inputs**:
   - Object containing `question`, `schema`, `relationships`, `conversationContext`, `datasetType`, `retryHint`, `semantic`, `knowledgeText`, `followUp`, `recovery`.
6. **Outputs**:
   - `string`: Fully hydrated LLM system/user prompt containing strict boundaries, dialect instructions, and context (`server/src/structured/sql.generator.js:52-74`).
7. **Determinism**: Fully deterministic text interpolation.
8. **Failure Modes**: Throws if `schema` is undefined or malformed.
9. **Fail-Closed vs Fail-Open**: Fail-closed.
10. **Disable-ability**: NO (hardcoded in `server/src/structured/sql.generator.js:78`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: Generates the exact prompt template. Includes `NO_QUERY_POSSIBLE` instructions for impossible questions.
13. **Security Checks Performed**: System prompt injects strict rule directives forbidding mutating commands (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `CREATE`, `ATTACH`, `PRAGMA`).
14. **Unit Test Coverage**: `server/tests/unit/retry-on-refusal.test.js:15`.
15. **Monkey-Patchability**: Exported as named function on `sql.generator.js:94`.

---

## 7. SQL Generation (`sql_generated`)

1. **Stage Name (Verbatim Trace Name)**: `sql_generated` (emitted at `server/src/core/engines/structured.engine.js:61`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.generator.js:77`, function `generateSql(llmProvider, opts)`.
3. **Classification**: LLM-DEPENDENT.
4. **Trigger Condition**: Runs on structured queries; also triggers one retry if candidate returns `NO_QUERY_POSSIBLE` (`server/src/core/engines/structured.engine.js:64-68`).
5. **Inputs**:
   - `llmProvider`: `{ complete: Function }`
   - `opts`: Prompt configuration object.
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       sql: string,         // Cleaned SQL string or 'NO_QUERY_POSSIBLE'
       rawResponse: string, // Raw LLM response string
       prompt: string       // Generated prompt text
     }
     ```
     Constructor receipt: `server/src/structured/sql.generator.js:81`.
7. **Determinism**: LLM-dependent. Non-deterministic across models; low temperature minimizes variance.
8. **Failure Modes**: Provider timeouts, connection drops, or malformed generation output.
9. **Fail-Closed vs Fail-Open**: Fail-closed. If SQL is empty or `NO_QUERY_POSSIBLE`, pipeline aborts with informative low-confidence message (`server/src/core/engines/structured.engine.js:70-75`).
10. **Disable-ability**: NO (hardcoded at `server/src/core/engines/structured.engine.js:53-61`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**:
    - Temperature: `opts.recovery ? 0.2 : 0.1` (`server/src/structured/sql.generator.js:79`).
    - Max tokens: `500`.
    - Stop sequences: Markdown code fences stripped and query truncated at first semicolon via `cleanSqlOutput` (`server/src/structured/sql.generator.js:84-92`).
13. **Security Checks Performed**: Strips multi-statement tails after semicolon (`server/src/structured/sql.generator.js:89-91`).
14. **Unit Test Coverage**: `server/tests/unit/retry-on-refusal.test.js` and `server/tests/integration/engine-e2e.test.js`.
15. **Monkey-Patchability**: Exported on module, but destructured at load time in `server/src/core/engines/structured.engine.js:2`:
    ```javascript
    const { generateSql } = require('../../structured/sql.generator');
    ```

---

## 8. Deterministic SQL Repair (`auto_repair`)

1. **Stage Name (Verbatim Trace Name)**: `auto_repair` (emitted at `server/src/core/engines/structured.engine.js:83`).
2. **Source File and Exported Function Name**: `server/src/core/engines/structured.engine.js:212`, function `prepareSql(rawSql, { schema, semantic })`.
3. **Classification**: DETERMINISTIC. Zero LLM calls; pure code AST/token transformations.
4. **Trigger Condition**: Runs unconditionally on the raw SQL string immediately before validation.
5. **Inputs**:
   - `rawSql`: `string`
   - `{ schema, semantic }`: Discovered schema object and semantic model.
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       sql: string,
       repairs: Array<{ type: string, [key: string]: any }>,
       unresolvedColumns: Array<{ name: string, suggestions: string[] }>
     }
     ```
     Constructor receipt: `server/src/core/engines/structured.engine.js:240`.
7. **Determinism**: Fully deterministic.
8. **Failure Modes**: Does not throw; invalid syntax passes through to `validateSql`.
9. **Fail-Closed vs Fail-Open**: Fail-safe. Only transforms toward confirmed schema elements.
10. **Disable-ability**: NO (hardcoded in `server/src/core/engines/structured.engine.js:82`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Never introduces external identifiers; strictly maps to discovered schema.
14. **Unit Test Coverage**: Direct coverage across 4 dedicated unit test suites: `sql.repair.test.js`, `integer-division.test.js`, `sql-analyzer.test.js`, `case-insensitive-text.test.js`.
15. **Monkey-Patchability**: Exported from `server/src/core/engines/structured.engine.js:255`.

### Detailed Breakdown of the 6 Deterministic Repairs

#### Repair 1: Table Name Normalization (`table_name`)
- **Trigger**: Bare table identifier following `FROM` or `JOIN` that does not match any table in the schema (`server/src/structured/sql.repair.js:44-54`).
- **Transformation**: Evaluates singular and plural variants (`singularize`, `pluralize`) against lowercase schema table names. Replaces matching identifiers with the real table name (`server/src/structured/sql.repair.js:57-64`).
- **Test Citation**: `server/tests/unit/sql.repair.test.js:8` ("fixes a plural guess against a singular real table name", e.g. `FROM employees` → `FROM employee`).

#### Repair 2: Missing FROM Clause Injection (`missing_from`)
- **Trigger**: SQL lacks a `FROM` clause (`!/\bFROM\b/i.test(sql)`) AND the dataset contains exactly one table (`schema.tables.length === 1`) (`server/src/structured/sql.repair.js:79-81`).
- **Transformation**: Appends `FROM "<only_table>"` to the end of the query (`server/src/structured/sql.repair.js:84`). If ambiguous (>1 table), does nothing and leaves query to fail in validation.
- **Test Citation**: Verified in `server/tests/unit/sql.repair.test.js` and engine recovery test cases.

#### Repair 3: Integer Division Promotion (`integer_division`)
- **Trigger**: Occurrence of `/` operator immediately following an aggregate (`COUNT(...)` or `SUM(...)`) that is not already cast to float or multiplied by `1.0` (`server/src/structured/sql.repair.js:119-152`).
- **Transformation**: Uses backward balanced-parenthesis scanning to locate the preceding aggregate function and prefixes it with `1.0 * ` (`server/src/structured/sql.repair.js:153`), preventing SQLite integer division truncation (e.g. `5 / 7` yielding `0`).
- **Test Citation**: `server/tests/unit/integer-division.test.js:13` ("fixes the exact reported completion-rate bug", testing `COUNT(CASE...) / COUNT(*) * 100` resulting in `71.43%` instead of `0%`).

#### Repair 4: Fuzzy Column Name Correction (`column_name`)
- **Trigger**: Tokenizer detects unknown column identifiers in expressions or where-clauses (`server/src/structured/sql.analyzer.js:149`).
- **Transformation**: Uses Levenshtein-based closest match (`closestMatch`) against valid columns of tables in scope (`server/src/structured/sql.analyzer.js:165-170`). Substitutes misspelled column names (e.g., `salaryy` → `salary`).
- **Test Citation**: `server/tests/unit/sql-analyzer.test.js:23` ("misspelled columns are repaired to real ones; unresolved ones are reported").

#### Repair 5: Missing GROUP BY Injection (`missing_group_by`)
- **Trigger**: Top-level `SELECT` statement contains both bare unaggregated columns and aggregate functions (`COUNT`, `SUM`, `AVG`, etc.), but omits a `GROUP BY` clause (`server/src/structured/sql.analyzer.js:179-212`).
- **Transformation**: Collects all non-aggregate column expressions and injects `GROUP BY <cols>` immediately before `HAVING`, `ORDER BY`, `LIMIT`, or at string end (`server/src/structured/sql.analyzer.js:215-218`).
- **Test Citation**: `server/tests/unit/sql-analyzer.test.js:31` ("missing GROUP BY is added for aggregate + bare column").

#### Repair 6: Categorical Value-Literal Repair (`value_literal`)
- **Trigger**: String literal in equality filter (`col = 'val'` or `col IN ('val')`) does not match known low-cardinality values in semantic profile (`server/src/structured/sql.values.repair.js:49-59`).
- **Transformation**: Matches literal against measured categorical distinct values using case-insensitive comparison, normalization, or edit distance (`resolveLiteral`, lines 25-32), rewriting literal to exact database casing (`server/src/structured/sql.values.repair.js:63-64`).
- **Test Citation**: `server/tests/unit/sql-analyzer.test.js:40` ("value literals are repaired against measured values only", e.g. `status = 'cancelled'` → `status = 'Cancelled'`).

---

## 9. SQL Validation (`sql_validated`)

1. **Stage Name (Verbatim Trace Name)**: `sql_validated` (emitted at `server/src/core/engines/structured.engine.js:86`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.validator.js:66`, function `validateSql(sql, schema, datasetType)`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Runs on every prepared SQL statement prior to policy enforcement or execution.
5. **Inputs**:
   - `sql`: `string`
   - `schema`: `{ tables: Table[] }`
   - `datasetType`: `string` (maps to parser grammar: SQLite/PostgreSQL/MySQL).
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       valid: true,
       ast: object,
       tablesUsed: string[],
       complexity: object
     }
     ```
     Constructor receipt: `server/src/structured/sql.validator.js:135`.
7. **Determinism**: Fully deterministic AST traversal and keyword screening.
8. **Failure Modes**: Throws `SQLValidationError` (`server/src/structured/sql.validator.js:27`) on empty queries, blocked keywords, multiple statements, SQL comments, AST parse failure, non-SELECT statements, unknown tables, or complexity violations.
9. **Fail-Closed vs Fail-Open**: Fail-closed. Security-related validation errors abort immediately via `validationFailure` (`server/src/core/engines/structured.engine.js:102-104`). Recoverable errors trigger error recovery re-prompting.
10. **Disable-ability**: NO (hardcoded at `server/src/core/engines/structured.engine.js:85`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**:
    - Blocked keyword gate (`server/src/structured/sql.validator.js:21-25`): rejects `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `CREATE`, `ATTACH`, `DETACH`, `REPLACE`, `TRUNCATE`, `GRANT`, `REVOKE`, `PRAGMA`, `VACUUM`, `EXEC`, `EXECUTE`, `CALL`.
    - Multiple statement rejection: blocks semicolons before end of string (`server/src/structured/sql.validator.js:83-85`).
    - Comment rejection: blocks `--` and `/* */` (`server/src/structured/sql.validator.js:86-88`).
    - AST validation: enforces single statement of type `select` (`server/src/structured/sql.validator.js:98-105`).
    - Schema validation: validates all tables in `tableList()` against known schema (`server/src/structured/sql.validator.js:108-127`).
14. **Unit Test Coverage**: `server/tests/unit/sql.validator.test.js:12` (15 dedicated unit tests covering mutation rejection, comment stripping, multiple statement rejection, and unknown table detection).
15. **Monkey-Patchability**: Destructured at module load time in `server/src/core/engines/structured.engine.js:3`.

---

## 10. Complexity Gate (`complexity_gate`)

1. **Stage Name (Verbatim Trace Name)**: Executed inside `validateSql` (`server/src/structured/sql.validator.js:130-133`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.complexity.js:26`, function `analyzeComplexity(sql, schema)`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Evaluated inside `validateSql` for all queries.
5. **Inputs**:
   - `sql`: `string`
   - `schema`: `{ tables: Table[] }`
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       ok: boolean,
       reasons: string[],
       level: 'low' | 'medium' | 'high',
       score: number,
       joinCount: number,
       maxDepth: number,
       estimatedRows: number
     }
     ```
     Constructor receipt: `server/src/structured/sql.complexity.js:69`.
7. **Determinism**: Fully deterministic token counting and fan-out estimation.
8. **Failure Modes**: When `!complexity.ok`, `validateSql` throws `SQLValidationError` (`server/src/structured/sql.validator.js:132`).
9. **Fail-Closed vs Fail-Open**: Fail-closed. Excessive complexity triggers query rejection.
10. **Disable-ability**: Configurable via environment variables: `SQL_MAX_LENGTH` (default 4000), `SQL_MAX_JOINS` (default 6), `SQL_MAX_SUBQUERY_DEPTH` (default 4), `SQL_MAX_ESTIMATED_ROWS` (default 5e9) (`server/src/structured/sql.complexity.js:13-18`). Cannot be entirely disabled.
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Rejects DoS queries, Cartesian products (`CROSS JOIN`, comma-joins without predicates), and exponential subquery nestings.
14. **Unit Test Coverage**: `server/tests/unit/security-hardening.test.js:45`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/structured/sql.validator.js:17`.

---

## 11. Policy Enforcement (`policy_enforced`)

1. **Stage Name (Verbatim Trace Name)**: `policy_enforced` (emitted at `server/src/core/engines/structured.engine.js:89, 95`).
2. **Source File and Exported Function Name**: `server/src/security/data.policy.js:127`, function `enforcePolicy({ sql, schema, policy, datasetType })`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Evaluated on valid SQL prior to execution (`server/src/core/engines/structured.engine.js:87`).
5. **Inputs**:
   - `sql`: `string`
   - `schema`: `{ tables: Table[] }`
   - `policy`: `{ deniedColumns: Array, rowFilters: Array }`
   - `datasetType`: `string`
6. **Outputs**:
   - `string`: Rewritten SQL query containing CTE shadowing for row filters, or original SQL if no filters apply.
7. **Determinism**: Fully deterministic CTE rewriting.
8. **Failure Modes**: Throws `PolicyError` (`status: 403`) if denied column is referenced, if `SELECT *` is used with denied columns, or if row filters are attempted on unsupported MySQL databases (`server/src/security/data.policy.js:84, 90, 108`).
9. **Fail-Closed vs Fail-Open**: Fail-closed. MySQL row-filtering throws `PolicyError` to prevent leaking restricted rows (`server/src/security/data.policy.js:108`).
10. **Disable-ability**: Administrative bypass: admins bypass all policies (`resolvePolicy`, `server/src/security/data.policy.js:59`). Hardcoded enforcement for non-admins.
11. **Statefulness**: Reads policy definitions from SQLite registry table `data_policies` (`server/src/security/data.policy.js:52`).
12. **LLM Call Details**: None.
13. **Security Checks Performed**:
    - Prohibits column access for denied roles.
    - Shadows base tables with filtered Common Table Expressions:
      `WITH "<table_name>" AS (SELECT * FROM main."<table_name>" WHERE <cond>) <sql>`
14. **Unit Test Coverage**: `server/tests/integration/rbac.test.js:35` and `server/tests/integration/hospital-privacy.test.js:22`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/core/engines/structured.engine.js:12`.

---

## 12. Query Execution (`executed`)

1. **Stage Name (Verbatim Trace Name)**: `executed` (emitted at `server/src/core/engines/structured.engine.js:91`).
2. **Source File and Exported Function Name**: `server/src/structured/sql.executor.js:8`, function `executeValidatedQuery(adapter, sql, { maxRows })`.
3. **Classification**: DETERMINISTIC. Read-only database query execution.
4. **Trigger Condition**: Runs once query has passed validation and policy enforcement.
5. **Inputs**:
   - `adapter`: Database adapter (`SqliteAdapter`, `PostgresAdapter`, `MysqlAdapter`).
   - `sql`: `string` (validated, policy-enforced SQL).
   - `maxRows`: `number` (default `config.query.maxRows = 1000`).
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       columns: string[],
       rows: object[],
       rowCount: number,
       truncated: boolean,
       durationMs: number,
       sqlExecuted: string
     }
     ```
     Constructor receipt: `server/src/structured/sql.executor.js:17-24`.
7. **Determinism**: Deterministic given identical underlying database states.
8. **Failure Modes**: Database syntax errors, runtime division by zero, locks, or connection timeouts. Wrapped in adapter lifecycle (`try ... finally { await adapter.disconnect(); }`, `server/src/structured/sql.executor.js:25-27`).
9. **Fail-Closed vs Fail-Open**: Fail-closed. Throws database error, triggering Stage 14 (Error Recovery).
10. **Disable-ability**: NO (hardcoded in `server/src/core/engines/structured.engine.js:90`).
11. **Statefulness**: Reads physical database; read-only connection guarantees zero mutations.
12. **LLM Call Details**: None.
13. **Security Checks Performed**:
    - Enforces hard row cap by wrapping SQL in an outer limit subquery:
      `SELECT * FROM (<sql>) AS __cognicore_capped LIMIT <maxRows>` (`server/src/structured/sql.executor.js:33`).
    - Adapter opened with read-only flags (e.g., `readonly: true` in `better-sqlite3`).
14. **Unit Test Coverage**: `server/tests/integration/ingestion.test.js` and `server/tests/unit/catalog-registry.test.js`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/core/engines/structured.engine.js:4`.

---

## 13. Execution Verification (`result_validated`)

1. **Stage Name (Verbatim Trace Name)**: `result_validated` (emitted at `server/src/core/engines/structured.engine.js:182`).
2. **Source File and Exported Function Name**: `server/src/structured/result.validator.js:9` (`validateResult`) and `server/src/structured/result.checks.js:15` (`validateResultSemantics`).
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Evaluated on execution results immediately following database return.
5. **Inputs**:
   - `result`: `{ columns: string[], rows: object[], rowCount: number, truncated: boolean }`
   - `sql`: `string`
   - `rowCounts`: `Record<string, number>`
6. **Outputs**:
   - Combined issues array, confidence penalty, and validity status (`server/src/core/engines/structured.engine.js:161-164`).
7. **Determinism**: Fully deterministic mathematical checks.
8. **Failure Modes**: Returns `{ valid: false, issues: [...] }`; does not throw.
9. **Fail-Closed vs Fail-Open**: Fail-safe. Issues degrade confidence score rather than aborting query.
10. **Disable-ability**: NO (hardcoded at `server/src/core/engines/structured.engine.js:161-164`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**:
    - Verifies percentage bounds (detects values outside 0–100%).
    - Reconciles grouped `COUNT(*)` sums against physical table row counts.
    - Probes empty results for case/whitespace mismatches (`diagnoseEmptyResult`, `server/src/structured/result.checks.js:59-94`).
14. **Unit Test Coverage**: `server/tests/unit/trust-layer.test.js:18` and `server/tests/unit/case-insensitive-text.test.js:12`.
15. **Monkey-Patchability**: Destructured at module load time in `server/src/core/engines/structured.engine.js:5-6`.

---

## 14. Error Recovery Loop (`error_recovery`)

1. **Stage Name (Verbatim Trace Name)**: `error_recovery` (emitted at `server/src/core/engines/structured.engine.js:119`).
2. **Source File and Exported Function Name**: `server/src/core/engines/structured.engine.js:80-130`, loop in `runStructuredQueryInner`.
3. **Classification**: LLM-DEPENDENT.
4. **Trigger Condition**: Triggers when validation fails or execution throws a recoverable database error (`RECOVERABLE_DB_ERROR`, `server/src/core/engines/structured.engine.js:25`), provided `attempt < maxRecovery` (default 2 attempts).
5. **Inputs**:
   - `previousSql`: `string`
   - `error`: `string`
   - `hints`: `string[]` (unresolved column suggestions from analyzer).
6. **Outputs**:
   - Re-generated candidate SQL evaluated in subsequent loop iteration.
7. **Determinism**: LLM-dependent re-generation.
8. **Failure Modes**: If `attempt >= maxRecovery`, loop terminates, returning failure explanation (`server/src/core/engines/structured.engine.js:108-115`).
9. **Fail-Closed vs Fail-Open**: Fail-closed. Security violations (`SECURITY_MESSAGE`, line 23) bypass recovery completely and abort immediately.
10. **Disable-ability**: Configurable via `maxRecovery` parameter (`server/src/core/engines/structured.engine.js:44`, default 2). Setting `maxRecovery: 0` disables loop.
11. **Statefulness**: Maintains `recoveryLog` array across attempts.
12. **LLM Call Details**: Invokes `generateSql` with `opts.recovery = { previousSql, error, hints }` at temperature 0.2 (`server/src/structured/sql.generator.js:79`).
13. **Security Checks Performed**: Security-related validation errors (SQL injection, comments, multi-statement) match `SECURITY_MESSAGE` and are strictly barred from re-prompting.
14. **Unit Test Coverage**: `server/tests/unit/engine-recovery.test.js:12` ("error recovery: corrects invalid column on second attempt").
15. **Monkey-Patchability**: Embedded directly in `runStructuredQueryInner` control flow.

---

## 15. Result Formatting (`buildStructuredEvidence`)

1. **Stage Name (Verbatim Trace Name)**: Executed inline prior to return (`server/src/core/engines/structured.engine.js:186-199`).
2. **Source File and Exported Function Name**: `server/src/evidence/evidence.manager.js:10`, function `buildStructuredEvidence(params)`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Runs upon successful query execution and validation.
5. **Inputs**:
   - `{ datasetId, datasetName, sql, result, resultValidation, extras }`
6. **Outputs**:
   - Structured evidence object containing query metadata, row count, 20 sample rows, confidence, and provenance:
     ```javascript
     {
       source_type: 'database',
       dataset_id: string,
       dataset_name: string,
       query: string,
       row_count: number,
       truncated: boolean,
       columns: string[],
       sample_rows: object[], // max 20 rows
       confidence: number,
       issues: string[],
       generated_at: string,
       ...extras
     }
     ```
     Constructor receipt: `server/src/evidence/evidence.manager.js:11-25`.
7. **Determinism**: Fully deterministic object composition.
8. **Failure Modes**: None.
9. **Fail-Closed vs Fail-Open**: Fail-safe.
10. **Disable-ability**: NO (hardcoded at `server/src/core/engines/structured.engine.js:186`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Caps embedded sample rows to 20 (`sample_rows: result.rows.slice(0, 20)`) to prevent payload bloat.
14. **Unit Test Coverage**: `server/tests/unit/trust-layer.test.js:30`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/core/engines/structured.engine.js:7`.

---

## 16. Narrative Generation & Grounding (`synthesis` & `grounding_check`)

1. **Stage Name (Verbatim Trace Name)**: `synthesis` and `grounding_check` (emitted at `server/src/core/core.engine.js:125, 127`).
2. **Source File and Exported Function Name**: `server/src/response/answer.composer.js:55` (`composeAnswer`) and `server/src/guardrails/answer.grounding.js:41` (`checkNumericGrounding`).
3. **Classification**: PARTIALLY LLM-DEPENDENT / DETERMINISTIC GROUNDING FALLBACK.
4. **Trigger Condition**: Runs on non-empty evidence. If evidence row count is zero, `composeAnswer` deterministically returns without LLM call (`server/src/response/answer.composer.js:56-63`).
5. **Inputs**:
   - `reasoningProvider`: LLM provider (`reasoning` model).
   - `{ question, evidence, conversationContext, preferences }`
6. **Outputs**:
   - Return shape:
     ```javascript
     {
       answer: string,
       evidence: object,
       lowConfidence: boolean,
       guardrail?: { flags: string[], ungrounded?: string[] }
     }
     ```
     Constructor receipt: `server/src/core/core.engine.js:144, 146`.
7. **Determinism**: LLM explanation is non-deterministic; numeric grounding check and deterministic fallback answer are fully deterministic.
8. **Failure Modes**: If LLM hallucinations or contradictions are detected by `applyGrounding` (`server/src/core/core.engine.js:138-147`), the response is replaced with `buildDeterministicAnswer(evidence)` (`server/src/guardrails/answer.grounding.js:76-85`).
9. **Fail-Closed vs Fail-Open**: Fail-safe fallback to deterministic string templates.
10. **Disable-ability**: NO (hardcoded at `server/src/core/core.engine.js:125-127`).
11. **Statefulness**: Stateless.
12. **LLM Call Details**:
    - Temperature: `0.3` (`server/src/response/answer.composer.js:66`).
    - Max tokens: `500`.
    - Prompt template embeds evidence within XML boundary tags `<untrusted_data>` (`server/src/response/answer.composer.js:41-43`).
13. **Security Checks Performed**:
    - Untrusted data isolation prevents prompt injection from retrieved rows.
    - Grounding verification ensures every numeric token in answer traces back to evidence (`server/src/guardrails/answer.grounding.js:41-55`).
    - Contradiction check flags answers claiming insufficient data when rows exist (`server/src/guardrails/answer.grounding.js:69-71`).
14. **Unit Test Coverage**: `server/tests/unit/guardrails.test.js:32` and `server/tests/unit/trust-layer.test.js:45`.
15. **Monkey-Patchability**: Destructured at module load time in `server/src/core/core.engine.js:4, 12`.

---

## 17. Audit Logging (`audit_logging`)

1. **Stage Name (Verbatim Trace Name)**: Executed inside `finalize` (`server/src/core/core.engine.js:181-182`).
2. **Source File and Exported Function Name**: `server/src/observability/trace.js:42`, method `TraceStore.save(trace)`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Runs on every query termination (successful, blocked, denied, or failed).
5. **Inputs**:
   - `trace`: Serialized trace object containing question, user, session ID, execution steps, status, route type, duration, and timestamps.
6. **Outputs**:
   - `void`. Persists record to SQLite registry table `traces`.
7. **Determinism**: Fully deterministic persistence.
8. **Failure Modes**: Database disk-full or write errors logged via logger; non-blocking to HTTP response.
9. **Fail-Closed vs Fail-Open**: Fail-open on logging failure to avoid dropping completed responses.
10. **Disable-ability**: NO (hardcoded at `server/src/core/core.engine.js:182`).
11. **Statefulness**: Writes to SQLite registry DB (`data/cognicore_registry.db` or `data-test/cognicore_registry.db`).
12. **LLM Call Details**: None.
13. **Security Checks Performed**: Masks sensitive credential tokens; records complete audit footprint (`tables`, `rows`, `sql`, `denied`).
14. **Unit Test Coverage**: `server/tests/integration/engine-e2e.test.js:55`.
15. **Monkey-Patchability**: Destructured at load time in `server/src/core/core.engine.js:18`.

---

## 18. Final Response Assembly

1. **Stage Name (Verbatim Trace Name)**: Executed inside `finalize` (`server/src/core/core.engine.js:188-213`).
2. **Source File and Exported Function Name**: `server/src/core/core.engine.js:162`, function `finalize(...)`.
3. **Classification**: DETERMINISTIC.
4. **Trigger Condition**: Unconditional final step of `handleUserQuery`.
5. **Inputs**:
   - Combined pipeline state: `final`, `extra`, `session`, `question`, `effectiveQuestion`, `fu`, `prevState`, `actor`, `structured`, `resolvedDatasetIds`, `trace`.
6. **Outputs**:
   - Canonical chat response object (`server/src/core/core.engine.js:188-213`).
7. **Determinism**: Fully deterministic object composition.
8. **Failure Modes**: Catches exceptions in optional insight, chart, or follow-up generators (`server/src/core/core.engine.js:174-176`).
9. **Fail-Closed vs Fail-Open**: Fail-safe.
10. **Disable-ability**: NO (hardcoded at `server/src/core/core.engine.js:75, 130`).
11. **Statefulness**: Updates session state (`saveState`, line 185) and session conversation turns (`recordTurn`, line 183).
12. **LLM Call Details**: None.
13. **Security Checks Performed**:
    - PII Redaction: executes `redactEvidence(evidence, semantic, actor.role)` (`server/src/core/core.engine.js:167`).
    - Output text masking: for `viewer` and `employee` roles, masks natural language answer text via `maskText` (`server/src/core/core.engine.js:169`).
14. **Unit Test Coverage**: `server/tests/integration/engine-e2e.test.js` and `server/tests/integration/hospital-privacy.test.js`.
15. **Monkey-Patchability**: Internal function in `server/src/core/core.engine.js:162`.
