# PART 8 — CONFIGURATION, ENVIRONMENT & CONSTANTS

This chapter provides a complete factual audit of all environment configuration variables, hardcoded architectural constants, and configuration drifts across the CogniCore codebase.

---

## 1. Complete Environment Variables Register

The table below catalogs every environment variable read across the application, with source citations, declared defaults, data types, and presence in `.env.example`.

| Variable Name | Read Location (`file:line`) | Default Value | Data Type | Purpose | Documented in `.env.example` |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `NODE_ENV` | `server/src/config/env.js:10` | `'development'` | string | Execution mode (`development`, `test`, `production`) | Yes |
| `PORT` | `server/src/config/env.js:19` | `4000` | integer | HTTP listen port for Express server | Yes |
| `DATA_DIR` | `server/src/config/env.js:33` | `./data` (or `./data-test`) | string | Directory for materialized databases and registry | Yes |
| `UPLOADS_DIR` | `server/src/config/env.js:34` | `./uploads` (or `./uploads-test`) | string | Directory for raw uploaded files | Yes |
| `REGISTRY_DB_PATH` | `server/src/config/env.js:35` | `./data/cognicore_registry.db` | string | File path to central SQLite registry database | Yes |
| `LLM_PROVIDER` | `server/src/config/env.js:23` | `'ollama'` | string | Default LLM provider (`ollama`, `openai`, `anthropic`) | Yes |
| `OLLAMA_BASE_URL` | `server/src/config/env.js:25` | `'http://localhost:11434'` | string | HTTP endpoint for local Ollama server | Yes |
| `OLLAMA_MODEL` | `server/src/config/env.js:26` | `'qwen2.5:14b'` | string | Default model identifier for Ollama completions | Yes (drifts) |
| `OLLAMA_TIMEOUT_MS`| `server/src/config/env.js:27` | `120000` (120s) | integer | Socket timeout for Ollama HTTP requests | Yes (drifts) |
| `OLLAMA_EMBEDDING_MODEL` | `server/src/config/env.js:28` | `'nomic-embed-text'` | string | Embedding model identifier | Yes |
| `LLM_PROVIDER_<TASK>` | `server/src/llm/model.manager.js:26` | `config.llm.provider` | string | Task provider override (`SQL`, `REASONING`, `REWRITE`, `PLANNER`) | Yes (in comments) |
| `OLLAMA_MODEL_<TASK>` | `server/src/llm/model.manager.js:29` | `config.llm.ollama.model` | string | Task model override (`SQL`, `REASONING`, `REWRITE`, `PLANNER`) | Yes (in comments) |
| `MAX_RESULT_ROWS` | `server/src/config/env.js:40` | `1000` | integer | Hard row cap for SQL query execution | Yes |
| `QUERY_TIMEOUT_MS` | `server/src/config/env.js:41` | `15000` (15s) | integer | Database query execution timeout | Yes |
| `MAX_FILE_SIZE_MB` | `server/src/config/env.js:46` | `100` | integer | Maximum allowed file upload size | Yes |
| `JWT_SECRET` | `server/src/config/env.js:50` | `'CHANGE_ME_dev_only...'` | string | HMAC SHA-256 secret key for signing auth tokens | Yes |
| `JWT_EXPIRY` | `server/src/config/env.js:51` | `'7d'` | string | Auth token lifespan before expiration | Yes |
| `BCRYPT_ROUNDS` | `server/src/config/env.js:52` | `10` | integer | Cost factor for password hashing | Yes |
| `CHUNK_MAX_CHARS` | `server/src/config/env.js:57` | `1200` | integer | Maximum character length of a document chunk | Yes |
| `CHUNK_OVERLAP_CHARS` | `server/src/config/env.js:58` | `150` | integer | Overlapping character boundary between chunks | Yes |
| `RETRIEVAL_TOP_K` | `server/src/config/env.js:59` | `5` | integer | Number of document chunks returned to evidence | Yes |
| `CHAT_RATE_LIMIT_PER_MIN` | `server/src/guardrails/rate.limit.js:7` | `30` | integer | Maximum chat queries per user per minute | Yes |
| `PII_MASK_ROLES` | `server/src/guardrails/pii.js:8` | `'viewer,employee'` | string | Comma-delimited list of roles subject to PII masking | Yes |
| `SQL_MAX_LENGTH` | `server/src/structured/sql.complexity.js:14` | `4000` | integer | Maximum character length of generated SQL query | Yes |
| `SQL_MAX_JOINS` | `server/src/structured/sql.complexity.js:15` | `6` | integer | Maximum allowed join tables per query | Yes |
| `SQL_MAX_SUBQUERY_DEPTH` | `server/src/structured/sql.complexity.js:16` | `4` | integer | Maximum allowed parentheses subquery nesting depth | Yes |
| `SQL_MAX_ESTIMATED_ROWS` | `server/src/structured/sql.complexity.js:17` | `5e9` | float | Ceiling on estimated Cartesian fan-out rows | **No (Missing)** |
| `ACTION_ALLOW_SELF_APPROVAL` | `server/src/actions/action.executor.js:64` | `'false'` | boolean | Allows managers to approve their own actions | Yes |
| `ACTION_EMAIL_ALLOWED_DOMAINS` | `server/src/actions/action.registry.js` | `''` (any domain) | string | Comma-delimited email domain allowlist | Yes |
| `ACTION_WEBHOOK_ALLOWLIST` | `server/src/actions/action.registry.js:73` | `''` (disabled) | string | Comma-delimited approved webhook host allowlist | Yes |
| `API_CONNECTOR_MAX_MB` | `server/src/ingestion/api.connector.js:21` | `20` | integer | Maximum response payload size for REST connector | Yes |
| `API_CONNECTOR_ALLOWED_HOSTS` | `server/src/ingestion/api.connector.js:45` | `''` (any public) | string | Whitelist of hostnames allowed for API ingestion | Yes |
| `API_CONNECTOR_ALLOW_PRIVATE` | `server/src/ingestion/api.connector.js:47` | `'false'` | boolean | Disables private IP SSRF blocking (testing only) | Yes |
| `PYTHON_BIN` | `server/src/python/python.tool.js:12` | `'python3'` or `'python'` | string | Path to Python interpreter executable | Yes |
| `OCR_LANG` | `server/src/documents/ocr.js:15` | `'eng'` | string | Tesseract OCR language parameter | Yes |
| `OPENAI_API_KEY` | `server/src/llm/openai.provider.js:12` | `''` | string | Cloud API key for OpenAI endpoints | Yes |
| `OPENAI_BASE_URL` | `server/src/llm/openai.provider.js:13` | `'https://api.openai.com/v1'` | string | Base URL for OpenAI-compatible endpoints | Yes |
| `OPENAI_MODEL` | `server/src/llm/openai.provider.js:14` | `'gpt-4o-mini'` | string | Default OpenAI completion model | Yes |
| `ANTHROPIC_API_KEY`| `server/src/llm/anthropic.provider.js:8` | `''` | string | Cloud API key for Anthropic Claude | Yes |
| `ANTHROPIC_MODEL` | `server/src/llm/anthropic.provider.js:9` | `'claude-haiku-4-5-20251001'` | string | Default Anthropic completion model | Yes |
| `SMTP_HOST` | `server/src/actions/action.executor.js:33` | `''` | string | Hostname of SMTP relay server | Yes |
| `SMTP_PORT` | `server/src/actions/action.executor.js:34` | `587` | integer | Port of SMTP relay server | Yes |
| `SMTP_SECURE` | `server/src/actions/action.executor.js:35` | `false` | boolean | TLS configuration for SMTP relay | Yes |
| `SMTP_USER` | `server/src/actions/action.executor.js:36` | `''` | string | Authentication username for SMTP relay | Yes |
| `SMTP_PASS` | `server/src/actions/action.executor.js:37` | `''` | string | Authentication password for SMTP relay | Yes |
| `SMTP_FROM` | `server/src/actions/action.executor.js:42` | `'cognicore@localhost'` | string | Default `From:` sender address on outgoing emails | Yes |

---

## 2. Hardcoded Architectural Constants Register

The table below catalogs every hardcoded numeric and architectural threshold embedded in the source code, explaining its rationale and design impact.

| Constant Name / Value | Source (`file:line`) | Semantic Meaning | Architectural Rationale |
| :--- | :--- | :--- | :--- |
| `MAX_RECOVERY_ATTEMPTS = 2` | `server/src/core/engines/structured.engine.js:20` | SQL error recovery attempt limit | Bounds latency and token usage; prevents infinite LLM re-prompt loops. |
| `MAX_SUB_QUESTIONS = 6` | `server/src/core/engines/analysis.engine.js:4` | Analysis question decomposition ceiling | Prevents combinatorial explosion and unbounded SQL fan-out during analysis planning. |
| `MAX_CAT_VALUES = 30` | `server/src/semantic/semantic.builder.js:5` | Categorical distinct values ceiling | Balances prompt token overhead against filter spellings; columns with $>30$ distinct values omit value lists. |
| `maxTables = 12` | `server/src/semantic/semantic.builder.js:98` | Semantic model prompt table ceiling | Prevents huge multi-table schemas from exhausting prompt context tokens. |
| `input_length > 4000` | `server/src/guardrails/input.guard.js:35` | Question character length ceiling | Mitigates denial-of-service and buffer overflow attacks via huge prompts. |
| `sample_rows.slice(0, 20)` | `server/src/evidence/evidence.manager.js:21` | Sample rows embedded in evidence payload | Keeps JSON evidence payloads compact while providing sufficient rows for explanation. |
| `batchSize = 16` | `server/src/documents/embedder.js:8` | Embedding API batch chunk size | Balances memory overhead and HTTP throughput to local Ollama embedding endpoints. |
| `alpha = 0.6` | `server/src/documents/reranker.js:30` | Dense vs lexical reranker score weight | Weights semantic cosine (60%) over lexical BM25 (40%) to optimize recall while retaining exact matches. |
| `k1 = 1.4, b = 0.75` | `server/src/documents/reranker.js:12` | BM25 lexical ranking parameters | Standard information retrieval constants for term saturation ($k_1$) and document length normalization ($b$). |
| `sectionHit = 0.08` | `server/src/documents/reranker.js:40` | Section heading match score boost | Gives priority to chunks whose section title explicitly mentions query keywords. |
| `maxPages = 60` | `server/src/documents/ocr.js:21` | Maximum PDF pages for OCR extraction | Prevents memory starvation and process hanging when large scanned PDFs are uploaded. |
| `maxUncompressed = 200MB` | `server/src/documents/zip.reader.js:7` | Maximum uncompressed ZIP extraction size | Protects file extraction against malicious zip bombs. |
| `TIMEOUT_MS = 15000` | `server/src/ingestion/api.connector.js:22` | External API connector request timeout | Prevents worker threads from hanging on unresponsive external HTTP servers. |
| `windowMs = 60000` | `server/src/guardrails/rate.limit.js:7` | Sliding window rate limit interval (1 min) | Standard window duration for rate calculations. |
| `maxBuckets = 5000` | `server/src/guardrails/rate.limit.js:19` | In-memory rate limiting map size threshold | Triggers garbage collection of expired IP/user buckets to prevent memory leaks. |

---

## 3. Configuration Drift Ledger (`.env.example` vs `env.js`)

A strict comparison between `server/.env.example` and `server/src/config/env.js` reveals the following documented drifts:

1. **Default Model Mismatch (`OLLAMA_MODEL`)**:
   - `server/.env.example:9` documents: `OLLAMA_MODEL=qwen2.5:7b`
   - `server/src/config/env.js:26` hardcodes default: `process.env.OLLAMA_MODEL || 'qwen2.5:14b'`
   - *Impact*: A fresh deployment starting without `.env` runs `14b`, whereas someone copying `.env.example` runs `7b`.
2. **Timeout Default Mismatch (`OLLAMA_TIMEOUT_MS`)**:
   - `server/.env.example:10` documents: `OLLAMA_TIMEOUT_MS=60000` (60s)
   - `server/src/config/env.js:27` hardcodes default: `parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10)` (120s)
   - *Impact*: Deployments without `.env` have double the socket timeout compared to documented example.
3. **Missing Complexity Variable (`SQL_MAX_ESTIMATED_ROWS`)**:
   - Present and actively evaluated in `server/src/structured/sql.complexity.js:17` (`process.env.SQL_MAX_ESTIMATED_ROWS || '5e9'`).
   - Completely omitted from `server/.env.example`.
4. **Document Chunk Overlap Documentation**:
   - `server/.env.example:15` sets `CHUNK_OVERLAP_CHARS=150`.
   - `server/src/documents/chunker.js:9` sets fallback default `chunkOverlapChars = 200` if not passed from config.
