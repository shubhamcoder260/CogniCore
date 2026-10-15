# CogniCore Codebase Dossier — Part 1: Purpose & Positioning

---

## 1.1 Problem Statement, Target User, and "Local-First" Definition

### The Problem
CogniCore addresses the data privacy, security, and hallucination risks associated with deploying Generative Artificial Intelligence (GenAI) inside enterprise settings (`README.md:3-5`). Traditional text-to-SQL and Retrieval-Augmented Generation (RAG) copilots trust the output of Large Language Models (LLMs) to perform direct mathematical computation, generate unvalidated database queries, or transmit confidential enterprise intellectual property to third-party cloud APIs (`ENGINEERING_RULES.md:6-26`).

### Target User
The intended user is an enterprise employee, business analyst, department manager, or system administrator who needs to query proprietary structured databases (SQLite, PostgreSQL, MySQL) and unstructured organizational documents (PDF, DOCX, TXT) via natural language (`CAPABILITIES.md:3-12`, `server/src/security/rbac.js:55-63`).

### Meaning of "Local-First"
In CogniCore, **local-first** means:
1. **Zero External Data Transmission**: All LLM inference executes locally via Ollama daemon instances running on localhost (`server/src/config/env.js:25-26`). No data rows, schemas, or query strings leave the deployment host unless cloud providers are explicitly configured via environment overrides (`server/src/llm/model.manager.js:32-39`).
2. **Embedded Vector Search**: Unstructured document embeddings are computed via a local model (`nomic-embed-text`) and stored in a local SQLite table (`documents/vector.store.js:14-25`). Similarity searches are executed via brute-force cosine similarity in local JavaScript without requiring external vector databases (`README.md:50-57`).
3. **Local State & Registries**: Users, sessions, dataset metadata, and audit logs are persisted entirely in an embedded SQLite database (`cognicore_registry.db`) (`server/src/config/registry.db.js:11-23`).

---

## 1.2 Central Design Claim

> **The LLM is fundamentally untrusted as an execution agent.** CogniCore treats the LLM strictly as a non-deterministic translator that drafts candidate SQL queries and generates natural language explanations. All business logic, safety constraints, multi-tenant isolation, data policies, mathematical aggregations, and execution permissions are enforced deterministically by hard-coded, zero-LLM software gates before any query hits a database engine. If an LLM generates invalid SQL, introduces out-of-schema identifiers, violates role policies, or hallucinates numerical values, the deterministic pipeline repairs, intercepts, or replaces the response, failing closed to ensure data integrity and confidentiality (`ENGINEERING_RULES.md:11-15`, `server/src/core/core.engine.js:47-133`, `server/src/structured/sql.validator.js:15-139`).

---

## 1.3 Claims the Project Makes About Itself (Claim vs Code-Truth)

| # | Stated Project Claim | Source Document & Line | Code Truth | Code Receipt | Status |
|---|---|---|---|---|---|
| **C1** | **Domain-Agnostic Architecture**: Operates on arbitrary schemas with zero hardcoded tables or columns. | `README.md:3-4`<br>`ENGINEERING_RULES.md:6-10` | Confirmed. No domain entity names (e.g., "patient", "student", "order") exist in engine logic. Schemas are dynamically inspected via database metadata PRAGMAs. | `server/src/schema/schema.reader.js:9`<br>`server/src/schema/relationship.detector.js:50-86` | **SUPPORTED** |
| **C2** | **Deterministic Numerical Integrity**: The LLM never computes numbers; all figures originate from database execution. | `README.md:43-44`<br>`ENGINEERING_RULES.md:25` | Confirmed. Numeric grounding checks compare LLM answer tokens against executed query results. Unbacked numbers are stripped and replaced with deterministic templates. | `server/src/guardrails/answer.grounding.js:35-47`<br>`server/src/core/core.engine.js:127-133` | **SUPPORTED** |
| **C3** | **AST-Based SQL Validation**: Validates query AST for target dialect, blocking destructive DDL/DML and comments. | `README.md:23-25`<br>`ENGINEERING_RULES.md:12-13` | Confirmed. Uses `node-sql-parser` to construct an AST, enforcing a strict SELECT-only whitelist and stripping or rejecting comments. | `server/src/structured/sql.validator.js:15-139` | **SUPPORTED** |
| **C4** | **Fail-Closed Security Posture**: Unsafe operations or unresolvable permissions result in strict refusal. | `ENGINEERING_RULES.md:31, 38`<br>`ARCHITECTURE_GAP_ANALYSIS.md:14` | Confirmed. Unknown tables, policy denials, and parser failures trigger rejections (`lowConfidence: true` or HTTP 403 `PolicyError`). | `server/src/structured/sql.validator.js:28-87`<br>`server/src/security/data.policy.js:108-118` | **SUPPORTED** |
| **C5** | **Multi-Tenant Policy Enforcement**: Enforces dataset-level grants, column masking, and row-level filtering. | `README.md:11-16`<br>`PROGRESS.md:89-94` | Confirmed for SQLite and Postgres via CTE query rewriting. MySQL throws `PolicyError` 403 (fails closed). | `server/src/security/data.policy.js:61-118`<br>`server/src/security/rbac.js:55-63` | **SUPPORTED** |
| **C6** | **Credential Protection**: Database passwords are never exposed in API responses. | `README.md:47-48, 59-64` | Confirmed. API routes sanitize connection strings by stripping password fragments before returning dataset metadata. | `server/src/api/routes/datasets.js:30-36`<br>`server/src/ingestion/dataset.registry.js:148-154` | **SUPPORTED** |
| **C7** | **Database Credential Encryption-at-Rest**: Credentials in `connection_credentials` are encrypted at rest. | `README.md:64-65` | **Unimplemented**. `connection_credentials` table stores password strings in plain text within SQLite without symmetric encryption. | `server/src/ingestion/dataset.registry.js:46-52`<br>`server/src/api/routes/connections.js:25-35` | **NOT SUPPORTED (DRIFT)** |
| **C8** | **Dialect-Aware Row Policies on All Engines**: Row filtering supported across all adapters. | `PROGRESS.md:92` | Supported on SQLite and Postgres via CTE shadowing. Rejected on MySQL with `PolicyError: MySQL does not support row policies via CTE shadowing`. | `server/src/security/data.policy.js:108-111` | **PARTIAL** |
| **C9** | **Zero Cloud Dependencies**: The system operates with zero external services or cloud APIs required. | `README.md:51-54`<br>`ENGINEERING_RULES.md:18` | Confirmed. Default LLM and embeddings use Ollama; vector similarity is pure JS in SQLite; auth is local bcrypt + SQLite. | `server/src/config/env.js:23-28`<br>`server/src/documents/vector.store.js:46-55` | **SUPPORTED** |
| **C10** | **Comprehensive Audit Logging**: Every security-relevant action written to an audit log. | `README.md:14-16` | Confirmed. Logins, dataset uploads, deletions, permission grants, policy denials, and chat queries write to `audit_events`. | `server/src/security/audit.log.js:12-42`<br>`server/src/api/routes/chat.js:48-50` | **SUPPORTED** |
