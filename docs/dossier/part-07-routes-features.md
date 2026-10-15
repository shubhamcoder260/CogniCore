# PART 7 — OTHER ROUTE TYPES & FEATURES

This chapter documents the secondary query routes (`DOCUMENT`, `HYBRID`, `ANALYSIS`), the deterministic agent analytics tools, and provides a complete register of every HTTP API endpoint exposed by CogniCore.

---

## 1. The DOCUMENT Route

The `DOCUMENT` route executes grounded natural-language retrieval over unstructured files (PDF, DOCX, TXT, PPTX) without passing through the SQL pipeline (`server/src/core/engines/document.engine.js:14-43`).

### Retrieval & Hybrid Reranking Pipeline
Retrieval combines dense vector embeddings with BM25-style lexical matching and section structure boosting (`server/src/documents/retriever.js:12-21` and `server/src/documents/reranker.js:30-46`):

1. **Dense Retrieval Stage**:
   - Computes query vector via `EmbeddingProvider.embed([question])`.
   - Performs JavaScript in-memory brute-force cosine similarity search across all chunks in `document_chunks` for the dataset (`server/src/documents/vector.store.js:73-84`).
   - Retrieves top $N = \max(\text{topK} \times 3, 12)$ candidate chunks (default 15 candidates).
2. **Deterministic Hybrid Rescoring Formula**:
   Candidate chunks are rescored using a linear combination of dense cosine similarity, BM25 lexical token overlap, and structural section title matching:
   $$\text{Score} = \min\left(1.0, \, \alpha \cdot \text{Dense} + (1 - \alpha) \cdot \text{Lexical} + \text{SectionHit}\right)$$
   Where:
   - $\alpha = 0.6$ (dense weighting, `server/src/documents/reranker.js:30`).
   - $\text{Dense} = \max(0, \min(1, \text{cosineSimilarity}))$.
   - $\text{Lexical} = \text{lexicalScore}(query, text)$ with BM25 parameters $k_1 = 1.4, b = 0.75$ (`server/src/documents/reranker.js:12-27`).
   - $\text{SectionHit} = 0.08$ if stemmed query terms match the chunk's detected section header (`line 40`).
3. **Indirect Prompt Injection Neutralization**:
   Retrieved text is passed through `neutralizeInjection(text)` (`server/src/guardrails/input.guard.js:48`), replacing instruction-like lines with `'[removed: instruction-like text in source]'` before passing chunks to evidence assembly (`server/src/documents/retriever.js:18`).

### OCR Pipeline (`server/src/documents/ocr.js:1-36`)
CogniCore does not bundle binary OCR engines. Scanned documents are detected when PDF parsing yields zero selectable text.
- If native binaries `pdftoppm` (Poppler) and `tesseract` are available on the system PATH (`has('tesseract')`, `has('pdftoppm')`, `line 11`):
  - Renders pages to temporary PNGs at 200 DPI (`pdftoppm -r 200 -png`, line 28).
  - Invokes Tesseract to extract page text (`tesseract <img.png> stdout -l eng`, line 15).
- If binaries are missing, throws a clear user-facing guidance error (`line 24`).

### ZIP Reader (`server/src/documents/zip.reader.js:1-45`)
A zero-dependency ZIP reader that parses central directories to extract stored and deflated entries.
- Caps uncompressed data to 200 MB (`maxUncompressed = 200 * 1024 * 1024`, line 7) to provide deterministic protection against zip bombs.
- Used to extract slides from `.pptx` presentations and validate internal directory headers (`xl/`, `word/`, `ppt/`) of Office uploads.

---

## 2. The HYBRID Route

The `HYBRID` route handles cross-modal queries spanning both structured databases and unstructured documents (`server/src/core/engines/hybrid.engine.js:32-74`).
*Example Query*: *"According to the attendance policy document, which students are below the minimum threshold in the database?"*

### Execution Mechanics
1. **Parallel Dispatch**: Executes `runStructuredQuery` for structured datasets and `runDocumentQuery` for document datasets concurrently via `Promise.all` (`lines 36-39`).
2. **Independent Failure Handling**:
   - If both succeed: results are merged into `buildHybridEvidence(evidenceParts, [])` (`server/src/evidence/evidence.manager.js:44`).
   - If one source fails (e.g. SQL validator rejects candidate query, or document search finds 0 matching chunks): the working source's evidence is preserved in `evidenceParts`, while the failed source is logged in the `incomplete` array with the verbatim failure reason (`lines 44-53`).
3. **Explicit Partial Failure Disclosure (Rule #26)**:
   Incomplete sources are explicitly surfaced in the synthesis prompt (`server/src/response/answer.composer.js:28-30`):
   ```
   NOTE: The following source(s) could NOT be queried and are NOT included in the evidence below - explicitly mention in your answer that this part of the question could not be fully answered, rather than staying silent about it:
   - Database "db_attendance": Query failed safety validation
   ```
   This prevents the model from silently hallucinating missing constraints.

---

## 3. The ANALYSIS Route

The `ANALYSIS` route handles complex, open-ended business inquiries requiring multiple independent queries (`server/src/core/engines/analysis.engine.js:31-100`).

### Multi-Step Plan-Execute-Synthesize Loop
1. **Step 1 (Plan)**: Calls LLM (`planner` task) with database schema (`server/src/core/engines/analysis.engine.js:35-37`) to decompose the prompt into 2 to 6 specific sub-questions:
   - Hard cap: `MAX_SUB_QUESTIONS = 6` (`line 4`).
   - Parsed defensively via `parsePlan()` (`line 122`), falling back to line splitting if JSON is malformed.
2. **Step 2 (Execute)**: Iterates through each sub-question sequentially, executing each through the standard `runStructuredQuery()` pipeline (`lines 49-61`).
   - **Zero Safety Leakage**: Every sub-query goes through the full deterministic pipeline (`prepareSql` $\rightarrow$ `validateSql` $\rightarrow$ `enforcePolicy` $\rightarrow$ `executeValidatedQuery`). Sub-queries are subject to the same AST gates and read-only protections as standard queries.
3. **Step 3 (Synthesize)**: Feeds the collected evidence from all successful sub-queries to the LLM (`reasoning` task) using `buildSynthesisPrompt()` (`lines 75-77`) to compose the final report.

### Failure Modes
- If plan decomposition produces 0 valid sub-questions: terminates immediately with low confidence (`lines 39-46`).
- If all sub-questions fail execution: returns low-confidence failure detailing sub-query error messages (`lines 64-72`).

---

## 4. Deterministic Agent Analytics Tools

When a single structured dataset is queried, `tryAgent()` in `server/src/agent/agent.js:16` attempts to route analytical queries to purpose-built deterministic tools in `server/src/agent/analytic.tools.js:348`. If a tool cannot confidently resolve column mappings, it returns `null`, and the query falls back to standard LLM SQL generation.

All ten tools perform computations using deterministic JavaScript math or direct SQL aggregate queries. **No LLM is ever used to calculate statistics or numbers.**

| Tool Name | Trigger Patterns | Deterministic Computation Mechanism | Underlying Math / Library |
| :--- | :--- | :--- | :--- |
| **`describe`** | `describe`, `summary statistics`, `distribution of`, `variance` | Computes mean, median, standard deviation, IQR, skewness, quartiles, and min/max | `server/src/analytics/stats.js` & `descriptive.js` |
| **`scenario`** | `what if`, `suppose`, `assuming` with percentage (e.g. `increase by 15%`) | Parses factor and target measure; fetches baseline aggregate; calculates simulated delta with boundary clamping | `server/src/analytics/scenario.js:applyScenario` |
| **`trend`** | `trend`, `increasing or decreasing`, `grown`, `over time` | Buckets dates into intervals; performs ordinary least squares linear regression; computes slope and direction | `server/src/analytics/trend.js:analyzeTrend` |
| **`forecast`** | `forecast`, `predict`, `projection`, `next 3 months` | Generates chronological series; computes Holt-Winters / exponential smoothing trend extrapolation | `server/src/analytics/forecast.js:forecast` |
| **`anomaly`** | `anomaly`, `outliers`, `suspicious`, `unusual` | Runs z-score variance ($> 3\sigma$), interquartile range thresholds, and Isolation Forest | `server/src/analytics/anomaly.js:detectAnomalies` |
| **`correlation`**| `correlation`, `relationship between`, `associated with` | Executes dual-measure SQL query; calculates Pearson correlation coefficient ($r$) | `server/src/analytics/stats.js:pearson` |
| **`compare`** | `compare`, `versus`, `vs`, `outperform` | Slices measures by categorical dimension; computes relative percentage difference and group variances | `server/src/analytics/compare.js:compareTwo` |
| **`quality`** | `data quality`, `dirty data`, `missing values`, `duplicate rows` | Runs column profiling: counts nulls, duplicate PKs, invalid date formats, outlier ranges | `server/src/quality/data.quality.js:analyzeDataQuality` |
| **`kpi`** | `kpi`, `key metrics`, `headline numbers`, `dashboard metrics` | Identifies primary measures; computes totals, averages, and historical growth rates | `server/src/analytics/kpi.js:generateKpis` |
| **`explore`** | `what can i ask`, `explore this dataset`, `suggest questions` | Analyzes schema roles and values; outputs candidate natural language question templates | `server/src/analytics/exploration.js:exploreQuestions` |

---

## 5. Complete API Endpoints Register

All forty-two (42) HTTP routes registered across the fifteen (15) routing modules in `server/src/api/routes/` are cataloged below.

| HTTP Method | URL Path | Handler Module | Required Auth & Capability | Request Body / Query Params | Response Shape |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **POST** | `/api/auth/register` | `auth.js:21` | Public (first user is `admin`) | `{ email, password, name? }` | `{ user: { user_id, email, role, name }, token }` |
| **POST** | `/api/auth/login` | `auth.js:48` | Public | `{ email, password }` | `{ user: { user_id, email, role, name }, token }` |
| **GET** | `/api/auth/me` | `auth.js:70` | Bearer Token (`requireAuth`) | None | `{ user: { user_id, email, role, name, session_id } }` |
| **GET** | `/api/auth/sessions`| `auth.js:77` | Bearer Token (`requireAuth`) | None | `{ sessions: Array<{ session_id, created_at, active }> }` |
| **DELETE**| `/api/auth/sessions/:id` | `auth.js:82` | Bearer Token (`requireAuth`) | None | `{ ok: true }` |
| **POST** | `/api/auth/logout` | `auth.js:90` | Bearer Token (`requireAuth`) | None | `{ ok: true }` |
| **POST** | `/api/auth/logout-all` | `auth.js:97` | Bearer Token (`requireAuth`) | None | `{ ok: true }` |
| **POST** | `/api/chat` | `chat.js:12` | `requireAuth` + `query` cap | `{ question, datasetId?, datasetIds?, sessionId?, analysisMode? }` | Canonical chat response object |
| **POST** | `/api/upload` | `upload.js:31` | `requireAuth` + `upload` cap | Multipart form: `file` | `{ dataset: { dataset_id, name, type, status, ... } }` |
| **POST** | `/api/connections`| `connections.js:11` | `requireAuth` + `connect` cap| `{ type, name, host, port, database, user, password }` | `{ dataset: { dataset_id, name, type, status } }` |
| **POST** | `/api/connections/api`| `connections.js:37`| `requireAuth` + `connect` cap| `{ name, url, headers?, recordPath? }` | `{ dataset: { dataset_id, name, type, status } }` |
| **GET** | `/api/datasets` | `datasets.js:19` | Bearer Token (`requireAuth`) | Query: `?status=ready` | `{ datasets: Dataset[] }` |
| **GET** | `/api/datasets/:id` | `datasets.js:35` | `requireDatasetAccess('read')` | None | `{ dataset: Dataset }` |
| **GET** | `/api/datasets/:id/preview` | `datasets.js:40` | `requireDatasetAccess('read')` | Query: `?table=name&limit=10` | `{ columns: string[], rows: object[] }` |
| **POST** | `/api/datasets/:id/share` | `datasets.js:62` | `requireDatasetAccess('manage')` | `{ userId, permission: 'read'\|'manage' }` | `{ ok: true }` |
| **DELETE**| `/api/datasets/:id/share/:userId` | `datasets.js:80` | `requireDatasetAccess('manage')` | None | `{ ok: true }` |
| **GET** | `/api/datasets/:id/shares` | `datasets.js:90` | `requireDatasetAccess('manage')` | None | `{ shares: Array<{ user_id, permission, granted_by }> }` |
| **DELETE**| `/api/datasets/:id` | `datasets.js:96` | `requireDatasetAccess('manage')` | None | `{ ok: true }` |
| **GET** | `/api/schema/:datasetId` | `schema.js:10` | `requireDatasetAccess('read')` | None | `{ schema: { tables: Table[] } }` |
| **GET** | `/api/health` | `health.js:7` | Public | None | `{ status: 'ok', checks: object }` |
| **GET** | `/api/traces` | `traces.js:9` | Bearer Token (`requireAuth`) | Query: `?limit=50` | `{ traces: TraceSummary[] }` |
| **GET** | `/api/traces/:id` | `traces.js:16` | Bearer Token (`requireAuth`) | None | `{ trace: FullTrace }` |
| **GET** | `/api/preferences` | `preferences.js:7`| Bearer Token (`requireAuth`) | None | `{ preferences: object, options: object }` |
| **PUT** | `/api/preferences` | `preferences.js:8`| Bearer Token (`requireAuth`) | `{ output_format?, detail_level?, default_chart? }` | `{ preferences: object }` |
| **GET** | `/api/knowledge` | `knowledge.js:12` | Bearer Token (`requireAuth`) | Query: `?datasetId=xyz` | `{ knowledge: OrgKnowledgeItem[] }` |
| **POST** | `/api/knowledge` | `knowledge.js:24` | `knowledge.manage` cap | `{ term, definition, scope?, kind? }` | `{ id: string }` |
| **DELETE**| `/api/knowledge/:id` | `knowledge.js:36` | `knowledge.manage` cap | None | `{ ok: true }` |
| **GET** | `/api/policies/:datasetId` | `policies.js:12` | `policy.manage` + `manage` access | None | `{ policies: DataPolicy[] }` |
| **POST** | `/api/policies/:datasetId` | `policies.js:17` | `policy.manage` + `manage` access | `{ role, kind, tableName?, columnName, op?, value? }` | `{ id: string }` |
| **DELETE**| `/api/policies/:datasetId/:policyId` | `policies.js:33` | `policy.manage` + `manage` access | None | `{ ok: true }` |
| **GET** | `/api/actions/types` | `actions.js:11` | Bearer Token (`requireAuth`) | None | `{ types: Array<{ type, label }> }` |
| **GET** | `/api/actions` | `actions.js:14` | Bearer Token (`requireAuth`) | Query: `?status=pending` | `{ actions: ActionRequest[] }` |
| **POST** | `/api/actions` | `actions.js:20` | `action.propose` cap | `{ type, params }` | `{ action: ActionRequest }` |
| **POST** | `/api/actions/:id/approve` | `actions.js:28` | `action.approve` cap | `{ note? }` | `{ action: ActionRequest }` |
| **POST** | `/api/actions/:id/reject` | `actions.js:33` | `action.approve` cap | `{ note? }` | `{ action: ActionRequest }` |
| **GET** | `/api/admin/users` | `admin.js:10` | `requireRole('admin')` | None | `{ users: User[] }` |
| **PATCH**| `/api/admin/users/:id/role` | `admin.js:15` | `requireRole('admin')` | `{ role }` | `{ user: User }` |
| **GET** | `/api/admin/audit` | `admin.js:29` | `requireRole('admin')` | Query: `?limit=100` | `{ audit: AuditLogEntry[] }` |
| **GET** | `/api/admin/models`| `admin.js:40` | `requireRole('admin')` | None | `{ routing: ModelRoutingRow[] }` |
| **GET** | `/api/analytics/:datasetId/semantic` | `analytics.js:60` | `requireDatasetAccess('read')` | None | `{ semantic: SemanticModel }` |
| **GET** | `/api/analytics/:datasetId/quality` | `analytics.js:66` | `requireDatasetAccess('read')` | None | `{ quality: QualityReport }` |
| **GET** | `/api/analytics/:datasetId/kpis` | `analytics.js:75` | `requireDatasetAccess('read')` | None | `{ kpis: object }` |
| **GET** | `/api/analytics/:datasetId/explore` | `analytics.js:89` | `requireDatasetAccess('read')` | None | `{ questions: string[] }` |
| **GET** | `/api/analytics/:datasetId/report` | `analytics.js:97` | `report` cap + read access | None | `{ report: ManagementReport }` |
| **GET** | `/api/analytics/:datasetId/report/download` | `analytics.js:103`| `report` cap + read access | Query: `?format=pdf\|docx\|xlsx` | Binary file download |
| **POST** | `/api/analytics/:datasetId/chart-svg` | `analytics.js:118`| `chart` cap + read access | `{ type, title, data }` | `{ svg: string }` |
| **POST** | `/api/analytics/:datasetId/export-analysis` | `analytics.js:131`| `export` cap + read access | `{ format: 'csv'\|'xlsx'\|'json', columns, rows }` | Binary file download |
| **POST** | `/api/analytics/:datasetId/python` | `analytics.js:145`| `python` cap + read access | `{ code, tableName? }` | `{ output, figures }` |
| **GET** | `/api/analytics/:datasetId/catalog` | `analytics.js:164`| `requireDatasetAccess('read')` | None | `{ catalog: ColumnCatalogEntry[] }` |
| **PUT** | `/api/analytics/:datasetId/catalog/meaning` | `analytics.js:169`| `knowledge.manage` cap + read | `{ table, column, meaning }` | `{ ok: true }` |
| **DELETE**| `/api/analytics/:datasetId/catalog/meaning` | `analytics.js:178`| `knowledge.manage` cap + read | Query: `?table=t&column=c` | `{ ok: true }` |
| **GET** | `/api/analytics/:datasetId/dashboard` | `analytics.js:185`| `requireDatasetAccess('read')` | None | `{ summary, kpis, quality, questions }` |
