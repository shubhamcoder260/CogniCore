# PART 13 — UNVERIFIED CLAIMS & OPEN QUESTIONS

This chapter catalogs all unverified claims, technical debt items identified during source inspection, and open architectural questions that require clarification from the codebase author.

---

## 1. Unverified Claims Register

Every factual claim in Parts 1–10 of this dossier was directly verified against lines of executable JavaScript code. The items below represent design claims or operational assumptions that could not be verified from code alone:

| Item ID | Claim Statement | Why Unverifiable from Static Code Alone | Status Tag |
| :---: | :--- | :--- | :---: |
| **U1** | Target deployment hardware specification for local inference (e.g. minimum VRAM required for `qwen2.5:14b` vs `7b`). | Hardware specifications, quantization levels (e.g. Q4_K_M vs FP16), and memory envelopes depend on the host machine running Ollama, not Node.js code. | `[UNVERIFIED]` |
| **U2** | Real-world accuracy and latency benchmarks for the Python data-science tool (`server/src/python/python.tool.js`). | Requires an external Python runtime environment with `pandas`, `scipy`, and `matplotlib` pre-installed; cannot be evaluated in read-only static analysis. | `[UNVERIFIED]` |
| **U3** | Cross-platform performance of the OCR pipeline (`pdftoppm` + `tesseract`). | Depends on external OS binaries being installed in the host environment PATH. | `[UNVERIFIED]` |

---

## 2. Technical Debt & Code Inspection Findings

1. **Plaintext Credential Storage (`server/src/ingestion/dataset.registry.js:53-57`)**:
   External relational database connection strings and passwords stored via `POST /api/connections` are serialized directly as plaintext JSON in the `connection_credentials` table:
   ```sql
   CREATE TABLE IF NOT EXISTS connection_credentials (
     dataset_id TEXT PRIMARY KEY,
     credentials_json TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   ```
   There is no AES-256 encryption at rest or key derivation from `JWT_SECRET`. Anyone with read access to `cognicore_registry.db` can extract database passwords.
2. **Persistent Singletons and Memory Leak Potential (`server/src/config/registry.db.js:9`, `server/src/llm/model.manager.js:22`)**:
   Global `Map` caches retain database connection handles and provider instances for the entire lifecycle of the Node.js process without eviction or TTL mechanisms.
3. **Event Loop Blocking in Vector Search (`server/src/documents/vector.store.js:74-82`)**:
   `VectorStore.search` performs `SELECT ... FROM document_chunks` and maps every row through `JSON.parse(r.embedding_json)` followed by single-threaded JavaScript dot products. For datasets with $>20,000$ chunks, this synchronous computation blocks the Node.js event loop, preventing the HTTP server from responding to incoming requests during searches.
4. **Integration Test Suite Brittleness**:
   Integration tests do not drop or truncate `data-test/cognicore_registry.db` before execution, causing 8 test failures across test files that assume a pristine database where the first registered user becomes `admin`.
5. **Hardcoded POSIX Path in Document Tests (`server/tests/integration/documents.test.js`)**:
   Uses hardcoded `/tmp` paths rather than `os.tmpdir()`, causing integration test failures on Windows hosts.

---

## 3. Open Questions for the Codebase Author

1. **Model Baseline Intent**:
   Did the project formally transition from `qwen2.5:7b` to `qwen2.5:14b` as the baseline evaluation model, and should `.env.example` be updated to reflect this change?
2. **Vector Index Evolution**:
   Was the brute-force in-memory cosine search in `vector.store.js` intended as a permanent architectural boundary for departmental deployments, or is an ANN index integration (e.g. `sqlite-vec` or `hnswlib`) planned?
3. **Database Credential Cryptography**:
   Is an envelope encryption feature planned for `connection_credentials` before production deployment?
4. **Historical Pipeline Refactoring**:
   Older architecture notes referenced `gate.chain.js`, `ast.gate.*`, and `pipeline.config.js`. Were these superseded by the direct execution flow in `core.engine.js` and `structured.engine.js`, or was there a separate modularization goal?
5. **MySQL Row-Level Security Strategy**:
   Given that MySQL denies CTE base table shadowing and throws a hard `PolicyError (403)`, is there a planned alternative (such as temporary views or parameterized AST rewriting) for MySQL deployments?
