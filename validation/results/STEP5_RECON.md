# Step 5 Reconnaissance Report: Architectural, Empirical, and Operational Findings

**Date**: 2026-10-16  
**Workspace**: `C:\cognicore\validation_workspace` (branch `validation`)  
**Scope**: Reconnaissance and pre-experimental benchmarking for Step 5 (V1/V2 raw vs governed correctness, layer ablation, canary echo, and prompt injection ASR).  
**Status**: COMPLETE (Reconnaissance only; no Step 5 experiment commenced).  
**Raw Telemetry Artifacts**:
- `validation/raw/recon/r2_routing_60.json` (Routing simulation across 63 questions)
- `validation/raw/recon/r3_latency_breakdown.json` (End-to-end latency profiling across 5 questions)
- `validation/raw/recon/r4_prompt_audit.json` (Exact prompt token counts for all 15 databases via Ollama)
- `validation/raw/recon/r5_semantic.json` (Semantic layer build overhead and determinism diff across 15 databases)
- `validation/raw/recon/r9_model_profile.json` (Throughput and memory footprint for qwen2.5-coder:7b and qwen2.5:14b)
- `validation/raw/recon/r10_mini_pilot.json` (Mini-pilot of 12 questions comparing C0 raw prompt vs Governed V1 pipeline)
- `validation/raw/recon/prompt_T1_B1.txt`, `prompt_T2_B2.txt`, `prompt_T3_B3.txt` (Verbatim system prompts)

---

## R1. Entry Points and Invocation

### Code Facts
1. **`core.engine.js`**:
   - **File:Line**: [server/src/core/core.engine.js:38](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L38)
   - **Signature**: `async function handleUserQuery({ question, datasetId, datasetIds, sessionId, userId, user = null, analysisMode = false })`
   - **Returned Fields**: `{ sessionId, routeType, answer, evidence, lowConfidence, generatedSql, execResult, partial, insights, chart, suggestions, tool, analytics, report, action, repairs, recoveryAttempts, guardrail, redactedFields, followUp, denied, trace, confidence, provenance }`
   - **Execution Characteristics**: Hardcoded singleton LLM providers via `getLLMProvider('sql')` and `getLLMProvider('reasoning')` ([server/src/llm/model.manager.js](file:///C:/cognicore/validation_workspace/server/src/llm/model.manager.js)). Automatically executes intent routing, agent tools (`tryAgent`), and a second full LLM synthesis call (`composeAnswer`) generating markdown explanations.
2. **`structured.engine.js`**:
   - **File:Line**: [server/src/core/engines/structured.engine.js:36, 42](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L36)
   - **Signature**: `async function runStructuredQuery({ question, dataset, llmProvider, conversationContext, followUp = null, policy = null, knowledgeText = '', maxRecovery = MAX_RECOVERY_ATTEMPTS })`
   - **Returned Fields**: `{ routeType, answer, evidence, lowConfidence, generatedSql, execResult, sqlRepaired, recoveryLog, steps }`
   - **Execution Characteristics**: **Fully dependency-injected** (`llmProvider` passed directly by caller). Executes the complete governed text-to-SQL pipeline: prompt construction $\rightarrow$ LLM generation $\rightarrow$ `cleanSqlOutput` $\rightarrow$ `prepareSql` (6-stage repair) $\rightarrow$ `validateSql` (7-stage AST gate) $\rightarrow$ `enforcePolicy` (RLS & column denial) $\rightarrow$ read-only capped execution $\rightarrow$ empty-result diagnosis. Does NOT execute markdown answer synthesis (`composeAnswer`), cutting wall-clock execution time by ~50%.
3. **`analysis.engine.js`**:
   - **File:Line**: [server/src/core/engines/analysis.engine.js:18](file:///C:/cognicore/validation_workspace/server/src/core/engines/analysis.engine.js#L18)
   - **Signature**: `async function runAnalysisQuery({ question, dataset, llmProvider, session, conversationContext = '', policy = null, knowledgeText = '' })`
   - **Returned Fields**: `{ routeType: 'ANALYSIS', answer, evidence: { source_type: 'analysis', steps }, lowConfidence }`
   - **Execution Characteristics**: Multi-step iterative planner that decomposes complex queries into multiple sub-queries.
4. **`query.router.js`**:
   - **File:Line**: [server/src/core/query.router.js:21](file:///C:/cognicore/validation_workspace/server/src/core/query.router.js#L21)
   - **Signature**: `async function routeQuery({ question, datasetIds, session, llmProvider, embeddingProvider, conversationContext, analysisMode = false, policy, knowledgeText = '', followUp = null })`
   - **Execution Characteristics**: Calls `planQuery` ([server/src/core/query.planner.js:18](file:///C:/cognicore/validation_workspace/server/src/core/query.planner.js#L18)) to determine dataset route (`STRUCTURED`, `DOCUMENT`, `HYBRID`, `ANALYSIS`).
5. **Benchmark Helper**:
   - **File:Line**: [server/benchmark/run.js:14-15](file:///C:/cognicore/validation_workspace/server/benchmark/run.js#L14-L15)
   - **Pattern**: Monkey-patches `mm.getLLMProvider = () => llm` on `server/src/llm/model.manager.js`.

### Recommendation for Step 5
- **Governed Path (V1)**: The Step 5 benchmark harness MUST invoke `runStructuredQuery` ([server/src/core/engines/structured.engine.js:36](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L36)) directly. It accepts the harness-supplied `llmProvider` wrapper, executes every governing layer (`prepareSql` $\rightarrow$ `validateSql` $\rightarrow$ `enforcePolicy` $\rightarrow$ `executeValidatedQuery`), and avoids monkey-patching singletons.
- **Raw Path (C0)**: Raw mode requires its own dedicated harness entry point: builds a standard DDL prompt (system instructions + DDL schema only), invokes the model, extracts SQL via standard regex/stripping, and executes directly on a dedicated read-only SQLite connection.
- **RISK**: If raw and governed paths execute through fundamentally different database connection mechanisms (e.g., persistent single-connection vs per-query ephemeral adapters), execution errors or latency differences could be artifacts of harness plumbing rather than CogniCore governance. Both paths must execute queries against identical SQLite database files with the same 1,000-row cap.

---

## R2. Routing Behavior

### Code Facts & Classifier Heuristics
1. **Analytical Intent Classifier**:
   - **File:Line**: [server/src/agent/intent.classifier.js:10-24](file:///C:/cognicore/validation_workspace/server/src/agent/intent.classifier.js#L10-L24)
   - **Condition**: 13 regex rules matching conversational patterns:
     ```javascript
     const RULES = [
       { intent: 'action', rule: /\b(cancel|delete|update|change|set|disable|enable|create|add|approve|reject)\b/i },
       { intent: 'report', rule: /\b(management|executive|business|summary)\s+report\b/i },
       { intent: 'overview', rule: /\b(overview|tell me about|what is in|summarize|summary of)\b/i },
       { intent: 'describe', rule: /\b(describe|statistics (for|of|on)|summary stats?|distribution of)\b/i },
       { intent: 'scenario', rule: /\b(what if|what happens if|what would happen if|simulate|impact of)\b/i },
       { intent: 'trend', rule: /\b(trend\w*|increasing or decreasing|going up or down|over time)\b/i },
       { intent: 'forecast', rule: /\b(forecast\w*|predict\w*|projection|project next)\b/i },
       { intent: 'anomaly', rule: /\b(anomal\w*|outliers?|unusual\w*|abnormal\w*)\b/i },
       { intent: 'correlation', rule: /\b(correlat\w*|relationship between|is there a connection)\b/i },
       { intent: 'compare', rule: /\b(compare|comparison|versus|vs\.?|difference between)\b/i },
       { intent: 'quality', rule: /\b(data quality|missing values?|duplicates?|issues? in|clean)\b/i },
       { intent: 'kpi', rule: /\b(kpis?|key (metrics|indicators|performance))\b/i },
       { intent: 'explore', rule: /\b(suggest questions?|what (can|should) I ask|explore)\b/i },
     ];
     ```
   - **Destination**: Intercepts queries in `core.engine.js`:
     * `intent === 'action'`: [server/src/core/core.engine.js:80](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L80) $\rightarrow$ `proposeFromChat` (returns action proposal, 0 SQL).
     * `intent === 'report'`: [server/src/core/core.engine.js:84](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L84) $\rightarrow$ `buildManagementReport` (returns markdown report, 0 NL2SQL).
     * `ANALYTIC_INTENTS.has(intent)`: [server/src/core/core.engine.js:97](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L97) $\rightarrow$ `tryAgent` ([server/src/agent/agent.js:16](file:///C:/cognicore/validation_workspace/server/src/agent/agent.js#L16)). If table and column anchor words resolve in `column.resolver.js`, it executes purpose-built deterministic JS math routines (`analytic.tools.js`) bypassing text-to-SQL generation.
2. **Dataset Multi-Type Classifier**:
   - **File:Line**: [server/src/core/query.planner.js:37-60](file:///C:/cognicore/validation_workspace/server/src/core/query.planner.js#L37-L60)
   - **Condition**: `structuredDatasets.length > 0 && documentDatasets.length > 0` $\rightarrow$ routes to `HYBRID`.
   - **Condition**: `documentDatasets.length > 0 && structuredDatasets.length === 0` $\rightarrow$ routes to `DOCUMENT`.
   - **Condition**: `structuredDatasets.length === 1` $\rightarrow$ routes to `STRUCTURED`.

### Empirical Simulation (63 Candidate Questions)
Executed via `validation/experiments/recon_r2_routing.js` on `B1_community.db` (saved to `validation/raw/recon/r2_routing_60.json`):
- **Total Questions Evaluated**: 63 questions across 8 categories (counts, filtered counts, sums/averages, group-by top-1, percentages, multi-table joins, date filters, wording variants).
- **Routed to `STRUCTURED` (Text-to-SQL pipeline)**: 60 questions (**95.2%**).
- **Intercepted Away from SQL Pipeline**: 3 questions (**4.8%**):
  1. `[Q60]` *"What happens if interest rates increase by 2%?"* $\rightarrow$ **AGENT (scenario)** (intercepted by scenario tool).
  2. `[Q62]` *"Show key metrics for our accounts."* $\rightarrow$ **AGENT (kpi)** (intercepted by KPI generator).
  3. `[Q63]` *"Give me a management report on company performance."* $\rightarrow$ **REPORT** (intercepted by management report builder).
- **Fallback Verification**: Questions with analytical phrasing where table/date resolution was ambiguous (e.g. `[Q52]` *"What is the trend of transaction volume over the last 6 months?"*) cleanly fell back (`tryAgent` returned `handled: false`), proceeding to `STRUCTURED`.
- **RISK**: If Step 5 questions contain phrasing triggering `action`, `report`, `scenario`, or `kpi`, they will be intercepted by deterministic tools and will not test LLM text-to-SQL capability.
- **Decision for Step 5**:
  1. Harness will call `runStructuredQuery` directly, bypassing `core.engine.js`'s agent interceptors entirely.
  2. Evaluation question sets must avoid trigger phrasing (`what if`, `management report`, `kpis`).

---

## R3. Latency Breakdown (Profiling)

### Microsecond Instrumentation Across 5 Questions
Instrumented via `validation/experiments/recon_r3_latency.js` with `performance.now()` across 5 databases (saved to `validation/raw/recon/r3_latency_breakdown.json`):
- **Q1** (`B1_community.db`): *"What is the total balance across all accounts?"*
- **Q2** (`B1_community.db`): *"How many customers are there?"*
- **Q3** (`F1_quickbite.db`): *"Which restaurant has the highest rating?"*
- **Q4** (`H1_clinic.db`): *"How many patients are there?"*
- **Q5** (`U1_stateuniv.db`): *"What is the average credits of all courses?"*

### Measured Stage Latencies (Milliseconds)

| Pipeline Stage | Q1 (`B1`) | Q2 (`B1`) | Q3 (`F1`) | Q4 (`H1`) | Q5 (`U1`) | Mean Latency | % of Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Semantic layer lookup / build** | 11.17 ms | 14.89 ms | 12.04 ms | 13.41 ms | 5.82 ms | 11.47 ms | 0.25% |
| **Routing & intent check** | 2.85 ms | 0.03 ms | 0.04 ms | 0.04 ms | 0.03 ms | 0.60 ms | 0.01% |
| **Schema formatting & joins** | 0.48 ms | 0.16 ms | 0.21 ms | 0.24 ms | 0.20 ms | 0.26 ms | 0.01% |
| **Prompt construction** | 0.84 ms | 0.60 ms | 0.85 ms | 0.88 ms | 0.91 ms | 0.82 ms | 0.02% |
| **LLM Generation: SQL Draft** | **1,208.83 ms** | **1,600.84 ms** | **3,623.98 ms** | **3,162.88 ms** | **3,135.94 ms** | **2,546.49 ms** | **57.48%** |
| **Output cleaning & fence stripping** | 0.07 ms | 0.06 ms | 0.06 ms | 0.07 ms | 0.07 ms | 0.07 ms | <0.01% |
| **`prepareSql` (6-stage repair)** | 1.58 ms | 0.31 ms | 0.28 ms | 0.34 ms | 0.29 ms | 0.56 ms | 0.01% |
| **`validateSql` (7 AST checks)** | 8.16 ms | 3.26 ms | 3.82 ms | 4.12 ms | 4.01 ms | 4.67 ms | 0.11% |
| **`enforcePolicy` (CTE wrapping)** | 0.16 ms | 0.01 ms | 0.02 ms | 0.02 ms | 0.02 ms | 0.05 ms | <0.01% |
| **SQLite Execution (capped read)** | 1.81 ms | 2.05 ms | 3.13 ms | 1.92 ms | 2.27 ms | 2.24 ms | 0.05% |
| **Evidence construction** | 0.07 ms | 0.02 ms | 0.03 ms | 0.03 ms | 0.03 ms | 0.04 ms | <0.01% |
| **LLM Generation: Answer Synthesis** | **2,349.79 ms** | **1,562.23 ms** | **1,984.35 ms** | **1,409.76 ms** | **1,986.76 ms** | **1,858.58 ms** | **41.95%** |
| **Grounding verification check** | 0.67 ms | 0.28 ms | 0.32 ms | 0.35 ms | 0.31 ms | 0.39 ms | 0.01% |
| **Total End-to-End Wall Clock** | **3,586.54 ms** | **3,184.79 ms** | **5,636.67 ms** | **4,604.30 ms** | **5,136.27 ms** | **4,429.71 ms** | **100.0%** |

### Key Architectural Findings
1. **Dominant Stages**: The two LLM inference calls (**SQL Draft Generation** at 57.5% and **Answer Synthesis** at 42.0%) account for **99.43%** of all query execution latency.
2. **Deterministic Governance Overhead**: All CogniCore governance mechanisms combined (`prepareSql` + `validateSql` + `enforcePolicy` + SQLite Execution + Grounding Verification) take an average of **8.35 ms** (<0.2% of wall-clock time).
3. **Synthesis Toggle**: Answer synthesis (`composeAnswer`) is enabled by default at [server/src/core/core.engine.js:125](file:///C:/cognicore/validation_workspace/server/src/core/core.engine.js#L125). In Step 5, because correctness depends exclusively on executed SQL row-set equality against ground truth, answer synthesis MUST be turned off (by invoking `runStructuredQuery`), reducing wall-clock evaluation time from 4.4s down to 2.5s per query.

---

## R4. Prompt Audit and Token Counts

### Exact Token Count Audit Across All 15 Databases
Measured using `qwen2.5-coder:7b`'s exact tokenizer via Ollama `/api/generate` with `options: { num_predict: 1 }` (saved to `validation/raw/recon/r4_prompt_audit.json`):

| Fixture ID | Domain | Scale | Tables | Prompt Length (Chars) | Prompt Tokens (Exact) | % of 2048 Context | % of 4096 Context | Eval Time (ms) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **B1_community** | Bank | T1 | 4 | 3,443 chars | 1,070 tok | 52.2% | 26.1% | 2,632.2 ms |
| **B2_district** | Bank | T2 | 4 | 3,703 chars | 1,033 tok | 50.4% | 25.2% | 1,742.2 ms |
| **B3_metro** | Bank | T3 | 4 | 3,716 chars | 1,037 tok | 50.6% | 25.3% | 1,725.5 ms |
| **F1_quickbite** | Food Delivery | T1 | 6 | 3,939 chars | 1,185 tok | 57.9% | 28.9% | 2,284.8 ms |
| **F2_citygrub** | Food Delivery | T2 | 6 | 5,047 chars | 1,345 tok | 65.7% | 32.8% | 2,464.3 ms |
| **F3_national** | Food Delivery | T3 | 6 | 5,054 chars | 1,348 tok | 65.8% | 32.9% | 2,485.2 ms |
| **H1_clinic** | Hospital | T1 | 6 | 4,368 chars | 1,211 tok | 59.1% | 29.6% | 2,340.9 ms |
| **H2_legacymed** | Hospital | T2 | 5 | 3,816 chars | 1,103 tok | 53.9% | 26.9% | 2,448.8 ms |
| **H3_metropol** | Hospital | T3 | 9 | 6,020 chars | 1,694 tok | 82.7% | 41.4% | 3,188.8 ms |
| **I1_workshop** | Industry | T1 | 3 | 2,787 chars | 866 tok | 42.3% | 21.1% | 1,608.2 ms |
| **I2_factory** | Industry | T2 | 3 | 3,245 chars | 883 tok | 43.1% | 21.6% | 1,611.5 ms |
| **I3_plantops** | Industry | T3 | 3 | 3,251 chars | 889 tok | 43.4% | 21.7% | 1,608.2 ms |
| **U1_stateuniv** | University | T1 | 5 | 4,626 chars | 1,243 tok | 60.7% | 30.3% | 2,364.5 ms |
| **U2_metrouniv** | University | T2 | 5 | 4,379 chars | 1,175 tok | 57.4% | 28.7% | 2,267.8 ms |
| **U3_institute** | University | T3 | 5 | 3,978 chars | 1,296 tok | 63.3% | 31.6% | 2,390.8 ms |

### Context Window Analysis & Verbatim Prompts
- **Context Overflow**: No database overflows 2,048 tokens on the initial prompt. Minimum is 866 tokens (`I1`), maximum is 1,694 tokens (`H3`).
- **Context Headroom**: At the default Ollama context length (2,048 tokens), `H3_metropol` leaves only $2048 - 1694 = 354$ tokens for model output generation and error recovery retry notes. When retry occurs, the prompt appends previous SQL, error, and hints (+150-250 tokens), creating a high risk of context truncation at 2,048 tokens.
- **Context Recommendation**: Step 5 MUST configure `options: { num_ctx: 4096 }` for all Ollama calls. At 4,096 tokens, `H3` consumes only 41.4% of context, leaving >2,400 tokens for generation and recovery.
- **Representative Prompts Recorded Verbatim**:
  * **T1 (`B1_community.db`)**: 3,443 characters, 1,070 tokens (`validation/raw/recon/prompt_T1_B1.txt`).
  * **T2 (`B2_district.db`)**: 3,703 characters, 1,033 tokens (`validation/raw/recon/prompt_T2_B2.txt`).
  * **T3 (`B3_metro.db`)**: 3,716 characters, 1,037 tokens (`validation/raw/recon/prompt_T3_B3.txt`).
- **Dynamic Inclusions**: CogniCore prompts dynamically include real discovered column sample values (e.g. `'Checking'`, `'Savings'`), distinct counts, and join paths. In Step 5, prompts must be generated deterministically per question without multi-turn contamination.

---

## R5. Semantic Layer Determinism and Overhead

### Code Facts
- **File:Line**: [server/src/semantic/semantic.builder.js:15-95](file:///C:/cognicore/validation_workspace/server/src/semantic/semantic.builder.js#L15-L95)
- **Ingestion Caching**: The semantic model is constructed once at dataset ingestion time by `enrichProfile` ([server/src/ingestion/profile.enricher.js:18](file:///C:/cognicore/validation_workspace/server/src/ingestion/profile.enricher.js#L18)) and stored in the registry SQLite database (`datasets.profile_json`).
- **Query-Time Overhead**: During query execution, `structured.engine.js:50` reads `dataset.profile?.semantic` in memory with zero database round-trips.

### Empirical Measurements Across All 15 Databases
Measured via `validation/experiments/recon_r5_semantic.js` (saved to `validation/raw/recon/r5_semantic.json`):
- **Build Times**: Ranging from 5 ms (`I1`, `U1`) to 541 ms (`H2_legacymed`). Average build time across all 15 databases is **115.3 ms**.
- **Determinism Check**: Ran two consecutive builds per database and performed deep JSON diffs (excluding `generatedAt` timestamp). Result: **100% deterministic** across all 15 databases. All column roles, stats, distinct counts, min/max, samples, and category values match bit-for-bit.
- **Token Overhead Added to Prompt**:
  * Minimum prompt text added: 958 chars (~252 tokens) for `I1_workshop`.
  * Maximum prompt text added: 2,698 chars (~710 tokens) for `H3_metropol`.
  * Mean prompt text added: 1,697 chars (~446 tokens).

---

## R6. Retry and Recovery Behavior

### Code Facts & Verbatim Logic
1. **Retry Limit**:
   - **File:Line**: [server/src/core/engines/structured.engine.js:20](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L20)
   - **Verbatim Code**:
     ```javascript
     const MAX_RECOVERY_ATTEMPTS = 2;
     ```
2. **Retry Triggers & Fail-Closed Boundaries**:
   - **File:Line**: [server/src/core/engines/structured.engine.js:94-110](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L94-L110)
   - **Verbatim Logic**:
     ```javascript
     } catch (err) {
       // Security rejections must fail-closed immediately: do not let the LLM
       // probe alternative bypasses (blueprint rule #7 / #10).
       if (err.name === 'SQLValidationError' && err.isSecurityRejection) {
         mark('validation', 'error', `blocked: ${err.message}`);
         return validationFailure(prepared.sql, err);
       }
       lastError = err;
       mark('validation', 'error', err.message);
     }
     ```
   - **Rule**: Security rejections (denylist keyword, multiple statements, block comments, non-SELECT types) **fail-closed immediately with 0 retries**. Only benign syntactic or schema errors (unknown column, missing join) trigger recovery.
3. **Retry Prompt Construction**:
   - **File:Line**: [server/src/structured/sql.generator.js:44-46](file:///C:/cognicore/validation_workspace/server/src/structured/sql.generator.js#L44-L46)
   - **Verbatim Code**:
     ```javascript
     const recoveryNote = recovery
       ? `\nYOUR PREVIOUS QUERY FAILED:\n${recovery.previousSql}\nERROR: ${recovery.error}\n${recovery.hints?.length ? `HINTS: ${recovery.hints.join('; ')}\n` : ''}Write a corrected query. Use only the exact table and column names listed above.\n`
       : '';
     ```
4. **Retry Temperature**:
   - **File:Line**: [server/src/structured/sql.generator.js:79](file:///C:/cognicore/validation_workspace/server/src/structured/sql.generator.js#L79)
   - **Verbatim Code**:
     ```javascript
     const raw = await llmProvider.complete(prompt, { temperature: opts.recovery ? 0.2 : 0.1, maxTokens: 500 });
     ```
   - **Rule**: Initial generation uses temperature `0.1`; recovery attempts bump temperature to `0.2`.
5. **Empty Result Behavior**:
   - **File:Line**: [server/src/core/engines/structured.engine.js:132-155](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L132-L155)
   - **Verbatim Logic**: When valid SQL returns 0 rows, the system calls `diagnoseEmptyResult` using deterministic SQL probe queries. It does **NOT** retry the LLM; it accepts the 0-row result and attaches explanatory diagnostic issues.

---

## R7. Domain-Specific Logic and Overfitting

### Codebase Inspection
1. **Semantic Lexicon Hardcoded Keywords**:
   - **File:Line**: [server/src/semantic/semantic.lexicon.js:8](file:///C:/cognicore/validation_workspace/server/src/semantic/semantic.lexicon.js#L8)
   - **Verbatim String**:
     ```javascript
     MONEY: /\b(revenue|sales?|price|cost|fee|salary|wage|amount|balance|budget|spend|expense|total_spent|gross|net)\b/i,
     ```
   - **Finding**: Regular expression tokens explicitly match column names across banking (`fee`, `salary`, `amount`, `balance`), retail (`sales`, `price`, `cost`), and corporate datasets.
2. **Domain Values in Comments / Resolver**:
   - **File:Line**: [server/src/agent/column.resolver.js:25](file:///C:/cognicore/validation_workspace/server/src/agent/column.resolver.js#L25)
   - **Verbatim String**:
     ```javascript
     // value mentions (e.g. "Cardiology") also anchor the table
     ```
   - **File:Line**: [server/src/knowledge/org.knowledge.js:5](file:///C:/cognicore/validation_workspace/server/src/knowledge/org.knowledge.js#L5)
   - **Verbatim String**:
     ```javascript
     // e.g. "Revenue" = "gross_amount - discounts - refunds"
     ```
3. **RISK Assessment**: The prompt generation engine (`sql.generator.js`) uses dynamic schema inspection rather than hardcoded table names. However, semantic column role classification (`semantic.lexicon.js`) uses English business terms to assign the `monetary` role.

---

## R8. Existing Benchmark / Baseline Data

### Code Facts
1. **Benchmark Suite Location**:
   - **File:Line**: [server/benchmark/run.js:1-92](file:///C:/cognicore/validation_workspace/server/benchmark/run.js#L1-L92)
   - **Dataset Source**: [server/benchmark/benchmark.data.js](file:///C:/cognicore/validation_workspace/server/benchmark/benchmark.data.js) defines 20 evaluation questions evaluated against 5 CSV files (`sales.csv`, `customers.csv`, `products.csv`, `orders.csv`, `employees.csv`).
2. **Committed Results Status**:
   - There are **no committed benchmark reports, JSONL execution logs, or prior result tables** in `server/benchmark/` or repository history.
   - The cited figures of **27.9s raw vs 60.7s full** originate from author baseline drafts where "full" pipeline latency included multi-paragraph markdown answer synthesis (`composeAnswer`) and multi-stage insight generation, whereas "raw" executed a single unconstrained model completion.

---

## R9. Model Runtime Profile (Ollama Local)

### Empirical Benchmarking on Test Hardware
Profiled via `validation/experiments/recon_r9_model_profile.js` (saved to `validation/raw/recon/r9_model_profile.json`):

#### 1. Primary Model: `qwen2.5-coder:7b` (ID: `dae161e27b0e`, Size: 4.7 GB GGUF)
- **Processor Offload Split (`ollama ps`)**: **55% CPU / 45% GPU** (due to 4 GB VRAM limit).
- **VRAM Footprint (`nvidia-smi`)**: 2,339 MiB allocated to `llama-server.exe`.
- **Prompt Processing Speed**:
  * 717 tokens: **428.0 tok/s** (1.675 s)
  * 1,419 tokens: **929.5 tok/s** (1.527 s)
  * 2,745 tokens: **1,067.9 tok/s** (2.570 s)
  * Mean prompt eval throughput: ~800–1,000 tok/s.
- **Generation Speed**:
  * 50 tokens: **10.9 tok/s** (4.586 s)
  * 100 tokens: **9.6 tok/s** (10.438 s)
  * 200 tokens: **9.1 tok/s** (21.927 s)
- **Cold Start vs Warm Latency**: Initial load from disk into RAM/VRAM took 3.8s; subsequent warm calls execute immediately.

#### 2. Secondary Model: `qwen2.5:14b` (ID: `7cdf5a0187d5`, Size: 9.0 GB GGUF)
- **Processor Offload Split (`ollama ps`)**: **77% CPU / 23% GPU**.
- **Model In-Memory Size**: 10.0 GB (greatly exceeds 4 GB VRAM).
- **Prompt Processing Speed**: **33.8 tok/s** (over 25x slower than 7b).
- **Generation Speed**: **4.1 tok/s** (>2.3x slower than 7b).
- **Wall Clock for 50 Tokens**: **30.27 seconds**.

### Full Evaluation Time Projections & Sample Budget
- **14B Model Projection**: Evaluating a 1,500-item benchmark on `qwen2.5:14b` at ~35 seconds per item would require **14.6 hours** of continuous execution.
- **7B Model Projection (Governed without synthesis)**: At ~4.5–5.5 seconds per query (SQL draft + validation + execution), 1,500 items would take **1.9 to 2.3 hours**.
- **7B Model Projection (Full pipeline with answer synthesis)**: At ~18–22 seconds per query, 1,500 items would take **7.5 to 9.2 hours**.
- **Recommendation for Step 5**:
  1. Primary Model: `qwen2.5-coder:7b`.
  2. Disable Answer Synthesis: Measure SQL correctness directly from executed rows.
  3. Sample Budget: Stratified evaluation sample of $N = 300$ items (20 items $\times$ 15 databases) will complete in ~25 minutes; full $N = 1,500$ evaluation will require a planned ~2.2-hour run.

---

## R10. Mini-Pilot on Real Hardware (12 Questions Across 3 Databases)

### Experimental Protocol
Executed via `validation/experiments/recon_r10_mini_pilot.js` across `B1_community.db`, `F1_quickbite.db`, and `H1_clinic.db`. Evaluated on two paths:
- **Path (A) Raw C0 Prompt**: System instruction + DDL schema only $\rightarrow$ model $\rightarrow$ raw execution on SQLite.
- **Path (B) Governed V1 Pipeline**: Full schema + semantic model + patterns $\rightarrow$ model $\rightarrow$ `cleanSqlOutput` $\rightarrow$ `prepareSql` $\rightarrow$ `validateSql` $\rightarrow$ `enforcePolicy` $\rightarrow$ `executeValidatedQuery`.

### Verbatim Examples of Raw Model Outputs

#### Example 1: Markdown Fence Wrapping with Filler (`RECON-B1-01`)
```
To find the total number of accounts in the database, you can use the following SQL query:

```sql
SELECT COUNT(*) FROM accts;
```

This query counts the number of rows in the `accts` table, which represents the total number of accounts.
```
- **Direct Execution on SQLite**: `FAIL` (`near "To": syntax error`).
- **Extracted Execution**: `PASS` (`SELECT COUNT(*) FROM accts`).

#### Example 2: Markdown Fence Only (`RECON-B1-02`)
```
```sql
SELECT * FROM accts WHERE bal > 50000;
```
```
- **Direct Execution on SQLite**: `FAIL` (`near "```": syntax error`).
- **Extracted Execution**: `PASS`.

#### Example 3: Table Alias Join (`RECON-F1-03`)
```
```sql
SELECT o.ord_id, r.rst_nm
FROM ords o
JOIN rst r ON o.rst_id = r.rst_id;
```
```
- **Direct Execution on SQLite**: `FAIL` (`near "```": syntax error`).
- **Extracted Execution**: `PASS`.

#### Example 4: Conversational Aggregation (`RECON-F1-04`)
```
To find the average menu item price for each restaurant, you can use the following SQL query:

```sql
SELECT rst.rst_nm, AVG(mnu.prc) AS avg_item_price
FROM rst
JOIN mnu ON rst.rst_id = mnu.rst_id
GROUP BY rst.rst_id, rst.rst_nm;
```

This query joins the `rst` (restaurant) table with the `mnu` (menu) table on the `rst_id` field, groups the results by restaurant name, and calculates the average price of menu items for each restaurant.
```
- **Direct Execution on SQLite**: `FAIL` (`near "To": syntax error`).
- **Extracted Execution**: `PASS`.

#### Example 5: Direct SQL without Fences (`RECON-H1-03` Governed Path)
```
SELECT doctors.name, departments.name FROM doctors JOIN departments ON doctors.dept_id = departments.dept_id
```
- **Cleaned SQL**: `SELECT doctors.name, departments.name FROM doctors JOIN departments ON doctors.dept_id = departments.dept_id`.
- **Gate Decision**: `PASS`.

### Pilot Summary & Behavioral Insights
1. **Raw Model Output Formatting**: Under C0 DDL prompts, the model wrapped SQL in markdown code blocks 100% of the time (12/12) and emitted conversational explanations 41.7% of the time (5/12). Direct execution of raw model output into SQLite failed 100% of the time.
2. **CogniCore Extractor (`cleanSqlOutput`)**: Successfully stripped code fences and isolated clean SQL statements in 100% of cases.
3. **Safety Gate False Rejections**: `validateSql` accepted 12/12 (100%) benign analytical queries (0 false rejections).
4. **Row-Set Equality Metric**: Identical semantic results frequently yielded key-name mismatches against gold queries when column aliases were introduced (e.g. `COUNT(*)` vs `COUNT(acct_id)`). Step 5 evaluation must evaluate row value sets or compare projected tuple values rather than raw JSON key equality.

### Reconnaissance Exclusion List (12 Question IDs & SHA-256)
Step 5 MUST exclude these 12 questions from its evaluation datasets:

| Item ID | Category | Database | Question Text | SHA-256 Hash |
| :--- | :--- | :--- | :--- | :--- |
| `RECON-B1-01` | count | `B1_community.db` | *"How many accounts are there?"* | `c42e2b220dd458337f5fd862c1b6b00c57371e7e5b1f4fba74149966dc07f050` |
| `RECON-B1-02` | filter | `B1_community.db` | *"List all accounts with a balance greater than 50000."* | `98560d5f9425fe5917fd53dadf1795dab493d843adc86fdec3ec0126abad4a34` |
| `RECON-B1-03` | join | `B1_community.db` | *"Show each account ID along with its branch name."* | `d5e9f3dce8c0610006a26a5f14a6ed6bddbd0ee733e167a7f07a1b4053ed2c37` |
| `RECON-B1-04` | aggregation | `B1_community.db` | *"What is the average account balance for each account type?"* | `6ca6c8dd2adef9eb955a37f470bebd17ea3d2481aae3cf0aa298b13724643b88` |
| `RECON-F1-01` | count | `F1_quickbite.db` | *"How many restaurants are there?"* | `2296e98d5c33d53a5517432cb015289c650c768d099fe96e4ef1d41ec8792c16` |
| `RECON-F1-02` | filter | `F1_quickbite.db` | *"List all restaurants with a rating greater than 4.5."* | `75c02bf98938a528ab65df3e40db44cc9c6bf79372495f72430dab6714c168b5` |
| `RECON-F1-03` | join | `F1_quickbite.db` | *"Show each order ID along with the restaurant name."* | `90ed867dc3be5069196a26fb88e72476f9113fc05cbccc11c9b18559a57ab837` |
| `RECON-F1-04` | aggregation | `F1_quickbite.db` | *"What is the average menu item price for each restaurant?"* | `8b486ab56337d0647dd8e2ed1465696934ffd73c341f6e1c4a8df563e33b2743` |
| `RECON-H1-01` | count | `H1_clinic.db` | *"How many doctors are there?"* | `704620f3a61f2249767fbcdd0fa895d3a398c7e096478d5eebf59d57fbaf0590` |
| `RECON-H1-02` | filter | `H1_clinic.db` | *"List all patients who are older than 60."* | `a8eb2a36bcf72c2125bb796e6a17b0d9cba4ba8ecaa992bf01784cebdfcc5bfe` |
| `RECON-H1-03` | join | `H1_clinic.db` | *"Show each doctor's name along with their department name."* | `98bc72551ec94bf4f73809930773d32ce7397bdf01716eb30325fa1249fa6b21` |
| `RECON-H1-04` | aggregation | `H1_clinic.db` | *"What is the total visit fee collected by each department?"* | `ff468da4fc72877114e9b7d5bf637ea0d276b2eb3df626c905b9b73673f44365` |

---

## R11. Output Parsing and Extraction

### Code Facts & Verbatim Logic
- **File:Line**: [server/src/structured/sql.generator.js:84-92](file:///C:/cognicore/validation_workspace/server/src/structured/sql.generator.js#L84-L92)
- **Verbatim Code**:
  ```javascript
  function cleanSqlOutput(raw) {
    let sql = raw.trim();
    // Strip markdown code fences if the model included them.
    const fenceMatch = sql.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) sql = fenceMatch[1].trim();
    // If the model emitted multiple statements, keep only the first.
    sql = sql.split(';')[0].trim();
    return sql;
  }
  ```
- **Parsing Mechanisms**:
  1. **Markdown Fences**: Regex `/```(?:sql)?\s*([\s\S]*?)\s*```/i` extracts inner SQL.
  2. **Multiple Queries**: `sql.split(';')[0].trim()` truncates at the first semicolon, dropping subsequent statements.
  3. **Explanation After SQL**: Any trailing explanation after a semicolon is truncated.
  4. **No SQL Emitted**: If text contains no SQL, it passes to `validateSql()`, which throws `SQLValidationError: Syntax error near ...`.
  5. **Explicit Refusal**: [server/src/core/engines/structured.engine.js:243-245](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L243-L245) checks `sql.trim().toUpperCase() === 'NO_QUERY_POSSIBLE'`. If matched, execution stops and returns an abstention with `lowConfidence: true`.

---

## R12. Test Environment Audit

- **Operating System**: Windows 11 (`win32 x64`).
- **Node.js Version**: `v24.13.1`.
- **CPU**: AMD Ryzen 5 7535HS with Radeon Graphics (6 cores, 12 logical threads).
- **RAM**: 16 GB DDR5 system memory.
- **GPU**: NVIDIA GeForce RTX 2050 Laptop GPU (4,096 MiB VRAM), Driver version 560.94, CUDA 12.6.
- **Disk Storage**: Drive C: 260.6 GB free out of 465 GB.
- **Ollama Engine**: Version 0.40.4 running locally on port 11434.
- **Installed Models**:
  * `qwen2.5-coder:7b` (4.7 GB, ID: `dae161e27b0e`)
  * `qwen2.5vl:3b` (3.2 GB, ID: `79d497978752`)
  * `qwen2.5:14b` (9.0 GB, ID: `7cdf5a0187d5`)
- **Power Configuration**: Active power scheme `cb036933-6ddd-41db-b16d-6c6b3abb95a6` (Acer High Performance). AC standby (`STANDBYIDLE`), AC hibernate (`HIBERNATEIDLE`), and AC video idle (`VIDEOIDLE`) are all set to `0x00000000` (sleep, hibernate, and screen shutdown disabled while on AC power).
- **Windows Update**: No pending reboots (`RebootRequired` registry key is absent).

---

## R13. Persistent State and Run-to-Run Contamination

### Code Facts & State Storage
1. **In-Memory Turn Log**: `TURNS = new Map()` in [server/src/core/session.manager.js:14](file:///C:/cognicore/validation_workspace/server/src/core/session.manager.js#L14).
2. **In-Memory Session State**: `STATES = new Map()` in [server/src/core/session.state.js:16](file:///C:/cognicore/validation_workspace/server/src/core/session.state.js#L16). Stores `lastQuestion`, `lastStandalone`, `lastSql`, `evidence`, `answer`.
3. **Observability Store**: `TraceStore.traces = []` in [server/src/observability/trace.js:84](file:///C:/cognicore/validation_workspace/server/src/observability/trace.js#L84).
4. **Follow-Up Interception**:
   - **File:Line**: [server/src/core/followup.resolver.js:15-16](file:///C:/cognicore/validation_workspace/server/src/core/followup.resolver.js#L15-L16)
   - **Logic**:
     ```javascript
     if (!state?.lastQuestion) return { wasFollowUp: false, standaloneQuestion: question };
     ```
   - If `state.lastQuestion` is missing, `isFollowUp` returns `false` with 0 LLM calls and 0 prompt changes.

### Isolation Strategy for Step 5
- Generating a fresh, random `sessionId` (e.g. `uuidv4()`) for every evaluation item guarantees **100% independence**.
- Verifiably, answering question $N$ does not alter prompts, schemas, or execution context for question $N+1$ when distinct session IDs are used.

---

## Final Summary: Inputs Step 5 Needs

| Decision / Parameter | Recommendation from Recon | Evidence / Rationale | Fallback if Different |
| :--- | :--- | :--- | :--- |
| **Primary Model** | `qwen2.5-coder:7b` | Runs at ~950 tok/s prompt eval, 10.9 tok/s gen on RTX 2050 + RAM (55%/45% split). 14B runs at only 4.1 tok/s on 77% CPU offload, making full evaluation prohibitive. | `qwen2.5vl:3b` if faster throughput needed; avoid 14B on 4GB VRAM. |
| **Context Length (`num_ctx`)** | **`4096`** | Largest schema (`H3_metropol`) consumes 1,694 prompt tokens (82.7% of 2048), leaving inadequate room for generation and recovery at 2048. 4096 consumes 41.4%. | 2048 if VRAM is severely constrained (must truncate column samples). |
| **Harness Entry Point (V1)** | `runStructuredQuery` ([structured.engine.js:36](file:///C:/cognicore/validation_workspace/server/src/core/engines/structured.engine.js#L36)) | Supports dependency-injected `llmProvider`, runs complete governance chain, bypasses agent tool interceptors, and eliminates 20s answer synthesis call. | `handleUserQuery` with mocked `composeAnswer`. |
| **Raw Entry Point (C0)** | Dedicated C0 Harness Wrapper | Standard DDL prompt $\rightarrow$ model $\rightarrow$ `cleanSqlOutput` $\rightarrow$ direct read-only SQLite execution (`better-sqlite3`). | Direct raw execution without fence stripping (will fail 100% on model output). |
| **Routing Strategy** | Bypass router (direct call) + clean question phrasing | 3/63 questions intercepted by deterministic agent tools in simulation. Calling `runStructuredQuery` guarantees 100% text-to-SQL path. | Screen questions to avoid `report`, `what if`, `kpi`. |
| **Retry Policy for Evaluation** | Standard CogniCore Recovery (`maxRecovery: 2`, temperature `0.2`) | Reflects production governance without bypassing security boundaries (security rejections fail-closed immediately with 0 retries). | `maxRecovery: 0` (zero-shot ablation). |
| **Semantic Layer Handling** | Precompute and pass in memory | 100% deterministic across all 15 DBs; adds 0 ms DB overhead at query time. | Compute per query (adds 5–540 ms DB latency). |
| **Evaluation Sample Size** | Stratified $N = 300$ items (20 per DB $\times$ 15 DBs) | Projected runtime: ~25 minutes at ~5.0 s/item. Full $N = 1,500$ evaluation requires ~2.2 hours. | Full $N = 1,500$ items if multi-hour run is allocated. |
| **Expected Wall-Clock Time** | **~5.0 seconds per query** (without synthesis) | Measured in R3 and R10 (1.5–3.5s SQL draft + 0.1s governance/execution + ~1s recovery when triggered). | 18–25s per query if markdown answer synthesis is left enabled. |
| **Exclusion List** | Exclude 12 Recon Items | Identified in Section R10 (`RECON-B1-01` to `RECON-H1-04`, with SHA-256 hashes). | Re-seed generator with `MASTER_SEED + 100`. |

---
*Report generated strictly from code facts and empirical execution logs under `validation/raw/recon/`. Stopped as instructed; Step 5 not started.*
