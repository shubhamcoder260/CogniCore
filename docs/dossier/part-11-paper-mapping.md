# PART 11 — ACADEMIC PAPER MAPPING

This chapter provides the factual foundation for the *System Design*, *Methods*, and *Evaluation* chapters of a research paper evaluating CogniCore.

---

## 1. Core Technical Contributions

The codebase demonstrates several notable, research-grade engineering contributions:

1. **Decoupled Semantic Translation and Deterministic Verification**:
   The LLM is treated as an untrusted semantic compiler rather than an oracle or calculator. It drafts candidates, but execution, mathematical aggregation, policy enforcement, and numeric grounding are governed entirely by deterministic code (Rules #6, #7, #8).
2. **Multi-Stage Algorithmic SQL Auto-Repair**:
   Rather than paying the latency and token cost of LLM re-prompting for common syntax and schema mistakes, CogniCore runs six (6) deterministic token-level repair heuristics (singular/plural tables, missing `FROM`, integer division float promotion, Levenshtein column matching, aggregate `GROUP BY` injection, and categorical literal casing).
3. **Transparent Zero-Trust Policy Enforcement via CTE Shadowing**:
   Row-level security (RLS) is applied at the query layer by shadowing base physical tables with Common Table Expressions (CTEs) of identical names. This ensures that joins, subqueries, and table references automatically resolve to filtered records without complex AST rewriting of predicate logic.
4. **Post-Synthesis Numeric Grounding & Contradiction Replacement**:
   The response layer tokenizes every numeric value in the model's natural language synthesis, verifying that each value exists in the underlying SQL evidence. Hallucinations or unwarranted claims of insufficient data trigger an immediate, deterministic tabular fallback (`buildDeterministicAnswer`), preventing fabricated facts from reaching the user.
5. **Structure-Aware Document Retrieval & Hybrid Reranking**:
   Document chunking preserves section headings, and a model-free hybrid reranker combines dense embedding cosine similarity, BM25-style lexical matching, and section title boosts, accompanied by proactive sanitization of untrusted text.

---

## 2. Measurable Empirical Metrics

A researcher can systematically evaluate CogniCore by measuring the following metrics across benchmark runs:

1. **Auto-Repair Invocation Rate ($R_{repair}$)**:
   $$\frac{\sum \text{repairs}}{\text{Total Structured Queries}}$$
   Categorized by repair type: `table_name`, `column_name`, `missing_from`, `missing_group_by`, `integer_division`, `value_literal`. (Receipt: `server/src/core/engines/structured.engine.js:213-241`).
2. **Refusal Recovery Rate ($R_{refusal\_rec}$)**:
   Percentage of queries where an initial small-model `NO_QUERY_POSSIBLE` refusal was successfully converted into a valid executed query on the bounded retry attempt. (Receipt: `server/src/core/engines/structured.engine.js:64-68`).
3. **Error Recovery Success Rate ($R_{recovery}$)**:
   Fraction of queries failing initial validation or execution that successfully recover within 1–2 LLM correction attempts. (Receipt: `server/src/core/engines/structured.engine.js:108-129`).
4. **Numeric Grounding Violation Rate ($R_{grounding}$)**:
   Frequency with which natural language explanations introduce ungrounded numbers or contradict evidence, requiring deterministic replacement. (Receipt: `server/src/guardrails/answer.grounding.js:41-55`).
5. **Execution Latency Breakdown ($\Delta t_i$)**:
   Fine-grained time attribution per stage recorded in `Trace.steps[i].ms` (Input Screening, Routing, Generation, Validation, Policy, Execution, Synthesis). (Receipt: `server/src/observability/trace.js:28-36`).
6. **AST Security Block Rate**:
   Percentage of candidate queries rejected by the blocked keyword gate, multiple statement check, or SQL comment filter. (Receipt: `server/src/structured/sql.validator.js:74-88`).

---

## 3. Five Key Design Decisions to Cite in Methods

### Decision 1: Pure-Code Deterministic Auto-Repair vs LLM Re-Prompting
- **Choice**: Implemented 6 token-level repair heuristics in plain JavaScript (`server/src/core/engines/structured.engine.js:212`).
- **Alternative Rejected**: Re-prompting the LLM with compiler error messages for every minor syntax or spelling mistake.
- **Rationale**: Eliminates unnecessary round-trip LLM latency (saving 1.5–5.0 seconds per query), reduces inference costs, and ensures 100% predictable corrections toward real schema entities.

### Decision 2: CTE Shadowing for Row-Level Security vs AST Predicate Rewriting
- **Choice**: Prepending filtered Common Table Expressions with the same name as the base table: `WITH "<t>" AS (SELECT * FROM main."<t>" WHERE <cond>) <query>` (`server/src/security/data.policy.js:117-124`).
- **Alternative Rejected**: Traversing the AST to inject `AND (<filter>)` into every existing `WHERE` and `JOIN ON` clause.
- **Rationale**: AST predicate injection is vulnerable to operator precedence bugs, subquery escapes, and complex outer join bypasses. CTE shadowing isolates the entire base table at the scoping root.

### Decision 3: In-Memory SQLite Vector Storage vs External Vector Database
- **Choice**: Storing vectors as serialized JSON arrays in SQLite and computing brute-force cosine similarity in JavaScript (`server/src/documents/vector.store.js:73-97`).
- **Alternative Rejected**: Deploying and managing a dedicated vector store (e.g. Pinecone, Qdrant, Chroma).
- **Rationale**: Preserves the zero-dependency, local-first deployment invariant (Rule #29). Eliminates external cloud dependencies and network configuration for departmental workloads ($<10,000$ chunks).

### Decision 4: PostgreSQL AST Grammar for SQLite Queries
- **Choice**: Parsing SQLite, CSV, and Excel queries using `node-sql-parser` configured with `database: 'postgresql'` (`server/src/structured/sql.validator.js:50-57`).
- **Alternative Rejected**: Using `node-sql-parser`'s native `'sqlite'` grammar.
- **Rationale**: The library's `'sqlite'` parser fails on common, valid SQL constructs (such as scalar subqueries in `WHERE` clauses). The PostgreSQL grammar parses these correctly while maintaining identical double-quoted identifier conventions. Physical execution still occurs against SQLite via `better-sqlite3`.

### Decision 5: Hard Denial of MySQL Row Filtering vs Incomplete Enforcement
- **Choice**: Throwing a hard `PolicyError (403)` when row-level filtering is attempted on MySQL connections (`server/src/security/data.policy.js:108`).
- **Alternative Rejected**: Attempting partial regex or view injection on MySQL.
- **Rationale**: MySQL does not support recursive CTE table name shadowing without qualification syntax conflicts. Rather than risking data leakage, the system strictly fails closed.

---

## 4. Codebase Limitations to Acknowledge

1. **Vector Store Scaling Ceiling**:
   Because similarity search relies on a linear $O(N \cdot D)$ scan and JSON deserialization in Node.js memory (`server/src/documents/vector.store.js:74-82`), document retrieval latency degrades linearly when chunk counts exceed 50,000.
2. **Unpruned Schema Injection**:
   `buildSchemaDescription()` (`server/src/structured/sql.generator.js:14-22`) serializes all tables in `schema.tables` into the prompt. For enterprise databases with 50+ tables, schema DDL consumes thousands of context tokens, risking context overflow in smaller local LLMs.
3. **Heuristic Input Guardrail Evasion**:
   The input guardrail relies on regex phrase matching (`server/src/guardrails/input.guard.js:9-20`). Sophisticated semantic jailbreaks, non-English adversarial prompts, or Base64 encodings can bypass string screening (relying entirely on downstream AST gates for safety).
4. **Single-Node In-Memory Rate Limiting**:
   The sliding-window rate limiter stores hit buckets in process memory (`server/src/guardrails/rate.limit.js:5`), resetting on restarts and failing to synchronize across horizontal cluster replicas.

---

## 5. Topic Keywords for Related Work Search

- `Natural language to SQL`
- `Text-to-SQL benchmark evaluation`
- `LLM hallucination detection`
- `Numeric grounding in generative AI`
- `Fail-closed AI guardrails`
- `Row-level security in Text-to-SQL`
- `Common Table Expression query rewriting`
- `Small language models for enterprise BI`
- `Local-first retrieval augmented generation`
- `Hybrid dense-lexical reranking`

---

## 6. Descriptions for Three Paper Figures

### Figure 1: The CogniCore Fail-Closed Pipeline Architecture
- **Type**: Architectural Flowchart.
- **Description**: Depicts a natural language query entering the system at the top. The query passes sequentially through:
  1. *Input Guardrails* (Regex Filter: Blocked $\rightarrow$ Terminate).
  2. *Intent Classification & Routing* (Routes to Agent, Report, Document, Hybrid, or Structured).
  3. *SQL Generation* (LLM creates candidate SQL).
  4. *Deterministic Auto-Repair* (6 AST/token transformations applied in series).
  5. *SQL AST Validation & Complexity Gate* (node-sql-parser: syntax, keyword blocklist, fan-out check).
  6. *Data Policy Enforcement* (CTE Shadowing injection).
  7. *Read-Only Query Execution* (Capped by outer `LIMIT` subquery).
  8. *Execution Verification & Empty Diagnosis* (Semantic checks and value probing).
  9. *Answer Synthesis & Grounding Verification* (Grounding check replaces hallucinated prose with deterministic table).
- Highlight in red: The four (4) hard fail-closed exit gates that reject queries without executing arbitrary mutations.

### Figure 2: The 6-Stage Deterministic SQL Repair Pipeline
- **Type**: Pipeline Stage Diagram.
- **Description**: Illustrates a malformed candidate query passing through the six serial transformation filters in `prepareSql()`:
  - Input: `SELECT department_id, COUNT(*) / COUNT(*) * 100 AS pct, salaryy FROM employees WHERE status = 'cancelled'`
  - Box 1 (`table_name`): Normalizes `employees` $\rightarrow$ `employee`.
  - Box 2 (`missing_from`): Ensures `FROM` clause exists (skipped, already present).
  - Box 3 (`column_name`): Levenshtein matches `salaryy` $\rightarrow$ `salary`.
  - Box 4 (`missing_group_by`): Injects `GROUP BY department_id` between `FROM` and `WHERE`.
  - Box 5 (`integer_division`): Scans backward from `/`, injecting `1.0 * ` before `COUNT(*)`.
  - Box 6 (`value_literal`): Replaces `'cancelled'` with measured database casing `'Cancelled'`.
  - Output: Repaired, mathematically correct, schema-compliant SQL query.

### Figure 3: Common Table Expression (CTE) Shadowing for Zero-Trust RLS
- **Type**: Conceptual Query Scoping Diagram.
- **Description**: Demonstrates how a low-privilege user's query is sandboxed without modifying the user's `WHERE` clause:
  - Upper Box: Physical SQLite database containing table `patients` (10,000 rows across all departments).
  - Middle Box: CTE View definition:
    `WITH "patients" AS (SELECT * FROM main."patients" WHERE "department_id" = 'cardiology')`
  - Lower Box: The user's original query:
    `SELECT diagnosis, COUNT(*) FROM patients GROUP BY diagnosis`
  - Visual Arrow: Shows that the query's `patients` identifier is captured by the CTE scope, completely isolating the physical table. Any Cartesian join or subquery executed by the user is physically unable to access rows outside `cardiology`.
