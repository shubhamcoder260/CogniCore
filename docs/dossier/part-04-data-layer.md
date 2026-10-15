# PART 4 — DATA LAYER & STORAGE REALITY

This chapter details the data ingestion mechanics, relational database schemas, semantic model specifications, prompt context token budgets, and vector storage reality of CogniCore.

---

## 1. Ingestion Mechanics

The ingestion subsystem processes heterogeneous data formats (CSV, XLSX, SQLite, PDF, DOCX, TXT) into a unified querying representation. The ingestion pipeline separates structured tabular datasets from unstructured document sources (Rule #16).

```
Uploaded File (HTTP POST /api/upload)
   │
   ├── multer stores file at server/uploads/{uuid}.{ext} (server/src/api/routes/upload.js:18-23)
   ├── Magic bytes / format validation via validateUpload() (server/src/security/file.validator.js:12)
   │
   └── ingestFile() (server/src/ingestion/ingestion.pipeline.js:23)
         │
         ├── detectFileType() (server/src/ingestion/file.detector.js:24)
         │
         ├── IF Document (PDF, DOCX, TXT, PPTX):
         │     └── ingestDocument() (server/src/ingestion/document.pipeline.js:22)
         │           ├── Text extraction: pdf-parse / mammoth / raw text
         │           ├── Structure extraction: splitBySection() (server/src/documents/sections.js)
         │           ├── chunkPages(): 1200 char max, 200 overlap (server/src/documents/chunker.js:9)
         │           ├── embedAndStore(): Ollama / OpenAI embeddings (server/src/documents/embedder.js:8)
         │           └── VectorStore.insertChunks(): document_chunks table (server/src/documents/vector.store.js:44)
         │
         └── IF Tabular (CSV, XLSX, SQLite):
               ├── DatasetRegistry.create(): status = 'processing' (server/src/ingestion/dataset.registry.js:75)
               ├── Adapter instantiation: createAdapter(type) (server/src/ingestion/adapters/index.js)
               │     ├── CSV / XLSX:
               │     │     ├── CSVAdapter.ingest() / ExcelAdapter.ingest()
               │     │     └── loadRowsIntoSqlite() (server/src/ingestion/adapters/tabular.loader.js:45)
               │     │           └── Materializes into standalone SQLite file: server/data/{datasetId}.db
               │     └── SQLite:
               │           └── Operates in-place on uploaded SQLite file (read-only mode)
               ├── readSchema(): tables, columns, PKs, row counts (server/src/schema/schema.reader.js:15)
               ├── analyzeSchema(): structural tags & heuristic FKs (server/src/schema/schema.analyzer.js:9)
               ├── enrichProfile(): builds semantic model & quality report (server/src/ingestion/profile.enricher.js:12)
               └── DatasetRegistry.markReady(): writes schema_json & profile_json (server/src/ingestion/dataset.registry.js:124)
```

### File Landing & Path Lifecycle
1. **Upload Landing**: Files land in `server/uploads/` (configured via `config.paths.uploads`, `server/src/config/env.js:13`) with randomized UUID names: `${uuidv4()}${ext}` (`server/src/api/routes/upload.js:21`).
2. **Tabular Materialization**: CSV and Excel spreadsheets are parsed into in-memory row representations and materialized into isolated SQLite database files located at `server/data/{datasetId}.db` (`server/src/ingestion/adapters/csv.adapter.js:24`). All subsequent queries are delegated to `SQLiteAdapter` targeting this materialized file.
3. **SQLite Ingestion**: Uploaded SQLite files remain at their upload path or configured connection location and are queried directly in read-only mode via `better-sqlite3`.
4. **Document Ingestion**: Documents are chunked into paragraphs, embedded into floating-point vectors, and stored in the central SQLite registry database (`cognicore_registry.db`), without creating a dedicated per-dataset SQLite file.

---

## 2. Registry Database Schema (`cognicore_registry.db`)

The registry database is a single SQLite database located at `server/data/cognicore_registry.db` (configured via `config.paths.registryDb`, `server/src/config/env.js:12`). It operates in Write-Ahead Logging mode (`WAL`, `server/src/config/registry.db.js:17`).

The complete inventory of all 17 tables in `cognicore_registry.db` is cataloged below with verbatim column names, declared types, writers, and readers.

### Table 1: `datasets`
- **Source**: `server/src/ingestion/dataset.registry.js:26-39`.
- **Columns**:
  - `dataset_id TEXT PRIMARY KEY`
  - `name TEXT NOT NULL`
  - `type TEXT NOT NULL` (`sqlite | postgres | mysql | csv | xlsx | json | pdf | docx | txt`)
  - `source TEXT NOT NULL` (`upload | connection`)
  - `location TEXT`
  - `status TEXT NOT NULL DEFAULT 'processing'` (`processing | ready | error`)
  - `schema_json TEXT`
  - `profile_json TEXT`
  - `error_message TEXT`
  - `owner_id TEXT`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- **Writers**: `DatasetRegistry.create` (line 75), `DatasetRegistry.markReady` (line 124), `DatasetRegistry.markError` (line 144), `DatasetRegistry.delete` (line 153).
- **Readers**: `DatasetRegistry.get` (line 89), `DatasetRegistry.list` (line 99), `core.engine.js:61`.

### Table 2: `sessions`
- **Source**: `server/src/ingestion/dataset.registry.js:41-48`.
- **Columns**:
  - `session_id TEXT PRIMARY KEY`
  - `user_id TEXT`
  - `active_dataset_id TEXT`
  - `state_json TEXT`
  - `created_at TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- **Writers**: `session.manager.js:14` (`getOrCreateSession`), `session.manager.js:28` (`setActiveDataset`).
- **Readers**: `session.manager.js:14` (`getOrCreateSession`).

### Table 3: `connection_credentials`
- **Source**: `server/src/ingestion/dataset.registry.js:53-57`.
- **Columns**:
  - `dataset_id TEXT PRIMARY KEY`
  - `credentials_json TEXT NOT NULL`
  - `created_at TEXT NOT NULL`
- **Writers**: `DatasetRegistry.storeCredentials` (line 166).
- **Readers**: `DatasetRegistry.getCredentials` (line 175) via database adapters (`postgres.adapter.js`, `mysql.adapter.js`).

### Table 4: `conversation_turns`
- **Source**: `server/src/ingestion/dataset.registry.js:59-66`.
- **Columns**:
  - `turn_id TEXT PRIMARY KEY`
  - `session_id TEXT NOT NULL`
  - `role TEXT NOT NULL` (`user | assistant`)
  - `content TEXT NOT NULL`
  - `evidence_json TEXT`
  - `created_at TEXT NOT NULL`
- **Writers**: `session.manager.js:33` (`recordTurn`).
- **Readers**: `context.manager.js:14` (`buildConversationContext`).

### Table 5: `session_state`
- **Source**: `server/src/core/session.state.js:8`.
- **Columns**:
  - `session_id TEXT PRIMARY KEY`
  - `state_json TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
- **Writers**: `server/src/core/session.state.js:17` (`saveState`).
- **Readers**: `server/src/core/session.state.js:11` (`getState`).

### Table 6: `document_chunks`
- **Source**: `server/src/documents/vector.store.js:25-39`.
- **Columns**:
  - `chunk_id TEXT PRIMARY KEY`
  - `dataset_id TEXT NOT NULL`
  - `chunk_index INTEGER NOT NULL`
  - `page_number INTEGER`
  - `text TEXT NOT NULL`
  - `embedding_json TEXT NOT NULL`
  - `created_at TEXT NOT NULL`
  - `section TEXT` (added via migration, line 38)
- **Index**: `idx_document_chunks_dataset` on `dataset_id` (`server/src/documents/vector.store.js:34`).
- **Writers**: `VectorStore.insertChunks` (`server/src/documents/vector.store.js:44`), `VectorStore.deleteForDataset` (line 68).
- **Readers**: `VectorStore.search` (line 73), `VectorStore.listChunks` (line 61), `VectorStore.countChunks` (line 57).

### Table 7: `users`
- **Source**: `server/src/security/auth.registry.js:25-32`.
- **Columns**:
  - `user_id TEXT PRIMARY KEY`
  - `email TEXT NOT NULL UNIQUE`
  - `password_hash TEXT NOT NULL`
  - `name TEXT`
  - `role TEXT NOT NULL DEFAULT 'user'` (`admin | manager | analyst | employee | viewer | user`)
  - `created_at TEXT NOT NULL`
- **Writers**: `AuthRegistry.createUser` (`server/src/security/auth.registry.js:69`), `AuthRegistry.updateUser` (line 103), `AuthRegistry.deleteUser` (line 120).
- **Readers**: `AuthRegistry.getUserByEmail` (line 79), `AuthRegistry.getUserById` (line 84), `AuthRegistry.listUsers` (line 89).

### Table 8: `dataset_permissions`
- **Source**: `server/src/security/auth.registry.js:36-43`.
- **Columns**:
  - `dataset_id TEXT NOT NULL`
  - `user_id TEXT NOT NULL`
  - `permission TEXT NOT NULL` (`read | manage`)
  - `granted_by TEXT`
  - `created_at TEXT NOT NULL`
  - `PRIMARY KEY (dataset_id, user_id)`
- **Writers**: `AuthRegistry.grantDataset` (line 130), `AuthRegistry.revokeDataset` (line 136).
- **Readers**: `AuthRegistry.getDatasetPermission` (line 141), `rbac.js:42` (`canAccessDataset`).

### Table 9: `audit_log`
- **Source**: `server/src/security/auth.registry.js:45-58`.
- **Columns**:
  - `id TEXT PRIMARY KEY`
  - `user_id TEXT`
  - `action TEXT NOT NULL`
  - `resource_type TEXT`
  - `resource_id TEXT`
  - `success INTEGER NOT NULL DEFAULT 1`
  - `details_json TEXT`
  - `ip TEXT`
  - `created_at TEXT NOT NULL`
- **Indexes**: `idx_audit_user` on `user_id`, `idx_audit_resource` on `(resource_type, resource_id)`.
- **Writers**: `AuthRegistry.appendAudit` (`server/src/security/auth.registry.js:146`).
- **Readers**: `AuthRegistry.listAudit` (`server/src/security/auth.registry.js:151`).

### Table 10: `auth_sessions`
- **Source**: `server/src/security/auth.registry.js:154-164`.
- **Columns**:
  - `session_id TEXT PRIMARY KEY` (JWT `jti`)
  - `user_id TEXT NOT NULL`
  - `created_at TEXT NOT NULL`
  - `expires_at TEXT`
  - `revoked_at TEXT`
  - `ip TEXT`
  - `user_agent TEXT`
- **Index**: `idx_auth_sessions_user` on `user_id`.
- **Writers**: `AuthRegistry.createSession` (line 167), `AuthRegistry.revokeSession` (line 183).
- **Readers**: `AuthRegistry.isSessionActive` (line 173), `AuthRegistry.listSessions` (line 179).

### Table 11: `data_policies`
- **Source**: `server/src/security/data.policy.js:19-32`.
- **Columns**:
  - `policy_id TEXT PRIMARY KEY`
  - `dataset_id TEXT NOT NULL`
  - `role TEXT NOT NULL` (`admin | manager | analyst | employee | viewer | user | *`)
  - `kind TEXT NOT NULL` (`deny_column | row_filter`)
  - `table_name TEXT`
  - `column_name TEXT NOT NULL`
  - `op TEXT` (`= | != | IN`)
  - `value TEXT` (literal or `{{user.*}}`)
  - `created_by TEXT`
  - `created_at TEXT NOT NULL`
- **Index**: `idx_policy_dataset` on `dataset_id`.
- **Writers**: `PolicyStore.add` (line 42), `PolicyStore.remove` (line 53), `PolicyStore.removeForDataset` (line 54).
- **Readers**: `PolicyStore.list` (line 52), `resolvePolicy` (line 58).

### Table 12: `column_meanings`
- **Source**: `server/src/semantic/meanings.store.js:9-12`.
- **Columns**:
  - `dataset_id TEXT NOT NULL`
  - `table_name TEXT NOT NULL`
  - `column_name TEXT NOT NULL`
  - `meaning TEXT NOT NULL`
  - `updated_by TEXT`
  - `updated_at TEXT NOT NULL`
  - `PRIMARY KEY (dataset_id, table_name, column_name)`
- **Writers**: `Meanings.set` (line 16), `Meanings.remove` (line 22).
- **Readers**: `Meanings.list` (line 15), `structured.engine.js:50`.

### Table 13: `org_knowledge`
- **Source**: `server/src/knowledge/org.knowledge.js:14-23`.
- **Columns**:
  - `id TEXT PRIMARY KEY`
  - `scope TEXT NOT NULL DEFAULT '*'` (`dataset_id | *`)
  - `kind TEXT NOT NULL DEFAULT 'glossary'` (`glossary | metric | rule | fact`)
  - `term TEXT NOT NULL`
  - `definition TEXT NOT NULL`
  - `created_by TEXT`
  - `created_at TEXT NOT NULL`
- **Writers**: `OrgKnowledge.add` (line 29), `OrgKnowledge.remove` (line 48).
- **Readers**: `OrgKnowledge.list` (line 37), `OrgKnowledge.renderForPrompt` (line 50), `core.engine.js:74`.

### Table 14: `user_preferences`
- **Source**: `server/src/memory/preferences.store.js:9`.
- **Columns**:
  - `user_id TEXT NOT NULL`
  - `key TEXT NOT NULL`
  - `value TEXT NOT NULL`
  - `updated_at TEXT NOT NULL`
  - `PRIMARY KEY (user_id, key)`
- **Writers**: `Preferences.set` (line 26).
- **Readers**: `Preferences.get` (line 20), `Preferences.toPromptText` (line 36), `core.engine.js:73`.

### Table 15: `ai_traces`
- **Source**: `server/src/observability/trace.js:11-16`.
- **Columns**:
  - `trace_id TEXT PRIMARY KEY`
  - `session_id TEXT`
  - `user_id TEXT`
  - `question TEXT`
  - `route TEXT`
  - `tool TEXT`
  - `status TEXT`
  - `total_ms INTEGER`
  - `steps_json TEXT NOT NULL`
  - `created_at TEXT NOT NULL`
- **Index**: `idx_trace_user` on `(user_id, created_at)`.
- **Writers**: `TraceStore.save` (line 44).
- **Readers**: `TraceStore.list` (line 52), `TraceStore.get` (line 57).

### Table 16: `action_requests`
- **Source**: `server/src/actions/action.registry.js:15-28`.
- **Columns**:
  - `action_id TEXT PRIMARY KEY`
  - `type TEXT NOT NULL`
  - `params_json TEXT NOT NULL`
  - `summary TEXT`
  - `status TEXT NOT NULL` (`pending | approved | rejected | executed | failed`)
  - `requested_by TEXT NOT NULL`
  - `decided_by TEXT`
  - `decision_note TEXT`
  - `result_json TEXT`
  - `created_at TEXT NOT NULL`
  - `decided_at TEXT`
- **Index**: `idx_action_status` on `status`.
- **Writers**: `ActionRegistry.propose` (line 62), `ActionRegistry.decide` (line 74), `ActionRegistry.recordResult` (line 89).
- **Readers**: `ActionRegistry.get` (line 70), `ActionRegistry.list` (line 97).

### Table 17: `action_outbox`
- **Source**: `server/src/actions/action.registry.js:29-38`.
- **Columns**:
  - `id TEXT PRIMARY KEY`
  - `action_id TEXT`
  - `to_addr TEXT`
  - `subject TEXT`
  - `body TEXT`
  - `attachment_name TEXT`
  - `delivery TEXT` (`smtp | simulated`)
  - `created_at TEXT NOT NULL`
- **Writers**: `ActionRegistry.enqueueEmail` (line 103).
- **Readers**: `ActionRegistry.listOutbox` (line 110).

---

## 3. The Semantic Model (`schema_json` & `profile_json`)

Every structured dataset record stores two core JSON columns in `datasets`: `schema_json` and `profile_json` (`server/src/ingestion/dataset.registry.js:33-34`).

### `schema_json` Specification
Populated by `readSchema()` (`server/src/schema/schema.reader.js:15`).
```json
{
  "tables": [
    {
      "name": "string",
      "rowCount": 1000,
      "columns": [
        {
          "name": "string",
          "type": "string",
          "nullable": true,
          "primaryKey": false,
          "defaultValue": null
        }
      ],
      "foreignKeys": [
        {
          "column": "customer_id",
          "referencesTable": "customers",
          "referencesColumn": "id"
        }
      ]
    }
  ]
}
```

### `profile_json` Specification
Generated and enriched by `analyzeSchema()` (`server/src/schema/schema.analyzer.js:20`) and `enrichProfile()` (`server/src/ingestion/profile.enricher.js:12`). Contains:
1. `relationships`: Array of detected foreign-key mappings:
   ```json
   [
     {
       "fromTable": "orders",
       "fromColumn": "customer_id",
       "toTable": "customers",
       "toColumn": "id",
       "confidence": 1.0,
       "source": "declared_fk" // or "name_match" | "heuristic"
     }
   ]
   ```
2. `semantic`: Populated by `buildSemanticModel()` (`server/src/semantic/semantic.builder.js:15-94`):
   - `tables`: Array of table semantic profiles:
     - `name`: Table identifier.
     - `rowCount`: Measured count.
     - `columns`: Array of column metadata:
       - `name`: Column name.
       - `role`: Functional classification: `'identifier' | 'primary_key' | 'foreign_key' | 'categorical' | 'measure' | 'temporal' | 'text' | 'boolean'` (`server/src/semantic/semantic.classifier.js:16`).
       - `data_type`: Inferred type: `'string' | 'integer' | 'float' | 'date' | 'datetime' | 'boolean'`.
       - `stats`: Numerical facts computed via SQL aggregates: `{ total, nonNull, missing, distinct, min, max, avg, distribution }` (`server/src/semantic/semantic.builder.js:28-38, 80-83`).
       - `values`: Value frequency list for low-cardinality categoricals (where `distinct <= 30`), e.g., `[{ "value": "Completed", "count": 450 }]`.
       - `samples`: Up to 5 sample values.
       - `description`: Algorithmic text description (`server/src/semantic/semantic.classifier.js:82`).
3. `quality`: Populated by `analyzeDataQuality()` (`server/src/quality/data.quality.js:15`):
   - `overallScore`: Integer (0–100).
   - `issueCount`: Total detected data quality issues.
   - `tables`: Per-table issues array (null rates, duplicate primary keys, mixed date formats, outlier values).

---

## 4. Schema Context Size & Token-Budget Implications

### Injection Architecture
In CogniCore, how is the schema presented to the model?
Examining `server/src/structured/sql.generator.js:14-22` and lines 52-75:

```javascript
// server/src/structured/sql.generator.js:14-22
function buildSchemaDescription(schema) {
  const tableNames = schema.tables.map((t) => `"${t.name}"`).join(', ');
  const tables = schema.tables.map(t => {
    const cols = t.columns.map(c => `${c.name} (${c.type}${c.primaryKey ? ', PK' : ''})`).join(', ');
    const fks = (t.foreignKeys || []).map(fk => `${fk.column} -> ${fk.referencesTable}.${fk.referencesColumn}`).join('; ');
    return `Table "${t.name}" [${t.rowCount} rows]: ${cols}${fks ? `\n  Relationships: ${fks}` : ''}`;
  }).join('\n');
  return { tables, tableNames };
}
```

### Critical Architectural Findings
1. **Zero Table Filtering for Schema DDL**: `buildSchemaDescription(schema)` iterates across **ALL** tables in `schema.tables`. If a database contains 50 tables or 500 columns, the **entire** unpruned schema string is serialized and injected into the prompt. There is no vector retrieval or LLM pre-filtering for table selection.
2. **Capped Semantic Prompt**: In contrast, the semantic profile text generated by `renderSemanticPrompt()` (`server/src/semantic/semantic.builder.js:98-104`) is explicitly capped to `maxTables = 12`:
   ```javascript
   function renderSemanticPrompt(model, { maxTables = 12 } = {}) {
     if (!model?.tables) return '';
     return model.tables.slice(0, maxTables).map(...);
   }
   ```
3. **Token Budget Impact**:
   - For datasets with 1–10 tables (the project's target design scale), the schema consumes 300–1,200 tokens.
   - For an enterprise schema with 100 tables, the schema string can consume 10,000+ tokens, exceeding small local context windows (e.g., 4k or 8k tokens in smaller local models) and risking prompt truncation.

---

## 5. Vector & Embedding Storage Reality

### Document Storage Pipeline
Document vector search is implemented in `server/src/documents/vector.store.js`, `embedder.js`, and `chunker.js`.

1. **Chunking (`server/src/documents/chunker.js:9-29`)**:
   - Pages are split by section headers (`splitBySection`, `server/src/documents/sections.js`).
   - Paragraphs are grouped with a maximum character size of `chunkMaxChars = 1200` and `chunkOverlapChars = 200` (`server/src/config/env.js:33-34`).
2. **Embedding (`server/src/documents/embedder.js:8-16`)**:
   - Chunks are embedded in batches of 16 via `EmbeddingProvider.embed()` (`server/src/llm/embedding.provider.js:25`), utilizing Ollama `nomic-embed-text` (or OpenAI `text-embedding-3-small`).
3. **Storage (`server/src/documents/vector.store.js:25-35`)**:
   - Chunks and floating-point embedding vectors are serialized as JSON strings (`JSON.stringify(c.embedding)`) and inserted into the `document_chunks` table in `cognicore_registry.db`:
     ```sql
     INSERT INTO document_chunks (chunk_id, dataset_id, chunk_index, page_number, text, embedding_json, created_at, section)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ```

### Similarity Search Mathematics: Pure Brute-Force Cosine
CogniCore deliberately does **not** use an external vector database (Pinecone, Milvus, Qdrant) or SQLite C-extensions (`sqlite-vec`).

Similarity search is executed via **in-memory JavaScript brute-force cosine similarity** over all chunks of the dataset (`server/src/documents/vector.store.js:73-97`):

```javascript
// server/src/documents/vector.store.js:73-84
search(datasetId, queryEmbedding, topK = config.documents.retrievalTopK) {
  const rows = db.prepare(`SELECT chunk_index, page_number, section, text, embedding_json FROM document_chunks WHERE dataset_id = ?`).all(datasetId);
  const scored = rows.map((r) => ({
    chunkIndex: r.chunk_index,
    pageNumber: r.page_number,
    section: r.section,
    text: r.text,
    score: cosineSimilarity(queryEmbedding, JSON.parse(r.embedding_json)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// server/src/documents/vector.store.js:87-97
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### Performance & Scalability Characteristics
- **Computational Complexity**: $O(N \cdot D)$, where $N$ is the number of chunks in the dataset and $D$ is embedding dimensionality (typically 768 for `nomic-embed-text` or 1536 for OpenAI).
- **Memory Overhead**: Parsing $N$ JSON strings into JavaScript arrays on every query. For 1,000 chunks, query time is negligible (<15ms). For 100,000 chunks, parsing JSON and computing dot products in single-threaded JavaScript creates noticeable latency. This is an explicit, documented architectural design decision for local-first, departmental-scale deployments.
