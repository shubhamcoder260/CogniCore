# Codebase Grounding Report v3

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d` ([F-001](11_FACTS_REGISTRY.md#f-001))  
**Facts Registry Reference:** Cites [F-001](11_FACTS_REGISTRY.md#f-001) through [F-047](11_FACTS_REGISTRY.md#f-047)

---

## 1. HTTP API Attack Surface & Route Inventory

CogniCore exposes a set of authenticated REST and streaming routes mounted via Express. Every claim has been verified directly against route registration calls in `server/src/app.js` and route handlers in `server/src/api/routes/`:

### 1.1 Evaluated Route Endpoints

| Endpoint | Method | Required RBAC / Capability | Ingestion / Request Format | Expected Response | Authoritative File & Lines |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/register` | `POST` | Public (Unauthenticated) | JSON `{ email, password, name }` | `201 Created` (`admin` if first user, else `user`, [F-008](11_FACTS_REGISTRY.md#f-008)) | `server/src/api/routes/auth.js:35-37` |
| `/api/admin/users/:id/role`| `PATCH`| `requireRole('admin')` | JSON `{ role }` (must be in [F-007](11_FACTS_REGISTRY.md#f-007)) | `200 OK` `{ user_id, email, role }` | `server/src/api/routes/admin.js:15-19` |
| `/api/upload` | `POST` | `requireCapability('upload')` | Multipart `file` (`.sqlite`, `.csv`, `.xlsx`, `.json`) | `201 Created` `{ dataset }` ([F-014](11_FACTS_REGISTRY.md#f-014), [F-015](11_FACTS_REGISTRY.md#f-015)) | `server/src/api/routes/upload.js:29-54` |
| `/api/datasets/:id/share` | `POST` | `requireDatasetAccess('manage')` | JSON `{ email, permission: 'read'\|'manage' }` | `200 OK` `{ success: true }` ([F-013](11_FACTS_REGISTRY.md#f-013)) | `server/src/api/routes/datasets.js:70-85` |
| `/api/chat` | `POST` | `requireCapability('query')` | JSON `{ question, datasetId, sessionId? }` | `200 OK` `{ answer, evidence, generatedSql, execResult }` ([F-011](11_FACTS_REGISTRY.md#f-011)) | `server/src/api/routes/chat.js:12-58` |
| `/api/tools/export` | `POST` | `requireCapability('export')` | JSON `{ sql, format: 'csv'\|'xlsx' }` | `200 OK` Binary stream (`text/csv`) ([F-029](11_FACTS_REGISTRY.md#f-029)) | `server/src/api/routes/tools.js:38-60` |
| `/api/tools/chart` | `POST` | `requireCapability('chart')` | JSON `{ sql, chartType, xField, yFields }` | `200 OK` `{ chart: {...}, rowCount }` ([F-029](11_FACTS_REGISTRY.md#f-029)) | `server/src/api/routes/tools.js:21-27` |
| `/api/tools/report` | `POST` | `requireCapability('export')` | JSON `{ sql, question, answer, title }` | `200 OK` Binary stream (`application/pdf`) ([F-029](11_FACTS_REGISTRY.md#f-029)) | `server/src/api/routes/tools.js:63-83` |
| `/api/schema/:id` | `GET` | `requireDatasetAccess('read')` | URL parameter | `200 OK` Full semantic profile unmasked ([F-032](11_FACTS_REGISTRY.md#f-032)) | `server/src/api/routes/schema.js:10-27` |
| `/api/traces/:id` | `GET` | `requireAuth` | URL parameter | `200 OK` `{ trace_id, steps: [...] }` ([F-031](11_FACTS_REGISTRY.md#f-031)) | `server/src/api/routes/traces.js:16-20` |
| `/api/admin/audit` | `GET` | `requireRole('admin')` | Query `?userId=&limit=100` | `200 OK` `{ entries: [...] }` ([F-030](11_FACTS_REGISTRY.md#f-030)) | `server/src/api/routes/admin.js:29-37` |

---

## 2. Pipeline Execution Sequence

Natural language queries to `POST /api/chat` pass sequentially through 11 stages:

```
[Client Question]
       |
       v
1. Authentication & RBAC Gate (requireAuth, requireCapability('query'))
       |
       v
2. Dataset Authorization Gate (canRead(req.user, dataset))
       |
       v
3. Natural Language Input Screening (InputGuard.screenQuestion)
       |
       v
4. Conversational History Resolution (followup.resolver.js)
       |
       v
5. Semantic Profile & Prompt Assembly (sql.prompt.builder.js)
       |
       v
6. LLM SQL Generation (sql.generator.js)
       |
       v
7. AST Lexical & Complexity Validation (validateSql / analyzeComplexity)
       |
       v
8. SQL Semantic Preparation & Integer Division (prepareSql)
       |
       v
9. Data Access Policy & Row Filter Rewriting (enforcePolicy)
       |
       v
10. Isolated Driver Query Execution (executeValidatedQuery -> sqlite.worker.js)
       |
       v
11. Egress Sanitization & PII Scrubbing (sanitizeEgress / maskText)
       |
       v
[HTTP JSON Response]
```

### Stage Source Trace
1. **Stage 1 & 2 (Gateway)**: `server/src/api/routes/chat.js:12, 29` ([F-011](11_FACTS_REGISTRY.md#f-011), [F-012](11_FACTS_REGISTRY.md#f-012)).
2. **Stage 3 (Input Guard)**: `server/src/security/input.guard.js:37-45` ([F-034](11_FACTS_REGISTRY.md#f-034)).
3. **Stage 4 (Followup)**: `server/src/core/followup.resolver.js:20-60`.
4. **Stage 5 (Prompt Builder)**: `server/src/structured/sql.prompt.builder.js:10-50`.
5. **Stage 6 (Generator)**: `server/src/structured/sql.generator.js:45-120` ([F-037](11_FACTS_REGISTRY.md#f-037)).
6. **Stage 7 (Validator)**: `server/src/structured/sql.validator.js:144-340` ([F-023](11_FACTS_REGISTRY.md#f-023), [F-024](11_FACTS_REGISTRY.md#f-024)).
7. **Stage 8 (Preparation)**: `server/src/core/engines/structured.engine.js:201-229` ([F-027](11_FACTS_REGISTRY.md#f-027)).
8. **Stage 9 (Policy Engine)**: `server/src/security/data.policy.js:373-420` ([F-026](11_FACTS_REGISTRY.md#f-026)).
9. **Stage 10 (Executor)**: `server/src/structured/sql.executor.js:75-140` ([F-025](11_FACTS_REGISTRY.md#f-025), [F-044](11_FACTS_REGISTRY.md#f-044)).
10. **Stage 11 (Egress & PII)**: `server/src/security/egress.guard.js:15-60`, `server/src/guardrails/pii.js:8-88` ([F-033](11_FACTS_REGISTRY.md#f-033)).

---

## 3. Standalone Component Signatures (No-LLM Isolation)

Standalone evaluation harnesses invoke core security modules directly without spinning up HTTP servers or running LLM inference:

### 3.1 `validateSql`
- **Location**: `server/src/structured/sql.validator.js:144` ([F-023](11_FACTS_REGISTRY.md#f-023))
- **Signature**: `validateSql(sql, schema, datasetType = 'sqlite')`
- **Prerequisites**: `schema` must be an object with a `tables` array: `{ tables: [{ name, columns }] }`.

### 3.2 `enforcePolicy`
- **Location**: `server/src/security/data.policy.js:373` ([F-026](11_FACTS_REGISTRY.md#f-026))
- **Signature**: `enforcePolicy({ sql, schema, policy, datasetType = 'sqlite' })`
- **Prerequisites**: Single options object. `policy` contains `{ rules, role, user }`.

### 3.3 `executeValidatedQuery`
- **Location**: `server/src/structured/sql.executor.js:75` ([F-025](11_FACTS_REGISTRY.md#f-025))
- **Signature**: `executeValidatedQuery(adapter, sql, { maxRows = 1000, timeoutMs = 15000 } = {})`
- **Prerequisites**: First argument must be an initialized database adapter instance.

### 3.4 `prepareSql`
- **Location**: `server/src/core/engines/structured.engine.js:201` ([F-027](11_FACTS_REGISTRY.md#f-027))
- **Signature**: `prepareSql(rawSql, { schema, semantic, datasetType } = {})`
- **Note**: Defined exclusively in `structured.engine.js`; absent in direct tool execution routes ([F-028](11_FACTS_REGISTRY.md#f-028)).

---

## 4. Policy Engine Mechanics & Data Storage

- **Storage**: In-memory registry loaded from `PolicyStore` ([F-016](11_FACTS_REGISTRY.md#f-016)).
- **Permitted Kinds**: Strictly `deny_column` and `row_filter` ([F-017](11_FACTS_REGISTRY.md#f-017)). No `deny_table` exists.
- **Permitted Operators**: Strictly `=`, `!=`, `IN` ([F-018](11_FACTS_REGISTRY.md#f-018)).
- **User Attributes**: Substituted via `{{user.<field>}}` with `user[field]` ([F-019](11_FACTS_REGISTRY.md#f-019)).
- **Admin Bypass**: Evaluated at `data.policy.js:59`; users with role `'admin'` bypass all policies ([F-020](11_FACTS_REGISTRY.md#f-020)).
- **`COUNT(*)` Early Return**: `data.policy.js:157-162` skips column access checks for wildcard aggregates ([F-021](11_FACTS_REGISTRY.md#f-021)).
- **Shadowing Scope**: `data.policy.js:327-347` rewrites only explicitly referenced AST table nodes matching policy filters ([F-022](11_FACTS_REGISTRY.md#f-022)).

---

## 5. Comprehensive Leak Surface Inventory (11 Monitored Surfaces)

| Leak Surface ID | Surface Name | Emitting Channel / Route | Sanitization Mechanism | Exposure Risk & Vulnerability | File & Line Reference |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **S-01** | **Answer Prose** | `POST /api/chat` (`answer`) | `maskText()` applied for low-privilege roles ([F-033](11_FACTS_REGISTRY.md#f-033)) | Leaks unmasked sensitive text for `analyst`/`user` roles | `server/src/core/engines/structured.engine.js:118` |
| **S-02** | **Evidence Sample Rows** | `POST /api/chat` (`evidence.sample_rows`) | `redactEvidence()` masks semantic PII | Exposes raw unflagged column values if policy rewriter bypassed | `server/src/core/engines/structured.engine.js:115` |
| **S-03** | **Execution Result Rows** | `POST /api/chat` (`execResult`) | `sanitizeEgress()` filters denied columns | Admins bypass egress check; column alias mismatches leak cells | `server/src/security/egress.guard.js:20-45` |
| **S-04** | **Generated SQL String** | `POST /api/chat` (`generatedSql`) | None (raw SQL returned directly) | Leaks confidential literal values embedded in `WHERE` clauses | `server/src/api/routes/chat.js:57` |
| **S-05** | **Chart Specifications** | `POST /api/tools/chart` | `resolveValidatedResult` runs `sanitizeEgress` | Plotted data series expose numeric values from denied columns | `server/src/api/routes/tools.js:21-27` |
| **S-06** | **File Exports (CSV/XLSX)** | `POST /api/tools/export` | `resolveValidatedResult` runs `sanitizeEgress` | Multi-table joins without explicit alias checks leak rows | `server/src/api/routes/tools.js:38-60` |
| **S-07** | **PDF Reports** | `POST /api/tools/report` | Rendered from sanitized result set | Un-sanitized headers or table cells leak into PDF output | `server/src/api/routes/tools.js:63-83` |
| **S-08** | **Observability Traces** | `GET /api/traces/:id` | None (stores raw SQL steps) | Traces expose verbatim executed SQL and internal timings | `server/src/api/routes/traces.js:16` |
| **S-09** | **Administrative Audit Log**| `GET /api/admin/audit` | Truncated details JSON | Stores query strings and parameters in plaintext in registry | `server/src/api/routes/admin.js:29` |
| **S-10** | **HTTP Error Payloads** | HTTP 400 / 500 JSON bodies | Standard `errorHandler` | Leaks internal database table names or SQLite syntax errors | `server/src/api/middleware/errorHandler.js:10-25` |
| **S-11** | **Server Process Logs** | Winston stdout stream | None | Console logs print raw AST tokens, schemas, and failed payloads | `server/src/utils/logger.js:1-40` |

---

## 6. LLM Settings & Hyperparameters

| Parameter | Configuration Env Var | Code Default Value | Configurable vs Hardcoded | Invocation Source (`file:line`) |
| :--- | :--- | :--- | :--- | :--- |
| **Provider** | `LLM_PROVIDER` | `'ollama'` | Configurable via env | `server/src/config/env.js:23` |
| **Base URL** | `OLLAMA_BASE_URL` | `'http://localhost:11434'` | Configurable via env | `server/src/config/env.js:25` |
| **Default Model** | `OLLAMA_MODEL` | `'qwen2.5:14b'` (comparison default) | Configurable via env ([F-035](11_FACTS_REGISTRY.md#f-035)) | `server/src/config/env.js:26` |
| **SQL Model** | `OLLAMA_MODEL_SQL` | `config.llm.ollama.model` | Configurable via env ([F-036](11_FACTS_REGISTRY.md#f-036)) | `server/src/llm/model.manager.js:29` |
| **Reasoning Model**| `OLLAMA_MODEL_REASONING` | `config.llm.ollama.model` | Configurable via env ([F-036](11_FACTS_REGISTRY.md#f-036)) | `server/src/llm/model.manager.js:29` |
| **Rewrite Model** | `OLLAMA_MODEL_REWRITE` | `config.llm.ollama.model` | Configurable via env ([F-036](11_FACTS_REGISTRY.md#f-036)) | `server/src/llm/model.manager.js:29` |
| **Planner Model** | `OLLAMA_MODEL_PLANNER` | `config.llm.ollama.model` | Configurable via env ([F-036](11_FACTS_REGISTRY.md#f-036)) | `server/src/llm/model.manager.js:29` |
| **Temperature (SQL)**| None | `0.1` (`0.2` on recovery retry) | Hardcoded ([F-037](11_FACTS_REGISTRY.md#f-037)) | `server/src/structured/sql.generator.js:119` |
| **Temperature (Rewrite)**| None | `0` | Hardcoded ([F-037](11_FACTS_REGISTRY.md#f-037)) | `server/src/core/followup.resolver.js:82` |
| **Temperature (Plan)**| None | `0.2` | Hardcoded ([F-037](11_FACTS_REGISTRY.md#f-037)) | `server/src/core/engines/analysis.engine.js:36` |
| **Temperature (Answer)**| None | `0.3` | Hardcoded ([F-037](11_FACTS_REGISTRY.md#f-037)) | `server/src/response/answer.composer.js:73` |
| **Max Tokens (SQL)**| None | `500` | Hardcoded | `server/src/structured/sql.generator.js:119` |
| **Max Tokens (Rewrite)**| None | `120` | Hardcoded | `server/src/core/followup.resolver.js:82` |
| **Context Window (`num_ctx`)**| None | *Ollama Default* (omitted from body) | Configurable via Modelfile (Decision D-07) | `server/src/llm/ollama.provider.js:29-37` |

---

## 7. Multi-Query Execution Analysis (P2SQL Attack RI.2 Feasibility)

In the P2SQL attack taxonomy, **RI.2** models indirect prompt injection triggering secondary query execution. CogniCore possesses two distinct architectural multi-query execution pathways:

1. **Multi-Step Analytic Planning (`analysis.engine.js:33-65`, [F-046](11_FACTS_REGISTRY.md#f-046))**:
   - When `analysisMode === true` or when classified as `ANALYSIS`, the planner prompts the LLM to generate 2 to 6 sub-questions (`MAX_SUB_QUESTIONS = 6`).
   - The engine iterates through the planned sub-questions, calling `runStructuredQuery` sequentially for each sub-question.
   - A poisoned data row returned by an initial query can influence subsequent sub-question planning, causing the engine to execute secondary unauthorized SQL queries.
2. **Empty Result Diagnosis (`structured.engine.js:106-114`, [F-047](11_FACTS_REGISTRY.md#f-047))**:
   - If the primary generated query returns zero rows (`rows.length === 0`), the engine triggers `diagnoseEmptyResult` (`server/src/structured/result.checks.js:88-100`).
   - This fires multiple diagnostic queries against `adapter.executeQuery` to probe column value distributions and null ratios.
3. **Conversational Multi-Turn Followup (`core.engine.js:77-84`)**:
   - The executed SQL and evidence from previous turns are persisted in session state and fed into subsequent generation prompts, providing an execution path for multi-turn indirect injection.

**Feasibility Verdict**: P2SQL Attack RI.2 applies directly to CogniCore's multi-step analysis and empty-result diagnosis pathways (Decision D-12).
