# PART 14 — GLOSSARY & VISUAL DIAGRAMS

This chapter provides a rigorous domain glossary defined directly from the codebase implementation, accompanied by four comprehensive Mermaid architectural diagrams.

---

## 1. Domain Glossary

| Term | Technical Definition from Code | Source Citation |
| :--- | :--- | :--- |
| **`Dataset`** | An identified data source registered in the `datasets` SQLite table, possessing an isolated physical storage location, dynamically discovered schema, and profile. | `server/src/ingestion/dataset.registry.js:26` |
| **`Profile`** | Statistical metadata, column classifications, detected relationships, and data-quality audit scores serialized as JSON in `datasets.profile_json`. | `server/src/schema/schema.analyzer.js:20`, `profile.enricher.js:12` |
| **`Semantic Model`** | Machine-measured column metadata (`role`, `data_type`, `stats`, `values`, `samples`, `description`) built via aggregate SQL queries and attached to prompts. | `server/src/semantic/semantic.builder.js:15-94` |
| **`Evidence`** | A validated, structured JSON payload produced by query execution or document retrieval, acting as the sole source of truth for answer synthesis. | `server/src/evidence/evidence.manager.js:10-56` |
| **`Provenance`** | Verifiable data lineage metadata recording the exact dataset name, database dialect, tables referenced, and row counts returned. | `server/src/evidence/provenance.js:10-25` |
| **`Grounding`** | The deterministic post-synthesis verification ensuring that every numerical token in the model's natural language answer is mathematically traceable to the evidence payload. | `server/src/guardrails/answer.grounding.js:41-55` |
| **`Session State`** | A bounded JSON document stored in `session_state` capturing recent turn history, previous SQL queries, active WHERE filters, and time constraints. | `server/src/core/session.state.js:8-23` |
| **`Action Request`** | A proposed side-effecting operation (email delivery, report export, webhook dispatch) stored in `action_requests` awaiting two-party human approval. | `server/src/actions/action.registry.js:15-28` |
| **`Auto-Repair`** | A suite of six (6) deterministic AST and token transformations applied to candidate SQL before validation without invoking an LLM. | `server/src/core/engines/structured.engine.js:212-241` |
| **`Error Recovery`** | A bounded feedback loop that re-prompts the LLM with previous error messages and unresolved column suggestions when candidate SQL fails validation. | `server/src/core/engines/structured.engine.js:80-130` |

---

## 2. Visual Architecture Diagrams

### Diagram 1: Complete System Architecture
This diagram illustrates the core components, boundaries, and data flows across the CogniCore server.

```mermaid
flowchart TD
    Client["Client (Browser / React SPA)"] -->|"HTTP POST /api/chat"| HTTP["Express HTTP Router & Middleware"]

    subgraph SecurityPerimeter ["Security & Perimeter Layer"]
        HTTP --> RateLimiter["Rate Limiter (Sliding Window)"]
        RateLimiter --> RBAC["RBAC Middleware (JWT / Capabilities)"]
        RBAC --> InputGuard["Input Guardrail (Regex Prompt Injection)"]
    end

    InputGuard -->|"Blocked"| EarlyExit["HTTP 200 (routeType: 'BLOCKED')"]
    InputGuard -->|"Passed"| CoreEngine["Core Orchestration Engine"]

    subgraph CoreSubsystem ["Core Orchestration Subsystem"]
        CoreEngine --> FollowUp["Follow-up Query Resolver"]
        FollowUp --> IntentClassifier["Intent Classifier"]
        IntentClassifier --> Router["Query Router"]
    end

    subgraph EnginePipelines ["Execution Pipelines"]
        Router -->|"Agent Intent"| AgentEngine["Deterministic Agent Tools"]
        Router -->|"Structured"| StructuredPipeline["Structured SQL Pipeline"]
        Router -->|"Document"| DocumentPipeline["Document RAG Pipeline"]
        Router -->|"Hybrid"| HybridPipeline["Hybrid Cross-Modal Pipeline"]
        Router -->|"Analysis"| AnalysisPipeline["Multi-Step Analysis Planner"]
    end

    subgraph StorageLayer ["Data & Storage Layer"]
        RegistryDB[("SQLite Registry DB (cognicore_registry.db)")]
        MaterializedDB[("Materialized SQLite Datasets (server/data/*.db)")]
        VectorStore[("Document Chunks Table in Registry")]
    end

    StructuredPipeline --> StorageLayer
    DocumentPipeline --> StorageLayer
    AgentEngine --> StorageLayer

    subgraph ResponseLayer ["Response Verification & Grounding"]
        EnginePipelines --> Synthesis["Answer Composer (LLM Explanation)"]
        Synthesis --> GroundingCheck["Numeric Grounding & Contradiction Guard"]
        GroundingCheck --> PIIMask["PII Masking (viewer / employee)"]
        PIIMask --> TracePersist["TraceStore & Audit Logging"]
    end

    TracePersist --> Client
```

---

### Diagram 2: Structured Pipeline Detail (All 18 Stages & Loops)
This diagram illustrates the step-by-step execution flow of the structured pipeline, detailing auto-repair, AST validation, and the error recovery loop.

```mermaid
flowchart TD
    Start(["Start: Inbound Query"]) --> S1["1. Input Screening (screenQuestion)"]
    S1 -->|"Blocked"| ExitBlocked["Return BLOCKED"]
    S1 -->|"Passed"| S2["2. Intent Classification (classifyIntent)"]
    S2 --> S3["3. Schema Resolution (dataset.schema)"]
    S3 --> S4["4. Candidate Selection (buildSchemaDescription)"]
    S4 --> S5["5. Few-Shot Pattern Retrieval (selectPatternHints)"]
    S5 --> S6["6. Prompt Assembly (buildPrompt)"]
    S6 --> S7["7. Candidate SQL Generation (LLM Call)"]

    S7 --> RefusalCheck{"Is Response NO_QUERY_POSSIBLE?"}
    RefusalCheck -->|"Yes (First Attempt)"| S7Retry["Single Refusal Retry (retryHint: true)"]
    S7Retry --> S8
    RefusalCheck -->|"No"| S8["8. Deterministic Auto-Repair (prepareSql)"]

    subgraph Repairs ["The 6 Auto-Repairs"]
        S8 --> R1["Repair 1: Table Names"]
        R1 --> R2["Repair 2: Column Names"]
        R2 --> R3["Repair 3: Missing FROM"]
        R3 --> R4["Repair 4: Missing GROUP BY"]
        R4 --> R5["Repair 5: Integer Division (1.0 *)"]
        R5 --> R6["Repair 6: Categorical Value Literals"]
    end

    R6 --> S9["9. SQL AST Validation (node-sql-parser)"]
    S9 --> S10["10. Complexity Gate (Length, Joins, Fan-out)"]

    S10 --> ValidCheck{"Validation Passed?"}
    ValidCheck -->|"Security Violation"| ExitSecurity["Return Validation Failure"]
    ValidCheck -->|"Recoverable Error & Attempt < 2"| S14["14. Error Recovery Loop (generateSql with Hints)"]
    S14 --> S8

    ValidCheck -->|"Passed"| S11["11. Policy Enforcement (CTE Shadowing)"]
    S11 --> S12["12. Read-Only Query Execution (executeValidatedQuery)"]

    S12 --> ExecCheck{"Execution Error?"}
    ExecCheck -->|"Recoverable DB Error"| S14
    ExecCheck -->|"Success"| S13["13. Execution Verification & Empty Diagnosis"]

    S13 --> S15["15. Result Formatting (buildStructuredEvidence)"]
    S15 --> S16["16. Narrative Generation (composeAnswer)"]
    S16 --> GroundingGate{"Passes Numeric Grounding?"}
    GroundingGate -->|"Failed"| DetAnswer["Replace with buildDeterministicAnswer()"]
    GroundingGate -->|"Passed"| S17["17. Audit Logging (TraceStore.save)"]
    DetAnswer --> S17
    S17 --> S18["18. Final Response Assembly (finalize)"]
    S18 --> End(["End: HTTP Response"])
```

---

### Diagram 3: Security Perimeter & Defensive Gates
This diagram highlights where untrusted input encounters deterministic gates and what threats each gate neutralizes.

```mermaid
flowchart TD
    UserInput["Untrusted User Input (Natural Language)"] --> G1["Gate 1: Input Guardrail (input.guard.js)"]
    G1 -->|"Blocks Prompt Injections & Semicolon Smuggling"| Trash1["Rejected (HTTP 200 BLOCKED)"]

    G1 --> G2["Gate 2: RBAC & Capability Gate (rbac.js)"]
    G2 -->|"Blocks Unauthorized Capabilities (e.g. employee attempting upload)"| Trash2["Forbidden (HTTP 403)"]

    G2 --> G3["Gate 3: SQL Generation Prompt Boundary"]
    G3 -->|"Model Drafts Candidate SQL"| G4["Gate 4: SQL AST Validator (sql.validator.js)"]
    G4 -->|"Blocks DROP, DELETE, comments (--), multiple statements, unknown tables"| Trash3["Refused (SQLValidationError)"]

    G4 --> G5["Gate 5: Complexity & Fan-out Gate (sql.complexity.js)"]
    G5 -->|"Blocks Cartesian joins, >6 joins, >4 depth, huge statements"| Trash4["Refused (Too Expensive)"]

    G5 --> G6["Gate 6: Data Policy Enforcement (data.policy.js)"]
    G6 -->|"Blocks denied columns, SELECT * on restricted tables, MySQL RLS"| Trash5["Denied (PolicyError 403)"]

    G6 --> G7["Gate 7: Read-Only Execution Boundary (sql.executor.js)"]
    G7 -->|"Wraps in LIMIT 1000 subquery; readonly: true connection"| PhysicalDB[("Target Database")]

    PhysicalDB --> G8["Gate 8: Grounding & Contradiction Guard (answer.grounding.js)"]
    G8 -->|"Detects hallucinated numbers or false insufficiency claims"| DeterministicFallback["Replaced with Deterministic Table"]

    G8 --> G9["Gate 9: PII Redaction Filter (pii.js)"]
    G9 -->|"Masks email, phone, SSN, credit cards for viewer/employee"| SafeOutput["Sanitized Safe API Response"]
```

---

### Diagram 4: Complete Data Lifecycle
This diagram traces an uploaded dataset through ingestion, profiling, storage, query execution, evidence composition, and presentation.

```mermaid
sequenceDiagram
    autonumber
    actor User as User / Client
    participant UploadRoute as /api/upload Route
    participant FileVal as File Validator
    participant Pipeline as Ingestion Pipeline
    participant Adapter as Dataset Adapter
    participant Profiler as Schema & Profile Enricher
    participant Registry as Registry DB
    participant Engine as Query Engine
    participant LLM as Language Model

    User->>UploadRoute: POST /api/upload (File)
    UploadRoute->>FileVal: validateUpload(filePath)
    Note over FileVal: Magic bytes check<br/>Blocks executables / zip bombs
    UploadRoute->>Pipeline: ingestFile({ filePath, originalFilename })

    alt Tabular File (CSV / XLSX)
        Pipeline->>Adapter: ingest() (loadRowsIntoSqlite)
        Adapter-->>Registry: Materializes server/data/{id}.db
    else SQLite File (.db)
        Pipeline->>Adapter: Operates in-place (read-only)
    else Document (PDF / DOCX)
        Pipeline->>Adapter: chunkPages() & embedAndStore()
        Adapter-->>Registry: Inserts into document_chunks
    end

    Pipeline->>Profiler: analyzeSchema() & enrichProfile()
    Note over Profiler: Measures stats, values,<br/>data quality, heuristic FKs
    Pipeline->>Registry: markReady({ schema_json, profile_json })
    UploadRoute-->>User: HTTP 201 Created (dataset ready)

    User->>Engine: POST /api/chat (Question)
    Engine->>LLM: generateSql(Prompt with Schema & Semantics)
    LLM-->>Engine: Candidate SQL
    Note over Engine: Auto-Repair -> Validate -> Policy -> Execute
    Engine->>Adapter: executeValidatedQuery(cappedSql)
    Adapter-->>Engine: Rows & RowCount
    Engine->>LLM: composeAnswer(Prompt with Evidence)
    LLM-->>Engine: Natural Language Synthesis
    Note over Engine: Numeric Grounding Check -> PII Masking
    Engine-->>User: Final Response Object (Answer, Evidence, Trace)
```
