# PART 10 — OBSERVABILITY, AUDIT & VALIDATION SEAMS

This chapter analyzes the observability contracts, trace contracts, stage disable-ability, monkey-patching hazards, and hidden-state hazards critical for designing a test runner on top of CogniCore.

---

## 1. Observable vs Hidden Pipeline Stages

The table below contrasts what is explicitly recorded in `trace.steps` and the HTTP API response versus what executes silently across all eighteen pipeline stages.

| Stage # | Stage Name | Trace Step Name | Visible in API Response Payload | Hidden / Silent Side Effects |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `input_screening` | `input_guardrails` | `guardrail.flags`, `audit.flags` | None (pure function). |
| **2** | `intent_classification` | `intent` | `tool`, `audit.tool` (if agent/action) | Unmatched intents silently become `'query'`. |
| **3** | `schema_resolution` | `schema_context` | Inferred in `evidence.columns` | Reads `column_meanings` table silently. |
| **4** | `candidate_selection` | *None* | *None* | Executed internally inside `sql.generator.js`. |
| **5** | `few_shot_retrieval` | *None* | *None* | Injected into prompt text silently. |
| **6** | `prompt_assembly` | *None* | *None* | Internal string concatenation. |
| **7** | `sql_generation` | `sql_generated` | `generatedSql` | Raw LLM completion text is discarded; only cleaned SQL is retained. |
| **8** | `sql_repair` | `auto_repair` | `repairs: Array<{ type, corrections }>` | Unresolved column names stored in local variable; not surfaced in API unless recovery fails. |
| **9** | `sql_validation` | `sql_validated` | Cost level in trace | Rejection details only visible if error aborts. |
| **10**| `complexity_gate` | In `sql_validated` | *None* | Silent if under thresholds; aborts if exceeded. |
| **11**| `policy_enforcement` | `policy_enforced` | `evidence.policy_applied`, `denied` | Rewritten CTE query is executed silently; `generatedSql` in response shows pre-CTE or post-CTE SQL depending on branch. |
| **12**| `query_execution` | `executed` | `execResult.rowCount`, `durationMs` | Outer `LIMIT` subquery wrapping (`__cognicore_capped`) applied silently. |
| **13**| `execution_verification`| `result_validated` | `evidence.issues`, `confidence` | Empty result case-insensitive probing queries (`diagnoseEmptyResult`) run silently against DB. |
| **14**| `error_recovery` | `error_recovery` | `recoveryAttempts`, `recoveryLog` | Intermediate failed queries and error messages logged only if recovery exhausts attempts. |
| **15**| `result_formatting` | *None* | `evidence` object | Embeds only top 20 rows (`sample_rows`); remaining rows kept in memory. |
| **16**| `narrative_generation` | `synthesis`, `grounding_check` | `answer`, `guardrail.ungrounded` | Hallucination replacement replaces text silently; logs warning to Winston logger. |
| **17**| `audit_logging` | *None* | `audit: { success, ... }` | Asynchronously inserts row into SQLite `ai_traces` table; errors caught and swallowed. |
| **18**| `final_response_assembly`| `presentation`, `pii_masking` | Entire JSON response body | Mutates session state (`saveState`) and records turn (`recordTurn`) in SQLite. |

---

## 2. Trace Contract & Schema Specification

The AI Activity trace is governed by the `Trace` and `TraceStore` classes (`server/src/observability/trace.js:19-61`).

### Trace Finish Object Schema
Constructor receipt: `server/src/observability/trace.js:38-40`:

```javascript
{
  trace_id: string,      // 'tr_' + 8 hex chars (e.g. 'tr_a1b2c3d4')
  session_id: string | null,
  user_id: string | null,
  question: string,      // String(question).slice(0, 500)
  route: string | null,  // 'STRUCTURED' | 'DOCUMENT' | 'HYBRID' | 'ANALYSIS' | 'AGENT' | 'REPORT' | 'ACTION' | 'BLOCKED'
  tool: string | null,   // Tool name if AGENT route, else null
  status: string,        // 'ok' | 'blocked' | 'error'
  total_ms: number,      // Execution duration in milliseconds
  steps: Step[],         // Ordered array of step objects
  created_at: string     // ISO 8601 timestamp
}
```

### Step Object Schema
Emitted by `trace.add(name, status, detail, extra)` (`server/src/observability/trace.js:28-30`):

```javascript
{
  n: number,             // 1-indexed execution sequence number
  name: string,          // Stage name (e.g. 'input_guardrails', 'sql_generated', 'auto_repair')
  status: string,        // 'ok' | 'warn' | 'error' | 'blocked' | 'skipped'
  detail: string,        // String(detail).slice(0, 400)
  at_ms: number,         // Elapsed milliseconds from request start
  step_ms?: number       // Individual duration if wrapped in trace.time()
}
```

---

## 3. Stage Disable-ability & Test Runner Isolation

Can an automated test runner isolate and bypass individual stages to isolate errors?

| Stage # | Stage Name | Disable-able via Config / Parameter? | How to Disable or Why Not (Code Receipt) |
| :---: | :--- | :---: | :--- |
| **1** | `input_screening` | **NO** | Hardcoded unconditional call at `server/src/core/core.engine.js:48-55`. |
| **2** | `intent_classification` | **NO** | Hardcoded unconditional call at `server/src/core/core.engine.js:78`. |
| **3** | `schema_resolution` | **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:48-50`. |
| **4** | `candidate_selection` | **NO** | Hardcoded in `buildPrompt()` at `server/src/structured/sql.generator.js:30-38`. |
| **5** | `few_shot_retrieval` | **NO** | Hardcoded in `buildPrompt()` at `server/src/structured/sql.generator.js:38`. |
| **6** | `prompt_assembly` | **NO** | Hardcoded inside `generateSql()` at `server/src/structured/sql.generator.js:78`. |
| **7** | `sql_generation` | **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:60`. |
| **8** | `sql_repair` | **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:82`. Always executes `prepareSql()`. |
| **9** | `sql_validation` | **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:85`. Unconditionally throws `SQLValidationError`. |
| **10**| `complexity_gate` | **PARTIAL** | Can set `SQL_MAX_LENGTH=99999`, `SQL_MAX_JOINS=99`, `SQL_MAX_SUBQUERY_DEPTH=99` via env vars (`server/src/structured/sql.complexity.js:14-17`), but cannot be bypassed entirely. |
| **11**| `policy_enforcement` | **YES** | Passing `user.role = 'admin'` bypasses all column denials and row filters (`server/src/security/data.policy.js:59`). |
| **12**| `query_execution` | **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:90`. |
| **13**| `execution_verification`| **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:161-164`. |
| **14**| `error_recovery` | **YES** | Can pass `maxRecovery: 0` in opts (`server/src/core/engines/structured.engine.js:44`) to terminate on first query failure. |
| **15**| `result_formatting` | **NO** | Hardcoded at `server/src/core/engines/structured.engine.js:186`. |
| **16**| `narrative_generation` | **NO** | Hardcoded at `server/src/core/core.engine.js:125`. |
| **17**| `audit_logging` | **NO** | Hardcoded at `server/src/core/core.engine.js:182`. |
| **18**| `final_response_assembly`| **NO** | Hardcoded at `server/src/core/core.engine.js:75, 130`. |

---

## 4. Monkey-Patching Hazards (Destructuring at Load Time)

### The Structural Hazard
Throughout `server/src/core/core.engine.js:1-24` and `server/src/core/engines/structured.engine.js:1-18`, all stage functions are imported using **destructuring assignment at file evaluation time**:

```javascript
// server/src/core/core.engine.js:10-12
const { screenQuestion } = require('../guardrails/input.guard');
const { redactEvidence } = require('../guardrails/pii');
const { checkNumericGrounding, detectContradiction, buildDeterministicAnswer } = require('../guardrails/answer.grounding');

// server/src/core/engines/structured.engine.js:2-12
const { generateSql } = require('../../structured/sql.generator');
const { validateSql, SQLValidationError } = require('../../structured/sql.validator');
const { executeValidatedQuery } = require('../../structured/sql.executor');
const { validateResult } = require('../../structured/result.validator');
const { repairTableNames, ensureFromClause, fixIntegerDivision } = require('../../structured/sql.repair');
const { enforcePolicy, PolicyError } = require('../../security/data.policy');
```

### Consequences for Test Suites
Because the local identifiers (`screenQuestion`, `validateSql`, `enforcePolicy`, `prepareSql`) are bound directly in the closure scope of `core.engine.js` and `structured.engine.js`, **mutating exported properties on the required modules after `core.engine.js` is loaded does NOT affect execution**:

```javascript
// THIS DOES NOT WORK:
const sqlValidator = require('server/src/structured/sql.validator');
const coreEngine = require('server/src/core/core.engine'); // Already bound!
sqlValidator.validateSql = () => ({ valid: true }); // Ignored by structured.engine!
```

### Required Test Runner Workarounds
To intercept and isolate stages without source modifications, a test runner must:
1. **Patch Exports Prior to Module Requiring**: Intercept and mutate module exports before requiring `core.engine.js` or `structured.engine.js`.
2. **Invalidate `require.cache`**: Delete the target module and all parent engines from `require.cache` before re-requiring.
3. **Use Mocking Loaders**: Utilize module interception libraries (e.g. `proxyquire` or Node test runner mocks) to supply mock bindings during module compilation.

---

## 5. Hidden State Hazards (Caches & Singletons)

State leakage across test cases is caused by persistent in-memory singletons and SQLite databases that do not reset between requests.

| Cache / State Variable | Source Citation | Object Type | What is Cached | Invalidation Policy | Impact on Automated Testing |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `cache` in `registry.db.js` | `server/src/config/registry.db.js:9` | `Map<string, { db, inits }>` | Open `better-sqlite3` database connections | **NEVER invalidated**. Retains open file handles for process lifetime. | If tests switch `NODE_ENV` or DB paths, old connections remain open; WAL locks persist. |
| `cache` in `model.manager.js` | `server/src/llm/model.manager.js:22` | `Map<string, Provider>` | Initialized `LLMProvider` instances | **NEVER invalidated**. | Changing environment variables (`LLM_PROVIDER_SQL`, `OLLAMA_MODEL`) has zero effect if task was already cached. |
| `_embeddingInstance` in `model.manager.js` | `server/src/llm/model.manager.js:23` | Variable | Initialized `OllamaEmbeddingProvider` | **NEVER invalidated**. | Cannot swap embedding provider without resetting internal variable. |
| `buckets` in `rate.limit.js` | `server/src/guardrails/rate.limit.js:5` | `Map<string, number[]>` | Per-user / per-IP request timestamps | In-memory only; cleared when size $>5000$ or via `_reset()`. | Successive test requests trigger HTTP 429 unless `_reset()` is called between tests. |
| `cognicore_registry.db` state | `server/data-test/cognicore_registry.db` | Persistent SQLite file | Registered users, permissions, sessions, traces, policies | **NEVER truncated between test files**. | Causes integration test failures: user registered in test 1 prevents test 2 from becoming admin. |
