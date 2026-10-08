# CogniCore — Validation Seam & Reconciliation Report

## Baseline Repository Receipt
```text
$ git rev-parse HEAD && git status --porcelain && node --version
64d14ea8f4f846645543c01a98d1eb763f34d36a
v24.13.1
```
*(Git repository status was completely clean prior to generating documentation artifacts).*

---

## ══════════ HANDOFF SUMMARY ══════════
*The 12 critical engineering facts for the next testing session:*

1. **R1 (Directory Reality)**: The active project lives strictly in `server/` (Node/Express backend) and `client/` (React 19 Vite frontend); `backend/` and `frontend/` directories do not exist anywhere in the repository.
2. **R2 (Password Hashing)**: Password hashing uses `bcryptjs` with configurable rounds (default 10); PBKDF2-SHA512 does not exist in the security module.
3. **R3 (Model Defaults)**: Model defaults are `qwen2.5:7b` (chat/SQL) and `nomic-embed-text` (embeddings); legacy names `gemma3:4b` and `qwen2.5:14b` are completely absent from the codebase.
4. **R4 (Gate Architecture)**: The real safety chain is `prepareSql` (repair) → `validateSql` (AST) → `analyzeComplexity` (cost) → `enforcePolicy` (CTE shadowing); older files like `gate.chain.js`, `ast.gate.*`, and `fastIntent` do not exist, and no file is marked `FROZEN`.
5. **R5 (Multi-Tenancy & RBAC)**: Multi-tenancy is active with 5 logical roles (`admin`, `manager`, `analyst`, `employee`, `viewer`) and dataset-level ownership/grants; row-level CTE filtering is enforced on SQLite and Postgres, while MySQL fails closed (`PolicyError`).
6. **R6 (Fixture Databases)**: Legacy databases (`ecommerce_test.db`, `college_attendance.db`, `U3_institute.db`, `chinook.db`, `H3_metropol.db`) do not exist; fixtures are generated from the 5 CSVs in `sample-data/` or via `tests/helpers/tempDb.js:makeTempSqlite()`.
7. **R7 (Ground Truth Pins)**: Pinned ground truths in code are the 21 SQL queries across 5 domains in `server/benchmark/suite.js` and planted outlier constants (`95000`, `9800000`, `1250000`); older constants `450000` and `5541` do not exist.
8. **S1 (In-Process Invocation)**: Direct in-process execution via `handleUserQuery({ question, datasetId, user })` works cleanly without starting the HTTP server; it is already used in `server/benchmark/run.js`.
9. **S4 (Provider Mocking)**: Mocking the LLM provider is straightforward by monkey-patching `getLLMProvider` on `server/src/llm/model.manager.js`; the mock provider only needs to implement `async complete(prompt, options)`.
10. **S2 (Trace Attribution)**: The trace recorder (`Trace`) captures granular sub-steps for `STRUCTURED` execution (`schema_context`, `sql_generated`, `auto_repair`, `sql_validated`, `executed`, `result_validated`, `confidence`), but `DOCUMENT`, `HYBRID`, and `ANALYSIS` engines currently omit engine-level sub-steps.
11. **GAP-1 (Ollama keep_alive)**: Ollama HTTP requests do not pass `keep_alive` and provide no unload mechanism, which is needed to release VRAM during test sweeps.
12. **GAP-2 (In-Memory Handle Caching on Windows)**: `getRegistryDb` caches `better-sqlite3` database handles in memory without a reset function; tests on Windows cannot delete `data-test/` SQLite files while handles remain open.

---

## ══════════ PART 1 — RECONCILIATION (§R) ══════════

### R1. Directory Reality

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Active project uses `server/` and `client/` directories. | **Verified**. `server/` (backend) and `client/` (frontend) exist. `backend/` and `frontend/` do not exist in the repo. | [server/package.json:6-14](file:///C:/cognicore/CogniCore/server/package.json#L6-L14)<br>`main: "src/index.js"`<br>`scripts.test: "node --test"` | The test suite runner, scripts, and imports must target `server/src` and `server/tests/`. Never reference `backend/`. |

- **Inventory Command**:
  ```powershell
  Get-ChildItem -Path C:\cognicore\CogniCore | Select-Object Name
  # Returns: client, sample-data, server, docs, markdown specs
  ```
- **Existing Test Directory**: `server/tests/` with subdirectories `unit/`, `integration/`, `benchmark/`, and `helpers/`.
- **Target Convention for New Suite**: `server/tests/validation/` (or `server/tests/seams/`), using Node's native runner (`node --test`).

---

### R2. Password Hashing

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Authentication uses bcrypt password hashing. | **Verified**. Hashing uses `bcryptjs.hash()` and `bcryptjs.compare()`. PBKDF2-SHA512 does not exist anywhere in the security module. | [server/src/security/auth.js:2-10](file:///C:/cognicore/CogniCore/server/src/security/auth.js#L2-L10)<br>`bcrypt.hash(plain, config.auth.bcryptRounds)`<br>`bcrypt.compare(plain, hash)` | Fixture users in tests must be created using `bcryptjs` hashes or directly via `AuthRegistry.createUser({ passwordHash: '...' })`. |

---

### R3. Model Defaults & Configuration

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Default models are `qwen2.5:7b` for generation and `nomic-embed-text` for embeddings. | **Verified**. `env.js` sets `qwen2.5:7b` and `nomic-embed-text`. Older models (`gemma3:4b`, `qwen2.5:14b`) do not exist in any file. | [server/src/config/env.js:26-28](file:///C:/cognicore/CogniCore/server/src/config/env.js#L26-L28)<br>[server/src/llm/model.manager.js:21-39](file:///C:/cognicore/CogniCore/server/src/llm/model.manager.js#L21-L39) | Suite runner must use `qwen2.5:7b` when testing with real Ollama models, or mock the provider. |

#### Verbatim `model.manager.js` Task-to-Model Map and Env Overrides

In [server/src/llm/model.manager.js:21-39](file:///C:/cognicore/CogniCore/server/src/llm/model.manager.js#L21-L39):
- Supported tasks: `TASKS = ['sql', 'reasoning', 'rewrite', 'planner']`
- Provider selection:
  - `LLM_PROVIDER_SQL`, `LLM_PROVIDER_REASONING`, `LLM_PROVIDER_REWRITE`, `LLM_PROVIDER_PLANNER` (falls back to `LLM_PROVIDER`, default: `'ollama'`)
- Ollama model selection:
  - `OLLAMA_MODEL_SQL`, `OLLAMA_MODEL_REASONING`, `OLLAMA_MODEL_REWRITE`, `OLLAMA_MODEL_PLANNER` (falls back to `OLLAMA_MODEL`, default: `'qwen2.5:7b'`)
- Cloud provider overrides:
  - `OPENAI_MODEL_SQL`, `OPENAI_MODEL_REASONING`, `OPENAI_MODEL_REWRITE`, `OPENAI_MODEL_PLANNER` (default: `'gpt-4o-mini'`)
  - `ANTHROPIC_MODEL_SQL`, `ANTHROPIC_MODEL_REASONING`, `ANTHROPIC_MODEL_REWRITE`, `ANTHROPIC_MODEL_PLANNER` (default: `'claude-haiku-4-5-20251001'`)
- Embedding model:
  - `OLLAMA_EMBEDDING_MODEL` (default: `'nomic-embed-text'`)

---

### R4. Gate Architecture & Freezing

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Real chain is `sql.repair` → `sql.validator` → `sql.complexity` → `data.policy`. | **Verified**. `prepareSql()` repairs, `validateSql()` parses AST & checks complexity, `enforcePolicy()` wraps CTEs. Files `gate.chain.js`, `ast.gate.*`, `fastIntent`, `pipeline.config.js` do not exist. No validator or file is marked `FROZEN`. | [server/src/core/engines/structured.engine.js:82-90](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L82-L90)<br>[server/src/structured/sql.validator.js:15-139](file:///C:/cognicore/CogniCore/server/src/structured/sql.validator.js#L15-L139)<br>[server/src/structured/sql.complexity.js:72-76](file:///C:/cognicore/CogniCore/server/src/structured/sql.complexity.js#L72-L76) | Test assertions must evaluate `sql.repair.js`, `sql.validator.js`, `sql.complexity.js`, and `data.policy.js` directly. Ignore legacy gate documentation. |

---

### R5. Multi-Tenancy & RBAC

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Multi-tenancy is implemented with 5 roles, dataset grants, and dialect-aware row policies (MySQL fails closed). | **Verified**. Roles: `admin`, `manager`, `analyst` (`user` alias), `employee`, `viewer`. Dataset grants in `dataset_grants` table. Row policies work on SQLite & Postgres via CTE shadowing; MySQL throws `PolicyError`. | [server/src/security/rbac.js:55-63](file:///C:/cognicore/CogniCore/server/src/security/rbac.js#L55-L63)<br>[server/src/security/auth.registry.js:35-43](file:///C:/cognicore/CogniCore/server/src/security/auth.registry.js#L35-L43)<br>[server/src/security/data.policy.js:108-118](file:///C:/cognicore/CogniCore/server/src/security/data.policy.js#L108-L118) | The suite must test User A vs User B isolation, capability denials, row filtering via CTEs, and verify that MySQL throws `PolicyError` 403 on row policies. |

---

### R6. Fixture Databases

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Fixture databases `ecommerce_test.db`, `college_attendance.db`, `U3_institute.db`, `chinook.db`, `H3_metropol.db` exist. | **False**. None of those 5 files exist anywhere in the filesystem. The real fixtures are the 5 CSVs in `sample-data/`, and ephemeral SQLite DBs created by `tempDb.js`. | [sample-data/](file:///C:/cognicore/CogniCore/sample-data/)<br>[server/scripts/generate-sample-data.js:10-91](file:///C:/cognicore/CogniCore/server/scripts/generate-sample-data.js#L10-L91)<br>[server/tests/helpers/tempDb.js:6-17](file:///C:/cognicore/CogniCore/server/tests/helpers/tempDb.js#L6-L17) | Tests cannot attempt to mount legacy `.db` files. Tests must ingest files from `sample-data/` or generate them dynamically with `makeTempSqlite()`. |

#### Existing Sample Datasets Inventory

| File Path | Format | Record Count | Planted Flaw / Outlier |
|---|---|---|---|
| `sample-data/hospital_appointments.csv` | CSV | 241 rows (240 + 1 duplicate) | Fee outlier `95000` (row 11), duplicate row 4, mixed date formats (`DD/MM/YYYY` and `YYYY-MM-DD`). |
| `sample-data/hr_employees.csv` | CSV | 160 rows | Salary outlier `9800000` (row 8), missing salary (row 21). |
| `sample-data/finance_expenses.csv` | CSV | 182 rows | Suspicious spend `1250000` (row 181), duplicate row 6. |
| `sample-data/retail_orders.csv` | CSV | 216 rows | Clean flat retail dataset across 4 regions. |
| `sample-data/education_students.csv` | CSV | 180 rows | Clean academic records with scores and attendance rates. |
| `sample-data/retail_multitable.db` | SQLite | 5 tables (generated via `npm run sample-data`) | `customers` (40), `products` (24), `orders` (150), `order_items` (~300), `payments` (150). Declared FKs. |

---

### R7. Prior Pinned Ground Truths in Code

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Pinned numbers `450000`, `450000.00`, `5541`, or "oracle" files exist. | **False**. `450000`, `5541`, and "oracle" do not exist anywhere in code or tests. Real ground truths are pinned in `server/benchmark/suite.js`. | [server/benchmark/suite.js:11-63](file:///C:/cognicore/CogniCore/server/benchmark/suite.js#L11-L63)<br>[server/tests/benchmark/benchmark.test.js:9-10](file:///C:/cognicore/CogniCore/server/tests/benchmark/benchmark.test.js#L9-L10) | Pinned assertions must be taken from `suite.js` (21 domain queries + planted outliers: `95000`, `9800000`, `1250000`). Never assert `450000` or `5541`. |

---

### R8. Runtime Facts

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Node.js 18+, better-sqlite3, child_process Python fallback, and zero-dependency test runner. | **Verified**. No `"engines"` in `package.json` (`README.md` requires 18+). Uses `better-sqlite3: ^11.3.0` (`node:sqlite` is absent). Python tool falls back to JS on `NO_PYTHON`. Tests use `node:test` + `node:assert/strict`. | [server/package.json:10, 18](file:///C:/cognicore/CogniCore/server/package.json#L10)<br>[server/src/python/python.tool.js:20-43, 76-79](file:///C:/cognicore/CogniCore/server/src/python/python.tool.js#L20-L43)<br>[server/tests/unit/sql.validator.test.js:2-3](file:///C:/cognicore/CogniCore/server/tests/unit/sql.validator.test.js#L2-L3) | Testing framework must continue using Node's native `node:test` module. The Python tool test suite must verify both Python execution and JavaScript fallback paths. |

---

### R9. Corpora Verification

| REPORT-CLAIM | CODE-TRUTH | file:line receipt | impact on suite |
|---|---|---|---|
| Benchmark suite has `INJECTION_CORPUS` and `SQL_ATTACK_CORPUS`. | **Verified**. `INJECTION_CORPUS` contains 10 attacks, `SAFE_CORPUS` contains 4 strings, and `SQL_ATTACK_CORPUS` contains 10 SQL injection attacks. | [server/benchmark/suite.js:81-97](file:///C:/cognicore/CogniCore/server/benchmark/suite.js#L81-L97)<br>[server/benchmark/run.js:1-7](file:///C:/cognicore/CogniCore/server/benchmark/run.js#L1-L7) | Security test gates can import `INJECTION_CORPUS` and `SQL_ATTACK_CORPUS` directly from `server/benchmark/suite.js`. |

---

## ══════════ PART 2 — SEAM MAP (§S) ══════════

### S1. In-Process Invocation Seam

In-process invocation is **fully functional** without starting an HTTP server. It is already demonstrated in [server/benchmark/run.js:39, 50](file:///C:/cognicore/CogniCore/server/benchmark/run.js#L39).

#### Function Signature: `handleUserQuery(options)`
**File**: [server/src/core/core.engine.js:38](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L38)

```javascript
async function handleUserQuery({
  question,        // string (REQUIRED) - natural language question
  datasetId,       // string (OPTIONAL) - singular dataset ID
  datasetIds,      // string[] (OPTIONAL) - array of dataset IDs (for hybrid queries)
  sessionId,       // string (OPTIONAL) - session ID; creates new UUID if omitted
  userId,          // string (OPTIONAL) - user ID for permission resolution
  user,            // object (OPTIONAL) - { user_id, role, name, email }; defaults to { role: 'analyst' }
  analysisMode,    // boolean (OPTIONAL, default false) - enables deep multi-step analysis mode
})
```

#### Minimal Bootstrap Sequence for Tests (Ordered)
1. **Set Test Environment**:
   ```javascript
   process.env.NODE_ENV = 'test';
   process.env.JWT_SECRET = 'test_secret_for_validation_suite';
   ```
   *Receipt*: [server/tests/helpers/testEnv.js:3-4](file:///C:/cognicore/CogniCore/server/tests/helpers/testEnv.js#L3-L4). Isolates storage directories to `data-test/` and `uploads-test/`.
2. **Initialize Registries & DBs**:
   - `const { DatasetRegistry } = require('../src/ingestion/dataset.registry');` ([dataset.registry.js:22-67](file:///C:/cognicore/CogniCore/server/src/ingestion/dataset.registry.js#L22-L67))
   - `const { AuthRegistry } = require('../src/security/auth.registry');` ([auth.registry.js:22-54](file:///C:/cognicore/CogniCore/server/src/security/auth.registry.js#L22-L54))
3. **Ingest Fixture Dataset**:
   ```javascript
   const { ingestFile } = require('../src/ingestion/ingestion.pipeline');
   const dataset = await ingestFile({ filePath: tmpCsvPath, originalFilename: 'data.csv', ownerId: user.user_id });
   ```
   *Receipt*: [server/src/ingestion/ingestion.pipeline.js:23](file:///C:/cognicore/CogniCore/server/src/ingestion/ingestion.pipeline.js#L23). Returns ready dataset object with discovered `dataset.dataset_id`.
4. **Mock LLM Provider (Optional / CI mode)**:
   ```javascript
   const mm = require('../src/llm/model.manager');
   mm.getLLMProvider = () => mockLLM;
   mm.getEmbeddingProvider = () => mockEmbedder;
   ```
   *Receipt*: [server/benchmark/run.js:14-15](file:///C:/cognicore/CogniCore/server/benchmark/run.js#L14-L15).
5. **Invoke Core Engine**:
   ```javascript
   const { handleUserQuery } = require('../src/core/core.engine');
   const result = await handleUserQuery({ question: 'How many rows?', datasetId: dataset.dataset_id, user });
   ```

---

### S2. Trace Contract & Failure Attribution

#### Schema of `ai_traces` Table
**File**: [server/src/observability/trace.js:11-16](file:///C:/cognicore/CogniCore/server/src/observability/trace.js#L11-L16)
```sql
CREATE TABLE IF NOT EXISTS ai_traces (
  trace_id TEXT PRIMARY KEY,
  session_id TEXT,
  user_id TEXT,
  question TEXT,
  route TEXT,
  tool TEXT,
  status TEXT,
  total_ms INTEGER,
  steps_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_user ON ai_traces(user_id, created_at);
```

#### Individual Step Record Structure
**File**: [server/src/observability/trace.js:28-30](file:///C:/cognicore/CogniCore/server/src/observability/trace.js#L28-L30)
```javascript
{
  n: 1,             // 1-indexed step sequence
  name: "query",    // verbatim step identifier
  status: "ok",     // 'ok' | 'warn' | 'error' | 'blocked' | 'skipped'
  detail: "...",    // string description (truncated to 400 chars)
  at_ms: 42,        // millisecond timestamp relative to start
  step_ms: 15       // execution duration of step (optional)
}
```

#### Complete Step Names in Execution Order by Engine

##### 1. `STRUCTURED` Engine Route:
1. `input_guardrails` (`ok` | `warn` | `blocked`) — [core.engine.js:49](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L49)
2. `follow_up` (`ok` | `skipped`) — [core.engine.js:69](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L69)
3. `intent` (`ok`) — [core.engine.js:79](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L79)
4. *(If Agent Handles)*:
   - `tool_selected` (`ok`) — [core.engine.js:99](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L99)
   - `query` (`ok`) — [core.engine.js:100](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L100)
   - `executed` (`ok`) — [core.engine.js:101](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L101)
5. `routing` (`ok`) — [core.engine.js:115](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L115)
6. `schema_context` (`ok`) — [structured.engine.js:59](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L59)
7. `sql_generated` (`ok` | `warn`) — [structured.engine.js:61](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L61)
8. `auto_repair` (`ok`) — [structured.engine.js:83](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L83)
9. `sql_validated` (`ok` | `error`) — [structured.engine.js:86, 107](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L86)
10. `policy_enforced` (`ok` | `blocked`) — [structured.engine.js:89, 95](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L89)
11. `executed` (`ok` | `error`) — [structured.engine.js:91, 107](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L91)
12. *(If DB Error)*: `error_recovery` (`warn`) — [structured.engine.js:119](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L119)
13. *(If 0 Rows)*: `empty_result_diagnosis` (`ok` | `warn`) — [structured.engine.js:158](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L158)
14. `result_validated` (`ok` | `warn`) — [structured.engine.js:182](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L182)
15. `confidence` (`ok` | `warn`) — [structured.engine.js:183](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L183)
16. `synthesis` (`ok` | `error`) — [core.engine.js:125](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L125)
17. `grounding_check` (`ok` | `warn`) — [core.engine.js:127](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L127)
18. *(If role restricted)*: `pii_masking` (`ok`) — [core.engine.js:179](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L179)
19. `presentation` (`ok`) — [core.engine.js:180](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L180)

##### 2. `DOCUMENT` Engine Route:
`input_guardrails` → `follow_up` → `intent` → `routing` → `synthesis` → `grounding_check` → `presentation`. *(Sub-steps inside document retriever are currently not emitted to trace; see GAP-4).*

##### 3. `ANALYSIS` Engine Route:
`input_guardrails` → `follow_up` → `intent` → `routing` → `presentation`. *(Individual sub-step queries execute structured engine internally; see GAP-4).*

#### Fetching Traces in Tests
- **In-process**: Returned directly as `result.trace` from `handleUserQuery()`.
- **Offline / Database**: `TraceStore.get(traceId)` or `TraceStore.list({ userId, limit })` ([trace.js:49-58](file:///C:/cognicore/CogniCore/server/src/observability/trace.js#L49-L58)).

---

### S3. Response & Evidence Contract (Verbatim Fields)

Source: Constructed in [server/src/core/core.engine.js:188-213](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L188-L213) and sanitized for HTTP output in [server/src/api/routes/chat.js:51-52](file:///C:/cognicore/CogniCore/server/src/api/routes/chat.js#L51-L52).

#### 1. Success Response Shape (HTTP 200)
```json
{
  "sessionId": "ses_xxxxxxxx",
  "routeType": "STRUCTURED",
  "answer": "There are 241 appointments recorded in the dataset.",
  "evidence": {
    "source_type": "database",
    "dataset_id": "ds_xxxxxxxx",
    "dataset_name": "hospital_appointments",
    "query": "SELECT COUNT(*) FROM \"hospital_appointments\"",
    "row_count": 1,
    "truncated": false,
    "columns": ["COUNT(*)"],
    "sample_rows": [{"COUNT(*)": 241}],
    "confidence": 0.95,
    "issues": [],
    "generated_at": "2026-10-08T18:00:00.000Z",
    "tables_used": ["hospital_appointments"],
    "columns_used": ["hospital_appointments.*"],
    "provenance": {
      "source": "hospital_appointments",
      "dataset_id": "ds_xxxxxxxx",
      "source_type": "csv",
      "tables": ["hospital_appointments"],
      "columns": ["hospital_appointments.*"],
      "query": "SELECT COUNT(*) FROM \"hospital_appointments\"",
      "calculation": "count of records",
      "rows_scanned": 241,
      "rows_returned": 1,
      "timestamp": "2026-10-08T18:00:00.000Z"
    },
    "confidence_detail": {
      "score": 0.95,
      "level": "High",
      "components": {
        "schema": {"score": 1, "reason": "All tables and columns matched the real schema."},
        "query": {"score": 1, "reason": "The query validated and ran first time."},
        "completeness": {"score": 1, "reason": "The columns used are fully populated."},
        "consistency": {"score": 1, "reason": "Result checks (ranges, totals, reconciliation) passed."},
        "evidence": {"score": 1, "reason": "1 row(s) of real data back this answer."}
      },
      "summary": "High confidence: the query ran cleanly on complete data.",
      "missing_data": []
    }
  },
  "lowConfidence": false,
  "generatedSql": "SELECT COUNT(*) FROM \"hospital_appointments\"",
  "execResult": {
    "columns": ["COUNT(*)"],
    "rows": [{"COUNT(*)": 241}],
    "rowCount": 1,
    "truncated": false
  },
  "partial": undefined,
  "insights": [],
  "chart": null,
  "suggestions": [
    "What is the breakdown by department?",
    "Show average fee by status"
  ],
  "trace": {
    "trace_id": "tr_xxxxxxxx",
    "session_id": "ses_xxxxxxxx",
    "user_id": "usr_xxxxxxxx",
    "question": "How many appointments are there?",
    "route": "STRUCTURED",
    "tool": null,
    "status": "ok",
    "total_ms": 182,
    "steps": [],
    "created_at": "2026-10-08T18:00:00.000Z"
  },
  "confidence": { /* duplicated from evidence.confidence_detail */ },
  "provenance": { /* duplicated from evidence.provenance */ },
  "qualityWarnings": [ /* array of warning strings if affected columns have flaws */ ]
}
```

*Conditional Fields on Success Object:*
- `tool`: string (when handled by agent tool: `trend`, `forecast`, `anomaly`, etc.)
- `analytics`: object (structured output from agent tool)
- `report`: `{ datasetId, title, formats: ['pdf', 'docx', 'xlsx', 'csv'] }`
- `action`: `{ action_id, type, summary, status }`
- `repairs`: `[{ type: "column_name", corrections: [...] }]`
- `recoveryAttempts`: integer (number of retries taken)
- `guardrail`: `{ flags: ["ungrounded_numbers_replaced"], ungrounded: ["450000"] }`
- `redactedFields`: integer (number of PII cells masked)
- `followUp`: `{ standaloneQuestion: "..." }`
- `denied`: `true` (when policy denied column or row)

#### 2. Guardrail Blocked Refusal Shape
**File**: [server/src/core/core.engine.js:54](file:///C:/cognicore/CogniCore/server/src/core/core.engine.js#L54)
```json
{
  "sessionId": "ses_xxxxxxxx",
  "routeType": "BLOCKED",
  "answer": "I can only answer questions about your connected data. I can't follow instructions that try to change my rules, bypass permissions, or reveal internal configuration.",
  "evidence": null,
  "lowConfidence": true,
  "guardrail": {
    "flags": ["prompt_injection"]
  }
}
```

#### 3. Error Response Shape (HTTP Middleware)
**File**: [server/src/api/middleware/errorHandler.js:4-15](file:///C:/cognicore/CogniCore/server/src/api/middleware/errorHandler.js#L4-L15)
```json
{
  "error": true,
  "message": "\"question\" (string) is required in the request body.",
  "name": "Error"
}
```

---

### S4. Provider Injection Seam (Mocking for CI)

#### Instantiation & Monkey-Patch Seam
`core.engine.js:57-60` imports `getLLMProvider` and `getEmbeddingProvider` from `server/src/llm/model.manager.js`.
To mock without starting Ollama:
```javascript
const mm = require('../src/llm/model.manager');

// Inject deterministic mock LLM:
mm.getLLMProvider = (task) => ({
  name: 'mock-provider',
  async complete(prompt, options = {}) {
    if (/GENERATE A SQL QUERY/i.test(prompt)) {
      return 'SELECT COUNT(*) FROM hospital_appointments';
    }
    return 'There are 241 appointments recorded.';
  },
  async healthCheck() {
    return { healthy: true };
  }
});

// Inject deterministic mock Embedder:
mm.getEmbeddingProvider = () => ({
  name: 'mock-embedder',
  async embed(texts) {
    return texts.map(() => new Array(768).fill(0.01));
  },
  async healthCheck() {
    return { healthy: true };
  }
});
```

#### Provider Interface Contracts

##### 1. `LLMProvider`
**File**: [server/src/llm/llm.provider.js:7-25](file:///C:/cognicore/CogniCore/server/src/llm/llm.provider.js#L7-L25)
- `async complete(prompt, options = {})`:
  - Input: `prompt` (string), `options`: `{ temperature: number, maxTokens: number, json: boolean }`
  - Returns: `Promise<string>`
- `async healthCheck()`:
  - Returns: `Promise<{ healthy: boolean, ... }>`
- `get name()`:
  - Returns: `string` (e.g. `'ollama:qwen2.5:7b'`, `'mock-provider'`)

##### 2. `EmbeddingProvider`
**File**: [server/src/llm/embedding.provider.js:8-25](file:///C:/cognicore/CogniCore/server/src/llm/embedding.provider.js#L8-L25)
- `async embed(texts)`:
  - Input: `texts` (string[])
  - Returns: `Promise<number[][]>` (matrix of floating point numbers)
- `async healthCheck()`:
  - Returns: `Promise<{ healthy: boolean }>`
- `get name()`:
  - Returns: `string`

---

### S5. Configuration Surface

#### All Test-Relevant Environment Variables

| Variable Name | Read At (file:line) | Default | Effect |
|---|---|---|---|
| `NODE_ENV` | [config/env.js:10](file:///C:/cognicore/CogniCore/server/src/config/env.js#L10) | `'development'` | When `'test'`, routes storage to `data-test/` and `uploads-test/`. |
| `DATA_DIR` | [config/env.js:33](file:///C:/cognicore/CogniCore/server/src/config/env.js#L33) | `data/` or `data-test/` | Base directory for database files. |
| `REGISTRY_DB_PATH` | [config/env.js:35](file:///C:/cognicore/CogniCore/server/src/config/env.js#L35) | `<DATA_DIR>/cognicore_registry.db` | Primary SQLite registry path. |
| `LLM_PROVIDER` | [config/env.js:23](file:///C:/cognicore/CogniCore/server/src/config/env.js#L23) | `'ollama'` | Global default LLM provider (`'ollama'`, `'openai'`, `'anthropic'`). |
| `OLLAMA_BASE_URL` | [config/env.js:25](file:///C:/cognicore/CogniCore/server/src/config/env.js#L25) | `'http://localhost:11434'` | HTTP endpoint for local Ollama daemon. |
| `OLLAMA_MODEL` | [config/env.js:26](file:///C:/cognicore/CogniCore/server/src/config/env.js#L26) | `'qwen2.5:7b'` | Default model for chat and SQL generation. |
| `OLLAMA_TIMEOUT_MS` | [config/env.js:27](file:///C:/cognicore/CogniCore/server/src/config/env.js#L27) | `120000` *(env.example has 60000)* | Axios HTTP timeout for Ollama completion calls. |
| `OLLAMA_EMBEDDING_MODEL` | [config/env.js:28](file:///C:/cognicore/CogniCore/server/src/config/env.js#L28) | `'nomic-embed-text'` | Model used for document embedding. |
| `OLLAMA_MODEL_SQL` | [model.manager.js:29](file:///C:/cognicore/CogniCore/server/src/llm/model.manager.js#L29) | `OLLAMA_MODEL` | Specific model override for SQL drafting task. |
| `OLLAMA_MODEL_REASONING` | [model.manager.js:29](file:///C:/cognicore/CogniCore/server/src/llm/model.manager.js#L29) | `OLLAMA_MODEL` | Specific model override for explanation/synthesis task. |
| `OLLAMA_MODEL_REWRITE` | [model.manager.js:29](file:///C:/cognicore/CogniCore/server/src/llm/model.manager.js#L29) | `OLLAMA_MODEL` | Specific model override for follow-up query rewriting. |
| `OLLAMA_MODEL_PLANNER` | [model.manager.js:29](file:///C:/cognicore/CogniCore/server/src/llm/model.manager.js#L29) | `OLLAMA_MODEL` | Specific model override for deep multi-step planning. |
| `MAX_RESULT_ROWS` | [config/env.js:40](file:///C:/cognicore/CogniCore/server/src/config/env.js#L40) | `1000` | Maximum rows returned by adapter queries. |
| `QUERY_TIMEOUT_MS` | [config/env.js:41](file:///C:/cognicore/CogniCore/server/src/config/env.js#L41) | `15000` | Execution timeout for database queries. |
| `SQL_MAX_LENGTH` | [sql.complexity.js:14](file:///C:/cognicore/CogniCore/server/src/structured/sql.complexity.js#L14) | `4000` | Character limit for generated SQL queries. |
| `SQL_MAX_JOINS` | [sql.complexity.js:15](file:///C:/cognicore/CogniCore/server/src/structured/sql.complexity.js#L15) | `6` | Maximum allowed table joins before complexity rejection. |
| `SQL_MAX_SUBQUERY_DEPTH` | [sql.complexity.js:16](file:///C:/cognicore/CogniCore/server/src/structured/sql.complexity.js#L16) | `4` | Maximum nested subquery depth. |
| `SQL_MAX_ESTIMATED_ROWS` | [sql.complexity.js:17](file:///C:/cognicore/CogniCore/server/src/structured/sql.complexity.js#L17) | `5e9` | Fan-out limit for Cartesian products before rejection. |
| `CHAT_RATE_LIMIT_PER_MIN`| [rate.limit.js:7](file:///C:/cognicore/CogniCore/server/src/guardrails/rate.limit.js#L7) | `30` | Maximum chat queries per user/IP per minute. |
| `PII_MASK_ROLES` | [pii.js:8](file:///C:/cognicore/CogniCore/server/src/guardrails/pii.js#L8) | `'viewer,employee'` | Comma-delimited roles whose evidence rows have PII masked. |
| `ACTION_EMAIL_ALLOWED_DOMAINS` | [action.registry.js:51](file:///C:/cognicore/CogniCore/server/src/actions/action.registry.js#L51) | `''` (any allowed) | Comma-separated domain allowlist for email actions. |
| `ACTION_WEBHOOK_ALLOWLIST` | [action.registry.js:73](file:///C:/cognicore/CogniCore/server/src/actions/action.registry.js#L73) | `''` (disabled) | HTTPS domain allowlist for webhook actions. |
| `ACTION_ALLOW_SELF_APPROVAL` | [action.executor.js:64](file:///C:/cognicore/CogniCore/server/src/actions/action.executor.js#L64) | `'false'` | If `'true'`, allows non-admins to approve own action requests. |
| `API_CONNECTOR_MAX_MB` | [api.connector.js:21](file:///C:/cognicore/CogniCore/server/src/ingestion/api.connector.js#L21) | `20` | Maximum response byte limit for REST/GraphQL connector. |
| `API_CONNECTOR_ALLOW_PRIVATE` | [api.connector.js:47](file:///C:/cognicore/CogniCore/server/src/ingestion/api.connector.js#L47) | `'false'` | If `'true'`, disables SSRF check (for testing only). |
| `PYTHON_BIN` | [python.tool.js:20](file:///C:/cognicore/CogniCore/server/src/python/python.tool.js#L20) | `''` (uses python3/python) | Path to python executable. Falls back to JS if unavailable. |

#### Delta vs `.env.example`
- `OLLAMA_TIMEOUT_MS`: `.env.example:10` specifies `60000`, while `config/env.js:27` defaults to `120000`.
- `SQL_MAX_ESTIMATED_ROWS`: Checked in `sql.complexity.js:17` (`5e9`), but omitted from `.env.example`.
- Input guard character limit: Hardcoded to `4000` in `input.guard.js:35`; no env var exists.

---

### S6. Policy & RBAC Programmatic API

#### 1. Create a Column-Denial Policy
- **Programmatic**:
  ```javascript
  const { PolicyStore } = require('../src/security/data.policy');
  const policyId = PolicyStore.add({
    datasetId: 'ds_123',
    role: 'analyst', // 'admin' | 'manager' | 'analyst' | 'employee' | 'viewer' | '*'
    kind: 'deny_column',
    columnName: 'salary',
    tableName: 'employees', // optional
    createdBy: 'usr_admin',
  });
  ```
  *Receipt*: [server/src/security/data.policy.js:42-51](file:///C:/cognicore/CogniCore/server/src/security/data.policy.js#L42-L51).
- **HTTP Endpoint**: `POST /api/policies/:datasetId` ([policies.js:17](file:///C:/cognicore/CogniCore/server/src/api/routes/policies.js#L17)). Requires capability `policy.manage`.

#### 2. Create a Row-Filter Policy (with `{{user.*}}` templates)
- **Programmatic**:
  ```javascript
  const policyId = PolicyStore.add({
    datasetId: 'ds_123',
    role: 'employee',
    kind: 'row_filter',
    tableName: 'employees',
    columnName: 'department',
    op: '=', // '=' | '!=' | 'IN'
    value: '{{user.email}}', // or literal 'Sales'
    createdBy: 'usr_admin',
  });
  ```
  *Receipt*: [server/src/security/data.policy.js:42-51, 61](file:///C:/cognicore/CogniCore/server/src/security/data.policy.js#L42-L51).

#### 3. Assign Role to User
- **Programmatic**:
  ```javascript
  const { AuthRegistry } = require('../src/security/auth.registry');
  const updatedUser = AuthRegistry.updateUserRole(userId, 'manager');
  ```
  *Receipt*: [server/src/security/auth.registry.js:93-97](file:///C:/cognicore/CogniCore/server/src/security/auth.registry.js#L93-L97).
- **HTTP Endpoint**: `PATCH /api/admin/users/:id/role` with `{ role: 'manager' }` ([admin.js:15](file:///C:/cognicore/CogniCore/server/src/api/routes/admin.js#L15)).

#### 4. Grant Dataset Access to Another User
- **Programmatic**:
  ```javascript
  const grantId = AuthRegistry.grantAccess({
    datasetId: 'ds_123',
    userId: 'usr_target',
    permission: 'read', // 'read' | 'manage'
    grantedBy: 'usr_owner',
  });
  ```
  *Receipt*: [server/src/security/auth.registry.js:145-151](file:///C:/cognicore/CogniCore/server/src/security/auth.registry.js#L145-L151).
- **HTTP Endpoint**: `POST /api/datasets/:id/share` with `{ email: 'target@example.com', permission: 'read' }` ([datasets.js:46](file:///C:/cognicore/CogniCore/server/src/api/routes/datasets.js#L46)).

#### 5. Asserting Policy Violation
When an execution violates a policy, `enforcePolicy()` throws `PolicyError`:
```javascript
const { PolicyError } = require('../src/security/data.policy');
try {
  enforcePolicy({ sql, schema, policy, datasetType });
} catch (err) {
  assert.ok(err instanceof PolicyError);
  assert.equal(err.status, 403);
}
```
*Receipt*: [server/src/security/data.policy.js:35-37](file:///C:/cognicore/CogniCore/server/src/security/data.policy.js#L35-L37).

---

### S7. Semantic Model Access

After ingestion, the semantic model is stored directly in SQLite within `cognicore_registry.db`:
- **Table**: `datasets`
- **Columns**: `dataset_id`, `schema_json`, `profile_json`
- **Receipt**: [server/src/ingestion/dataset.registry.js:26-39](file:///C:/cognicore/CogniCore/server/src/ingestion/dataset.registry.js#L26-L39).

#### Offline Test Retrieval (Zero Network / Zero Engine)
```javascript
const Database = require('better-sqlite3');
const db = new Database('./data-test/cognicore_registry.db');
const row = db.prepare('SELECT schema_json, profile_json FROM datasets WHERE dataset_id = ?').get('ds_123');

const schema = JSON.parse(row.schema_json);
const profile = JSON.parse(row.profile_json);
const semantic = profile.semantic;

// Access column roles, categorical values, distributions:
const table = semantic.tables[0];
const column = table.columns[0];
console.log(column.role);         // 'monetary', 'temporal', 'identifier', etc.
console.log(column.values);       // [{ value: "Completed", count: 180 }, ...]
console.log(column.pii);          // 'email' | 'phone' | null
console.log(column.stats);        // { distinct, missing, min, max, avg, distribution }
console.log(profile.relationships);// [{ fromTable, fromColumn, toTable, toColumn }]
```

---

### S8. Dataset Lifecycle for Tests

1. **Dataset ID Format**: `ds_${uuidv4().slice(0, 8)}` (e.g. `ds_a8f9c1e2`) generated in [dataset.registry.js:76](file:///C:/cognicore/CogniCore/server/src/ingestion/dataset.registry.js#L76).
2. **User Bootstrap Rule**: First user created via `POST /api/auth/register` automatically becomes `admin` ([auth.js:35-36](file:///C:/cognicore/CogniCore/server/src/api/routes/auth.js#L35-L36)). Programmatically, call `AuthRegistry.createUser({ email, passwordHash, role: 'admin' })` directly ([auth.registry.js:69](file:///C:/cognicore/CogniCore/server/src/security/auth.registry.js#L69)).
3. **Multi-Dataset (HYBRID) Invocation**: Pass array to `datasetIds`:
   ```javascript
   handleUserQuery({ question, datasetIds: [structDs.dataset_id, docDs.dataset_id], user })
   ```
4. **Wiping Registry State Between Tests**:
   - In test mode (`NODE_ENV=test`), all state lives under `data-test/`.
   - To clean between test processes: Delete `data-test/` directory.
   - *Windows Precaution (GAP-2)*: In a single running Node process, close cached handles or execute table truncations:
     ```javascript
     const db = new Database('./data-test/cognicore_registry.db');
     db.exec('DELETE FROM datasets; DELETE FROM sessions; DELETE FROM conversation_turns;');
     ```

---

### S9. Existing Harness Inventory

1. **Benchmark Suite**: [server/benchmark/suite.js](file:///C:/cognicore/CogniCore/server/benchmark/suite.js)
   - Defines `DOMAINS` across healthcare, hr, finance, retail, and education.
   - 21 pinned natural language questions mapped to SQL truth expressions.
   - Corpora: `INJECTION_CORPUS` (10 items), `SAFE_CORPUS` (4 items), `SQL_ATTACK_CORPUS` (10 items).
2. **Benchmark Runner**: [server/benchmark/run.js](file:///C:/cognicore/CogniCore/server/benchmark/run.js)
   - CLI flags: `--mode=tools` (deterministic tests only, no LLM required) and `--mode=llm` (scores accuracy against local Ollama model).
   - Generates markdown evaluation report `benchmark-report.md`.
3. **Unit & Integration Suites**:
   - 31 test files under `server/tests/` running via `node --test` ([server/package.json:10](file:///C:/cognicore/CogniCore/server/package.json#L10)).
   - Pure JS unit tests pass independently without dependencies.
   - Tests requiring external dependencies (`better-sqlite3`, `axios`, `node-sql-parser`) execute cleanly once `npm install` is executed in `server/`.

---

### S10. Ollama Client Details

**File**: [server/src/llm/ollama.provider.js](file:///C:/cognicore/CogniCore/server/src/llm/ollama.provider.js)

1. **Base URL**: `config.llm.ollama.baseUrl` (`process.env.OLLAMA_BASE_URL || 'http://localhost:11434'`) ([env.js:25](file:///C:/cognicore/CogniCore/server/src/config/env.js#L25)).
2. **Timeout**: `config.llm.ollama.timeoutMs` (`process.env.OLLAMA_TIMEOUT_MS || '120000'`) ([env.js:27](file:///C:/cognicore/CogniCore/server/src/config/env.js#L27)). Passed directly to Axios config ([ollama.provider.js:34](file:///C:/cognicore/CogniCore/server/src/llm/ollama.provider.js#L34)).
3. **Streaming**: Hardcoded `stream: false` in request body ([ollama.provider.js:27](file:///C:/cognicore/CogniCore/server/src/llm/ollama.provider.js#L27)).
4. **keep_alive**: **NOT currently passed** in request payload.
   - *Line to Add (GAP-1)*: Insert into options object at [ollama.provider.js:28](file:///C:/cognicore/CogniCore/server/src/llm/ollama.provider.js#L28):
     ```javascript
     keep_alive: options.keepAlive !== undefined ? options.keepAlive : (process.env.OLLAMA_KEEP_ALIVE || undefined),
     ```
5. **Model Force-Unload**:
   - *Missing Method (GAP-1)*: Ollama unloads a model when `keep_alive: 0` is sent. Add to `OllamaProvider`:
     ```javascript
     async unload() {
       await axios.post(`${this.baseUrl}/api/generate`, { model: this.model, keep_alive: 0 });
     }
     ```

---

### S11. Unit-Testable Pure Functions Inventory

| Module File | Export Name | Signature | Pure / Stateful |
|---|---|---|---|
| `sql.repair.js` | `repairTableNames` | `(sql, schema) => { sql, repaired, corrections }` | **Pure** |
| `sql.repair.js` | `ensureFromClause` | `(sql, schema) => { sql, repaired }` | **Pure** |
| `sql.repair.js` | `fixIntegerDivision` | `(sql) => { sql, repaired }` | **Pure** |
| `sql.analyzer.js` | `repairColumnNames` | `(sql, schema) => { sql, repaired, corrections, unresolved }` | **Pure** |
| `sql.analyzer.js` | `repairMissingGroupBy` | `(sql) => { sql, repaired, groupBy }` | **Pure** |
| `sql.analyzer.js` | `tokenize` | `(sql) => [{ t, v, s, e, depth }]` | **Pure** |
| `sql.values.repair.js` | `repairValueLiterals` | `(sql, semantic) => { sql, repaired, corrections }` | **Pure** |
| `sql.validator.js` | `validateSql` | `(sql, schema, datasetType) => { valid, ast, tablesUsed, complexity }` | **Pure** |
| `sql.complexity.js` | `analyzeComplexity` | `(sql, schema) => { ok, reasons, level, score, joinCount, maxDepth, estimatedRows }` | **Pure** |
| `data.policy.js` | `assertColumnAccess` | `(sql, schema, policy) => void (throws PolicyError)` | **Pure** |
| `data.policy.js` | `applyRowFilters` | `(sql, schema, policy, datasetType) => string (rewritten SQL)` | **Pure** |
| `data.policy.js` | `enforcePolicy` | `({ sql, schema, policy, datasetType }) => string` | **Pure** |
| `answer.grounding.js` | `checkNumericGrounding` | `(answer, evidence, question) => { grounded: bool, ungrounded: string[] }` | **Pure** |
| `answer.grounding.js` | `detectContradiction` | `(answer, evidence) => boolean` | **Pure** |
| `answer.grounding.js` | `buildDeterministicAnswer` | `(evidence) => string` | **Pure** |
| `pii.js` | `maskText` | `(text) => string` | **Pure** |
| `pii.js` | `redactEvidence` | `(evidence, semantic, role) => { evidence, redacted }` | **Pure** |
| `input.guard.js` | `screenQuestion` | `(question) => { blocked: bool, flags: string[], message: string\|null }` | **Pure** |
| `input.guard.js` | `neutralizeInjection` | `(text) => { text: string, removed: number }` | **Pure** |
| `stats.js` | `mean`, `median`, `std`, `iqrBounds`, `pearson`, `linearRegression` | `(arrays...) => number \| object` | **Pure** |
| `anomaly.js` | `detectIqr`, `detectZScore`, `detectMad`, `detectAnomalies`, `isolationForest` | `(values, options) => [{ index, value, score, method }]` | **Pure** (deterministic seeded PRNG) |
| `forecast.js` | `forecast` | `(values, options) => { predictions, method, backtest, ... }` | **Pure** |
| `dates.js` | `parseDateLoose`, `toIsoDate`, `bucketKey` | `(dateStr, ...) => object \| string` | **Pure** |
| `sqlident.js` | `quoteIdent`, `dialectOf`, `isSqliteBacked` | `(name, dialect) => string` | **Pure** |

---

### S12. Error Taxonomy & Failure Attribution

| Error Class / Condition | Originating Source | HTTP Status | Distinction: Declined vs Crashed | Runner Verdict Code |
|---|---|---|---|---|
| `SQLValidationError` | [sql.validator.js:28](file:///C:/cognicore/CogniCore/server/src/structured/sql.validator.js#L28) | Caught in engine → 200 OK with `lowConfidence: true` | **Declined**: Refuses unsafe DDL/DML, comments, or unmapped tables. | `REJECTED_UNSAFE_SQL` |
| `SQLComplexityError` | [sql.complexity.js:20](file:///C:/cognicore/CogniCore/server/src/structured/sql.complexity.js#L20) | Caught in validator → 200 OK with `lowConfidence: true` | **Declined**: Statement exceeded joins, depth, or fan-out limit. | `REJECTED_COMPLEXITY` |
| `PolicyError` | [data.policy.js:35](file:///C:/cognicore/CogniCore/server/src/security/data.policy.js#L35) | Caught in engine → 200 OK with `denied: true` (or 403 on policy routes) | **Declined**: Access to column or row is forbidden by role policy. | `DENIED_POLICY` |
| Input Guardrail Block | [input.guard.js:36](file:///C:/cognicore/CogniCore/server/src/guardrails/input.guard.js#L36) | 200 OK with `routeType: 'BLOCKED'`, `evidence: null` | **Declined**: Prompt injection or oversized input detected. | `BLOCKED_GUARDRAIL` |
| Recovery Exhaustion | [structured.engine.js:108](file:///C:/cognicore/CogniCore/server/src/core/engines/structured.engine.js#L108) | 200 OK with `recoveryLog.length == 2` | **Declined**: Model failed to generate valid SQL after 2 retries. | `RECOVERY_EXHAUSTED` |
| Grounding Replacement | [answer.grounding.js:41](file:///C:/cognicore/CogniCore/server/src/guardrails/answer.grounding.js#L41) | 200 OK with `guardrail.flags: ['ungrounded_numbers_replaced']` | **Recovered**: Fabricated numbers stripped; deterministic answer returned. | `GROUNDING_FALLBACK` |
| `UploadValidationError` | [file.validator.js:10](file:///C:/cognicore/CogniCore/server/src/security/file.validator.js#L10) | 400 Bad Request | **Declined**: File content fails magic bytes or structural check. | `REJECTED_UPLOAD` |
| `LLMConnectionError` | [ollama.provider.js:55](file:///C:/cognicore/CogniCore/server/src/llm/ollama.provider.js#L55) | Caught in engine → 200 OK with low confidence | **Crashed**: Local Ollama server unreachable or timed out. | `INFRA_LLM_FAILURE` |
| Unhandled Exception | Any internal failure | 500 Internal Server Error | **Crashed**: Unexpected code crash. | `ENGINE_CRASH` |

---

## ══════════ GAP LOG ══════════

### GAP-1: Missing Ollama `keep_alive` & Model Unload
- **Description**: `OllamaProvider` does not send `keep_alive` parameter in request payloads and has no method to unload models from memory.
- **Evidence**: Inspected [server/src/llm/ollama.provider.js:20-42](file:///C:/cognicore/CogniCore/server/src/llm/ollama.provider.js#L20-L42).
- **Impact on Suite**: When running multi-model sweeps (T3 runner), loaded models remain resident in VRAM and may cause out-of-memory errors on consumer GPUs.
- **Recommendation**: Add `keep_alive` parameter to the options payload at `ollama.provider.js:28` and expose an `unload()` method sending `{ model, keep_alive: 0 }`.

### GAP-2: In-Memory Database Handle Caching on Windows
- **Description**: `getRegistryDb` caches `better-sqlite3` database connections in an internal `Map` without exposing a close or reset method.
- **Evidence**: Inspected [server/src/config/registry.db.js:9-23](file:///C:/cognicore/CogniCore/server/src/config/registry.db.js#L9-L23).
- **Impact on Suite**: On Windows, test runners attempting to delete the `data-test/` folder between test suites encounter `EBUSY: resource busy or locked`.
- **Recommendation**: Export a `resetRegistryDb()` helper in `registry.db.js` that closes open database connections and clears the cache Map.

### GAP-3: Legacy Fixture Databases Absent
- **Description**: Older documentation referenced databases `ecommerce_test.db`, `college_attendance.db`, `U3_institute.db`, `chinook.db`, and `H3_metropol.db`. None exist in the codebase.
- **Evidence**: Full recursive search across the workspace returned zero matching files.
- **Impact on Suite**: Tests relying on legacy `.db` fixture filenames will fail with file-not-found errors.
- **Recommendation**: The test suite generator must use the 5 CSV files in `sample-data/`, generate `sample-data/retail_multitable.db` via `npm run sample-data`, or construct in-memory SQLite fixtures using `makeTempSqlite()`.

### GAP-4: Traces Omit Engine Sub-Steps for Document, Hybrid & Analysis Routes
- **Description**: Sub-steps (`trace.addAll(routed.steps)`) are only emitted by `structured.engine.js`. `document.engine.js`, `hybrid.engine.js`, and `analysis.engine.js` do not populate `steps`.
- **Evidence**: Inspected [document.engine.js:42](file:///C:/cognicore/CogniCore/server/src/core/engines/document.engine.js#L42), [hybrid.engine.js:63](file:///C:/cognicore/CogniCore/server/src/core/engines/hybrid.engine.js#L63), and [analysis.engine.js:91](file:///C:/cognicore/CogniCore/server/src/core/engines/analysis.engine.js#L91).
- **Impact on Suite**: The Layer-Isolated Runner (T2) cannot attribute stage-by-stage failures for document retrieval or analysis decomposition steps through the trace object alone.
- **Recommendation**: Add a `_steps` accumulator to `document.engine.js`, `hybrid.engine.js`, and `analysis.engine.js` matching `structured.engine.js`.

---

## ══════════ PART 4 — SELF-AUDIT ══════════

- [x] All R1–R9 items have verdict tables with file:line receipts.
- [x] S1 includes the complete minimal bootstrap sequence, ordered, with file:line receipts.
- [x] S2 step-name lists are complete and categorized by engine route.
- [x] S3 field names are copied verbatim from the response-construction code across success, refusal, and error families.
- [x] S4 mock satisfies the documented provider interface (`complete`, `healthCheck`, `name`).
- [x] S5 includes all environment variables and documents the delta against `.env.example`.
- [x] No field name or identifier was paraphrased or re-cased.
- [x] `docs/validation_seams.json` generated and verified with `JSON.parse()`.
- [x] Git status clean except the two documentation files in `docs/`.
