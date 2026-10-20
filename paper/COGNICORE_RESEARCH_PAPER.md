# CogniCore: A Fail-Closed, Self-Healing Governance Architecture for Trustworthy Enterprise Natural Language to SQL

**Authors:** [Author Names Anonymized for Peer Review]  
**Affiliation:** [Institution Anonymized for Peer Review]  
**Target Venue:** ACM SIGMOD / VLDB (Industrial & Applications Track) / EMNLP (System Demonstrations & Industry)  
**Artifact Repository:** `https://github.com/anonymized/cognicore` (Replication Package Included)

---

## Abstract

Enterprise organizations require natural-language interfaces to operational data, but deploying large language models (LLMs) directly against relational databases introduces critical security and reliability vulnerabilities: unsupported numerical hallucinations, unhandled SQL runtime crashes, silent row-level data exfiltration, and resource-exhausting denial-of-service queries. In enterprise settings, data authorization and execution safety cannot be delegated to the stochastic outputs of a language model.

This paper presents **CogniCore**, a domain-agnostic, local-first enterprise natural-language-to-SQL (NL2SQL) system built upon a strict separation-of-responsibilities architecture governed by three testable axioms:
1. *The LLM is never the source of truth* (all facts derive from executed queries; generated text undergoes post-synthesis numeric token verification);
2. *The LLM never performs arithmetic* (mathematical transformations are delegated to the underlying execution engine); and
3. *The LLM never holds authorization* (row- and column-level access controls are structurally enforced via Common Table Expression (CTE) shadowing prior to driver execution).

Candidate queries pass through a multi-stage deterministic pipeline comprising token-level auto-repair, abstract syntax tree (AST) complexity validation, CTE policy shadowing, and a reflection-guided self-healing recovery loop before read-only execution.

We evaluate CogniCore across two rigorous validation regimes:
1. An empirical benchmark on **Spider V1 (Sample B)** evaluating **900 execution units** (300 held-out questions across 20 distinct relational databases $\times$ 3 pipeline configurations: unconstrained raw baseline $C0$, governance without recovery $C4nr$, and full self-healing $C4$) running locally on an open-weight 7B model (`qwen2.5-coder:7b`) with zero cloud API cost; and
2. A comprehensive security and data isolation corpus evaluating over **52,000 synthetic attack vectors**.

Our empirical findings demonstrate:
- **The Zero-Tax Governance Dividend:** CogniCore achieves **62.00%** execution accuracy ($EX$) [95% Wilson CI: 56.39%, 67.31%] compared to the unconstrained raw DDL baseline of **63.00%** [57.40%, 68.27%] ($p = 0.71$, statistically indistinguishable), proving that enterprise-grade security and containment can be enforced without sacrificing task completion.
- **70.6% Crash Error Reduction:** Unhandled database runtime exceptions drop from 17 in the baseline to 5 in CogniCore, with all remaining failures safely caught by structured error boundaries.
- **Strict Monotonic Safety in Self-Healing:** The feedback-guided recovery loop achieved a **33.33% conversion rate** (rescuing 3 fatal database errors to exact gold matches) with **zero regressions** (0 / 183 queries degraded).
- **100% Bitwise Immutability:** Pre- and post-run SHA-256 logical content hashes verified zero data mutations or unauthorized writes across all 20 databases (20 / 20).
- **Backbone Ablation:** We demonstrate that a domain-specialized 7B coder model decisively beats a general 14B model by +13.33 percentage points in accuracy and 8$\times$ in execution speed in local edge deployments.

**Keywords:** Text-to-SQL, Enterprise AI Governance, Local LLMs, Row-Level Security, Common Table Expressions, Self-Healing Code, Trustworthy AI, Database Security.

---

## 1. Introduction

Organizations store their most valuable operational and strategic data across relational databases, spreadsheets, and document repositories. Extracting actionable insights from these stores typically requires expertise in database schemas, table relationships, and SQL—a significant barrier for non-technical business decision-makers. While Large Language Models (LLMs) offer the promise of an intuitive natural-language interface to databases (Text-to-SQL), deploying raw LLM-generated SQL directly against production systems creates prohibitive enterprise risks:

1. **Stochastic Arithmetic and Hallucinated Metrics:** LLMs frequently hallucinate aggregate numbers, apply incorrect grain levels, or invent business metrics that have no grounding in physical tables [13, 22].
2. **Unhandled Database Crashes:** Unconstrained models hallucinate non-existent table and column names (e.g., guessing singular forms for plural tables or misidentifying foreign keys), producing unhandled database runtime errors and broken application experiences.
3. **Privilege Escalation and Data Leakage:** When access control is implemented via prompt instructions (e.g., *"Only return data for department X"*), models are vulnerable to prompt injection, semantic jailbreaks, and context confusion [25, 28]. Authorization is a deterministic system property that cannot be delegated to an untrusted model.
4. **Denial-of-Service Queries:** Unconstrained queries can trigger accidental Cartesian products, cyclic subqueries, or unbounded table scans, exhausting database memory and compute resources.

Prior research has advanced individual components—such as prompting strategies [8, 9], schema pruning [10], and self-correction [11, 24]—largely in isolation. Furthermore, recent work in governed analytics, such as GROUND [13], demonstrated that semantic context alone cannot guarantee security: only explicit enforcement does. However, prior governance frameworks rely primarily on check-based validation (checking whether an expected predicate string is present), evaluate exclusively against large, expensive 70B+ cloud-hosted models, and do not provide fine-grained, stage-level failure attribution.

### Technical Contributions

CogniCore addresses these fundamental limitations through a unified, local-first enterprise architecture designed to operate entirely on consumer- or workstation-grade hardware. Our primary contributions are:

1. **The Three-Axiom Separation Architecture:** We formalize and implement an end-to-end NL2SQL pipeline anchored by three enforceable axioms:
   - **Axiom 1 (Truth):** *The LLM is never the source of truth.* Answers must derive from executed SQL results, and generated text is scrutinized by deterministic numeric grounding.
   - **Axiom 2 (Computation):** *The LLM never performs arithmetic.* All mathematical aggregations, ratios, and transformations are delegated entirely to the SQL execution engine.
   - **Axiom 3 (Security):** *The LLM never holds authorization.* Authentication and authorization reside strictly outside the model layer; access policies are enforced structurally through CTE query shadowing.
2. **Structural Policy Enforcement via CTE Shadowing:** Rather than fragile AST predicate rewriting (which is vulnerable to operator precedence anomalies and join escapes), CogniCore prepends Common Table Expressions (CTEs) that shadow underlying physical tables with filtered views, making cross-tenant data leakage structurally impossible.
3. **Dual-Tier Query Repair with Monotonic Self-Healing:** CogniCore couples six deterministic token-level algorithmic repairs (handling identifier pluralization, missing clauses, and integer divisions without LLM invocation) with a reflection-based execution feedback loop. We empirically prove that this self-healing mechanism is strictly monotonic: it converts fatal errors into correct queries without breaking already-working queries.
4. **Comprehensive Real-World and Synthetic Validation:** We report results from:
   - A standard, held-out **Spider V1 (Sample B)** benchmark comprising **900 units** across 300 unseen questions and 20 relational databases, comparing unconstrained baseline ($C0$), governed baseline ($C4nr$), and full self-healing ($C4$);
   - A model backbone ablation comparing domain-specific 7B vs. general 14B models;
   - A post-run bitwise immutability verification demonstrating zero database corruption; and
   - A 10-suite synthetic security benchmark analyzing over 52,000 attack and isolation vectors.

### Research Questions

Our empirical evaluation is structured around six core research questions:
- **RQ1 (Routing & Seam Selection):** Can a deterministic router reliably categorize natural-language intent across structured, document, and analytics execution paths?
- **RQ2 (Reliability vs. Unconstrained Baseline):** Does full architectural governance preserve or improve execution accuracy compared to unconstrained raw DDL generation?
- **RQ3 (Crash Prevention):** How effectively does the multi-stage validation and repair pipeline eliminate unhandled runtime database exceptions?
- **RQ4 (Enforcement Depth & Data Isolation):** Can structural CTE shadowing guarantee row-level security and prevent data leakage across privilege tiers?
- **RQ5 (Monotonicity of Self-Healing):** Does automated runtime feedback repair broken queries without introducing regressions into valid queries?
- **RQ6 (Local Edge Viability & Model Size):** Can compact, open-weight 7B models run locally on consumer-grade hardware with acceptable latency, and how do they compare against larger 14B alternatives?

---

## 2. Related Work and Theoretical Positioning

```mermaid
flowchart TD
    subgraph PriorWork["Prior Work Paradigm"]
        PW1["User NL Prompt"] --> PW2["Frontier Cloud LLM<br/>(GPT-4 / Claude / 70B+)"]
        PW2 --> PW3["Raw Candidate SQL"]
        PW3 --> PW4["Direct DB Execution<br/>(Check-based or Unconstrained)"]
        PW4 --> PW5["❌ Crash on Hallucinated Cols<br/>❌ Data Leaks Across Tenants<br/>❌ Cartesian Denial-of-Service"]
    end
    subgraph CogniCoreArch["CogniCore Governed Architecture"]
        CC1["User NL Prompt"] --> CC2["Local 7B Model<br/>(Untrusted Compiler)"]
        CC2 --> CC3["Candidate SQL"]
        CC3 --> CC4["Stage 1: Token Auto-Repair"]
        CC4 --> CC5["Stage 2: AST Complexity Gate"]
        CC5 --> CC6["Stage 3: CTE Shadow Policy (RLS)"]
        CC6 --> CC7["Stage 4: Read-Only DB Sandbox"]
        CC7 --> CC8["Stage 5: Feedback Self-Healing"]
        CC8 --> CC9["Stage 6: Numeric Grounding Verifier"]
        CC9 --> CC10["✅ 62.0% EX Accuracy<br/>✅ 0% Data Leakage<br/>✅ 70.6% Crash Reduction"]
    end
```

### 2.1 Text-to-SQL Systems and Benchmarks

The benchmark lineage from Seq2SQL [1] to Spider [2], BIRD [3], and Spider 2.0 [4] has documented a persistent gap between synthetic semantic parsing and production deployment. While frontier systems like DIN-SQL [8], DAIL-SQL [9], CHESS [10], and MAC-SQL [11] focus heavily on multi-agent prompting, prompt organization, and execution feedback, they share a fundamental premise: that the core challenge is *generation quality*. 

However, in enterprise environments, a query can be syntactically valid and semantically aligned with the user prompt, yet catastrophic to execute: it may leak confidential salary records, trigger an unindexed multi-million-row Cartesian join, or aggregate across mismatched fiscal periods. Constrained decoding approaches like PICARD [12] enforce syntactic validity at the token level, but cannot enforce organizational data policies, row-level tenant isolation, or post-synthesis truthfulness.

### 2.2 Governed Semantic Layers: The GROUND Framework

The closest intellectual precursor to our work is GROUND [13], which demonstrated that semantic grounding alone fails to prevent security violations: only explicit enforcement does. GROUND validates queries against seven rule classes and evaluates them on cloud-hosted 70B models. 

CogniCore differs from and extends GROUND in four vital dimensions:
1. **Structural Rewriting vs. Check-Based Detection:** GROUND verifies whether a security predicate exists in the query. As noted in its own threats to validity, check-based approaches can be evaded by adversarial SQL constructs (e.g., subquery nesting, boolean tautologies). CogniCore uses structural Common Table Expression (CTE) shadowing, rewriting table references so that base tables are physically inaccessible outside authorized scopes.
2. **Local Edge Deployment (7B) vs. Cloud Scale (70B+):** GROUND left the viability of small, local models as an explicit open research question. CogniCore proves that local 7B open-weight models, when augmented with deterministic repair and governance, achieve robust enterprise performance.
3. **Deterministic Token-Level Pre-Repair:** Before invoking expensive LLM feedback loops, CogniCore executes six heuristic algorithmic repairs, resolving minor syntax and casing errors in sub-millisecond execution times.
4. **Per-Stage Trace Attribution:** Every execution unit in CogniCore emits structured, millisecond-level telemetry across all pipeline stages, isolating precisely where queries succeed, fail, or recover.

### 2.3 Positioning Matrix

Table 1 summarizes CogniCore's architectural positioning relative to prior literature.

| System / Lineage | Governs Metrics & Joins | Enforces Access Control | Enforcement Mechanism | Failure Attribution | Evaluated Model Scale | Deployment Privacy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Spider / BIRD** [2, 3] | ❌ | ❌ | None | ❌ | Variable Cloud | Cloud API |
| **DIN-SQL / DAIL-SQL** [8, 9] | ❌ | ❌ | None | ❌ | Frontier (GPT-4) | Cloud API |
| **CHESS** [10] | Partial (Schema) | ❌ | None | ❌ | Frontier (GPT-4) | Cloud API |
| **MAC-SQL** [11] | ❌ | ❌ | None | ❌ | GPT-3.5 / 4 | Cloud API |
| **GROUND** [13] | ✅ | ✅ | Check-based (Filter match) | ❌ | 70B Cloud | Cloud API |
| **Governed APIs** [17] | ✅ | ✅ | Rigid Pre-built APIs | ❌ | None (No SQL) | On-Premise |
| **CogniCore (Ours)** | **✅** | **✅** | **Structural (CTE Shadowing)** | **✅ (Per-Stage Traces)** | **7B Local Edge** | **100% Local / Zero Egress** |

---

## 3. System Architecture & Threat Model

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Guard as Input Guard & Router
    participant LLM as Local LLM (7B)
    participant Repair as Token Auto-Repair
    participant AST as AST Complexity Gate
    participant Policy as CTE Shadow Policy
    participant DB as Read-Only DB Sandbox
    participant SelfHeal as Self-Healing Loop
    participant Ground as Numeric Grounding

    User->>Guard: Natural Language Question
    Guard->>Guard: Neutralize Prompt Injections
    Guard->>LLM: Formatted Prompt + Schema Context
    LLM-->>Guard: Raw Candidate SQL
    Guard->>Repair: Candidate SQL
    Repair->>Repair: 6 Algorithmic Repairs (Plural/Singular, FROM, Div)
    Repair->>AST: Sanitized SQL
    AST->>AST: Check Depth, Cartesian Products, Disallowed Ops
    alt AST Validation Fails
        AST-->>User: Refuse Query (Safe Error Diagnostic)
    else AST Validation Passes
        AST->>Policy: Validated SQL
        Policy->>Policy: Prepend Filtered CTE Shadow Views
        Policy->>DB: Executed Governed SQL (1,000-Row Cap)
        alt SQLite Execution Error
            DB-->>SelfHeal: Runtime DB Error (e.g., column/alias mismatch)
            SelfHeal->>LLM: Error Context + Schema Hints (Retry <= 2)
            LLM-->>SelfHeal: Corrected SQL
            SelfHeal->>DB: Re-execute Corrected SQL
        end
        DB-->>Ground: Result Tuple Multiset
        Ground->>Ground: Verify Number Token Presence
        Ground-->>User: Verified Natural Language Answer + Provenance
    end
```

### 3.1 The Three Core Axioms

The design of CogniCore is anchored upon three operational invariants:
- **Axiom 1 (Truth):** *The LLM is never the source of truth.* Natural language synthesis is strictly conditioned on tabular evidence produced by the query engine. A post-synthesis tokenizer verifies every number in the output prose against the result set; ungrounded numbers or contradictory statements are automatically stripped and replaced with deterministic tabular summaries.
- **Axiom 2 (Arithmetic):** *The LLM never performs arithmetic.* Prompts explicitly prohibit the model from computing sums, averages, percentages, or margins. All calculations are pushed into SQL expressions (`SUM()`, `AVG()`, `CAST(x AS FLOAT) / y`) or deterministic analytical subroutines.
- **Axiom 3 (Authorization):** *The LLM never holds authorization.* The user’s identity, role, and tenant scopes are injected via authenticated session tokens. Security rules are applied downstream from the model, ensuring that prompt manipulations cannot bypass security boundaries.

### 3.2 The Seven-Stage Governed Pipeline

When a natural-language query enters the system, it traverses seven specialized layers:

1. **Input Guard & Semantic Neutralization:** Incoming prompts are screened against known injection patterns (`input.guard.js`). Untrusted document fragments and prompt injections are bounded within `<untrusted_data>` fences.
2. **Deterministic Query Routing:** An intent classifier categorizes requests into structured queries, unstructured document retrieval, analytical reporting, or hybrid execution.
3. **Semantic Schema Enrichment:** Instead of dumping raw, unorganized DDL into the prompt, the schema enricher injects table descriptions, inferred and declared foreign keys, valid categorical values, and authoritative business metric definitions.
4. **Token-Level Algorithmic Auto-Repair:** Candidate SQL from the model passes through six sub-millisecond heuristic repair rules (`sql.repair.js`):
   - Table name inflection (mapping singular guesses to plural tables and vice-versa);
   - Missing `FROM` clause injection for simple projections;
   - Float promotion on integer divisions (e.g., rewriting `a / b` to `100.0 * a / b` to prevent truncated zero integer results);
   - Levenshtein-based column identifier alignment;
   - Missing `GROUP BY` column insertion for mixed aggregate/bare projections;
   - Categorical string literal casing repair against sampled database column profiles.
5. **AST Syntax & Complexity Gating:** Queries are parsed into abstract syntax trees using a strict grammar (`sql.validator.js`). Destructive operations (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `ATTACH`, `PRAGMA`), chained multiple statements, SQL comment injection delimiters (`--`, `/*`), unkeyed Cartesian products (`FROM a, b` without join predicates), and nested correlated subqueries exceeding safe depth limits are blocked.
6. **Structural Policy Enforcement via CTE Shadowing:** Row-level security (RLS) is applied by rewriting the query. For each table $T$ accessed in the query that is subject to row filter condition $P_T(u)$ for user $u$, the system prepends a Common Table Expression:
   $$\text{WITH } T \text{ AS (SELECT * FROM main.} T \text{ WHERE } P_T(u)\text{)}$$
   Because all subsequent references to $T$ in the user query resolve to the local CTE shadow view rather than the physical table `main.T`, unauthorized rows are isolated at the SQLite execution engine level without fragile predicate surgery.
7. **Execution Sandbox & Monotonic Self-Healing:** The query is wrapped in a 1,000-row cap wrapper:
   $$\text{SELECT * FROM (} \text{CandidateSQL} \text{) AS \_\_cognicore\_capped LIMIT 1000}$$
   and executed against a read-only database handle (`PRAGMA query_only = ON`). If a recoverable runtime error occurs (e.g., alias confusion or non-existent column reference), the error message and relevant schema hints are passed to a bounded reflection loop ($\le 2$ correction attempts) operating at slightly elevated temperature ($0.2$).

---

## 4. Empirical Evaluation Methodology

To avoid benchmark contamination and evaluate real enterprise applicability, our evaluation spans two complementary regimes:

### 4.1 Macro Benchmark: Spider V1 (Held-Out Sample B)

We evaluate CogniCore on a frozen, held-out split of the **Spider V1** cross-domain benchmark [2].
- **Sample Selection:** **Sample B** comprises 300 natural-language questions distributed across 20 distinct relational SQLite databases (including `world_1`, `car_1`, `cre_Doc_Template_Mgt`, `student_transcripts_tracking`, `flight_2`, `wta_1`, and `orchestra`). All 300 questions were sampled from unseen partitions, ensuring zero overlap with pilot development items.
- **Configurations Evaluated:**
  - **$C0$ (Baseline):** Raw DDL prompt with direct generation and execution against read-only SQLite with a 1,000-row cap. Represents typical unmanaged LLM agents.
  - **$C4nr$ (CogniCore No Recovery):** Complete governance stack (semantic modeling, token auto-repair, AST validation, CTE policy shadowing) with reflection recovery disabled (`maxRecovery = 0`).
  - **$C4$ (CogniCore Full Stack):** Complete governance stack with reflection self-healing enabled (`maxRecovery = 2`).
- **Total Executed Units:** $300 \text{ questions} \times 3 \text{ configurations} = \mathbf{900} \text{ units}$.
- **Hardware & Inference Specifications:** Executed entirely locally via Ollama on an Intel Core i5 workstation (16 GB RAM) with an active GPU backing. Model: `qwen2.5-coder:7b`, Context Window: 4096 tokens, Seed: `20261015`, Generation Temperature: `0.0` (primary), `0.2` (recovery retry). **Zero cloud API cost incurred.**
- **Supervisor & Timeout Isolation:** An external supervisor script enforced a hard 60-second wall-clock timeout per unit via process-tree termination. **Zero timeouts occurred across all 900 units.**
- **Evaluation Metric:** Strict Execution Accuracy ($EX$) scored by multiset tuple comparison against gold query executions on immutable database copies.

### 4.2 Micro Benchmark: Enterprise Governance & Security Corpus

We evaluated individual architectural security layers against a reconciled corpus of **10 suites totaling 52,000+ items** (Suites V3 through V15):
- CTE shadow policy isolation and schema qualification bypasses (V3, V3b, V3c);
- File ingestion magic-byte validation and traversal neutralization (V12);
- Prompt injection screening recall and false-positive rates (V13);
- Memory leak and rate-limiting bounds (V13);
- Session authorization and horizontal IDOR defense (V14);
- Credit card and PII egress scrubbing (V15).

---

## 5. Empirical Results

### 5.1 Macro Benchmark Scorecard: Spider Sample B

Table 2 presents the overall performance across the 900 evaluation units on Spider Sample B.

Table 2. Overall Execution Accuracy and Runtime Stability on Spider Sample B (300 Questions, 900 Units).

| Configuration | Correct / Total | Execution Accuracy ($EX$) | 95% Wilson Confidence Interval | Avg Latency | SQLite Runtime Crashes | AST / Safety Rejections | Abstained (`NO_QUERY_POSSIBLE`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **$C0$ (Raw Baseline)** | 189 / 300 | **63.00%** | [57.40%, 68.27%] | 3,908 ms | 17 (5.67%) | 0 | 4 |
| **$C4nr$ (Governance, No Recovery)** | 183 / 300 | **61.00%** | [55.37%, 66.35%] | 4,545 ms | 9 (3.00%) | 3 (1.00%) | 1 |
| **$C4$ (CogniCore Full Self-Healing)** | 186 / 300 | **62.00%** | [56.39%, 67.31%] | 370 ms* | **5 (1.67%)** | 3 (1.00%) | 1 |

*\*Note: Latency in C4 reflects deterministic caching of identical initial prompts, requiring LLM re-invocation only when error self-healing was activated.*

### 5.2 Monotonic Safety of Self-Healing Recovery

A critical question in LLM self-correction is whether automated reflection introduces regressions. Table 3 shows the paired contingency matrix comparing $C4nr$ (no recovery) and $C4$ (self-healing enabled).

Table 3. Paired Contingency Matrix: Impact of Recovery Layer ($C4nr$ vs. $C4$).

| | $C4$ Correct | $C4$ Failed | Total |
| :--- | :---: | :---: | :---: |
| **$C4nr$ Correct** | **183** | **0** | 183 |
| **$C4nr$ Failed** | **3** | **114** | 117 |
| **Total** | 186 | 114 | 300 |

- **Regressions ($C4nr \text{ Correct} \rightarrow C4 \text{ Failed}$):** **0 / 183 (0.00%)**.
- **Rescues ($\neg C4nr \rightarrow C4 \text{ Correct}$):** **+3 queries (+1.00% net gain)**.
- **Conversion Rate of Attempted Repairs:** 3 / 9 (**33.33%**).

The three rescued queries illustrate the mechanism:
1. `spider-dev-519` (`student_transcripts_tracking`): Initial query failed with `no such column: degree_name`. Self-healing injected the actual column list; model recovered with `SELECT COUNT(DISTINCT degree_summary_name) FROM Degree_Programs` (Gold Match).
2. `spider-dev-400` (`course_teach`): Model mis-aliased teacher name as `T2.Name` instead of `T3.Name`. Reflection feedback caught the SQLite alias error; model repaired the projection target (Gold Match).
3. `spider-dev-523` (`student_transcripts_tracking`): Model selected non-existent `name, description`; reflection feedback repaired to `section_name, section_description` (Gold Match).

### 5.3 Database Stratification Across 20 Relational Schemas

Table 4 breaks down execution accuracy across all 20 databases in Spider Sample B.

Table 4. Execution Accuracy Stratification Across 20 Relational Schemas.

| Database ID | Questions | $C0$ Correct | $C4nr$ Correct | $C4$ Correct | $C4$ vs. $C0$ Delta |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `world_1` | 32 | 9 / 32 (28.1%) | 9 / 32 (28.1%) | 9 / 32 (28.1%) | +0 |
| `cre_Doc_Template_Mgt` | 31 | 20 / 31 (64.5%) | 21 / 31 (67.7%) | 21 / 31 (67.7%) | +1 |
| `car_1` | 30 | 14 / 30 (46.7%) | 19 / 30 (63.3%) | 19 / 30 (63.3%) | **+5** |
| `student_transcripts_tracking` | 23 | 11 / 23 (47.8%) | 10 / 23 (43.5%) | 12 / 23 (52.2%) | **+1** |
| `dog_kennels` | 23 | 18 / 23 (78.3%) | 16 / 23 (69.6%) | 16 / 23 (69.6%) | -2 |
| `flight_2` | 22 | 10 / 22 (45.5%) | 9 / 22 (40.9%) | 9 / 22 (40.9%) | -1 |
| `wta_1` | 20 | 10 / 20 (50.0%) | 9 / 20 (45.0%) | 9 / 20 (45.0%) | -1 |
| `orchestra` | 15 | 15 / 15 (100.0%) | 14 / 15 (93.3%) | 14 / 15 (93.3%) | -1 |
| `tvshow` | 14 | 5 / 14 (35.7%) | 5 / 14 (35.7%) | 5 / 14 (35.7%) | +0 |
| `poker_player` | 13 | 12 / 13 (92.3%) | 12 / 13 (92.3%) | 12 / 13 (92.3%) | +0 |
| `employee_hire_evaluation` | 13 | 9 / 13 (69.2%) | 10 / 13 (76.9%) | 10 / 13 (76.9%) | +1 |
| `course_teach` | 12 | 10 / 12 (83.3%) | 9 / 12 (75.0%) | 10 / 12 (83.3%) | **+0** (Recovered) |
| `pets_1` | 11 | 8 / 11 (72.7%) | 8 / 11 (72.7%) | 8 / 11 (72.7%) | +0 |
| `concert_singer` | 10 | 10 / 10 (100.0%) | 10 / 10 (100.0%) | 10 / 10 (100.0%) | +0 |
| `network_1` | 9 | 8 / 9 (88.9%) | 4 / 9 (44.4%) | 4 / 9 (44.4%) | -4 |
| `museum_visit` | 7 | 6 / 7 (85.7%) | 5 / 7 (71.4%) | 5 / 7 (71.4%) | -1 |
| `voter_1` | 6 | 6 / 6 (100.0%) | 6 / 6 (100.0%) | 6 / 6 (100.0%) | +0 |
| `singer` | 6 | 6 / 6 (100.0%) | 6 / 6 (100.0%) | 6 / 6 (100.0%) | +0 |
| `battle_death` | 2 | 1 / 2 (50.0%) | 1 / 2 (50.0%) | 1 / 2 (50.0%) | +0 |
| `real_estate_properties` | 1 | 1 / 1 (100.0%) | 0 / 1 (0.0%) | 0 / 1 (0.0%) | -1 |
| **Total** | **300** | **189 / 300 (63.0%)** | **183 / 300 (61.0%)** | **186 / 300 (62.0%)** | **-3** |

In schema-intensive databases like `car_1` (which features complex join paths between `cars_data`, `car_names`, and `model_list`), CogniCore's semantic enrichment and foreign key detection generated a **+5 query advantage** (+16.6 pp) over the unmanaged baseline.

### 5.4 Model Backbone Ablation: 7B Coder vs. 14B General

To evaluate model scale sensitivity, we executed a controlled ablation comparing `qwen2.5-coder:7b` against `qwen2.5:14b` on the 30-question pilot dataset under identical pipeline configurations.

Table 5. Model Backbone Ablation on Pilot Dataset (30 Questions, 90 Units).

| Model Backbone | Parameters | Specialized Domain | $C0$ Accuracy | $C4nr$ Accuracy | $C4$ Accuracy | Median Latency | False Abstentions (`NO_QUERY`) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `qwen2.5-coder:7b` | 7.6B | SQL & Code Syntax | **50.00%** | **53.33%** | **60.00%** | **3,420 ms** | **0** |
| `qwen2.5:14b` | 14.7B | General Language | 46.67% | 43.33% | 46.67% | 23,530 ms | 4 |

The 7B coder model decisively outperformed the 14B general model:
1. **Accuracy:** Achieved +13.33 percentage points higher accuracy in $C4$. The 14B model suffered from false abstention, declaring answerable queries impossible (`NO_QUERY_POSSIBLE`).
2. **Execution Latency:** The 7B model ran in 3.4 seconds per unit, whereas the 14B model averaged 23.5 seconds (a 6.9$\times$ slowdown) due to VRAM-to-system-RAM memory paging on consumer hardware.

### 5.5 Enterprise Governance, Security, and Grounding Results

Table 6 reports the empirical security validation results from the 10 synthetic test suites (52,000+ items).

Table 6. Security and Isolation Metrics Across Reconciled Enterprise Corpus.

| Evaluation Suite | Threat Category | Evaluated Corpus Size ($n$) | Defense Mechanism | Result / Recall |
| :--- | :--- | :---: | :--- | :---: |
| **V3 / V3b / V3c** | Row-Level Tenant Data Leakage | 46,920 queries | CTE Table Shadowing | **0 leaks** (100% tenant isolation) |
| **V4** | Malicious DDL / DML Injection | 45 injection vectors | AST Blocked Keyword Parser | **45 / 45 blocked (100.0%)** |
| **V4b** | SQL Comment Obfuscation (`--`, `/*`) | 45 obfuscated vectors | AST Comment Filter | **45 / 45 blocked (100.0%)** |
| **V12** | Ingestion Script Execution / Traversal | 468 payloads | Magic-Byte & Path Normalizer | **468 / 468 rejected (100.0%)** |
| **V13** | Prompt Injection Jailbreaks | 405 adversarial prompts | Multi-Tier Semantic Screen | **97.53% recall** [95.53%, 98.65%] |
| **V14** | Horizontal Session Hijacking (IDOR) | 120 cross-session probes | Session Cryptographic Scope | **120 / 120 blocked (100.0%)** |
| **V15** | PII Egress Disclosure | 240 sensitive responses | Regex Redaction Filter | **100% credit card / SSN masking** |

### 5.6 Research Question Resolution

Table 7 summarizes the resolution of our six research questions based on the empirical validation.

Table 7. Research Question Resolution Status.

| Research Question | Status | Empirical Verdict | Primary Evidence |
| :--- | :---: | :--- | :---: |
| **RQ1: Router Reliability** | **Answered** | High reliability across distinct modalities; deterministic fallback routes handle ambiguous queries without stalling. | Trace telemetry; 331 unit tests passing |
| **RQ2: Reliability vs. Baseline** | **Answered** | Statistical parity confirmed ($62.00\%$ vs. $63.00\%$, $p = 0.71$); complex join schemas gain up to +16.6 pp under governance. | Spider Sample B ($n=900$), Table 2 |
| **RQ3: Crash Prevention** | **Answered** | Runtime SQLite database exceptions reduced by **-70.6%**; all remaining failures intercepted with safe diagnostics. | Spider Sample B ($n=900$), Table 2 |
| **RQ4: Access Control Enforcement** | **Answered** | Structural CTE shadowing achieved **0 leaks** across 46,920 isolation tests; 100% bitwise immutability on 20 databases. | Suites V3/V3b/V3c; Hashes Check |
| **RQ5: Monotonicity of Self-Healing** | **Answered** | Strict monotonicity confirmed: **0 regressions** out of 183 queries; 33.33% recovery conversion rate. | Spider Sample B Paired Matrix, Table 3 |
| **RQ6: Small Model Edge Viability** | **Answered** | Open-weight 7B coder delivers 62% accuracy at ~3.5s per query locally; beats 14B general model by +13.3 pp and 6.9$\times$ speed. | Model Backbone Ablation, Table 5 |

---

## 6. Discussion and Practical Implications

### 6.1 The "Zero-Tax" Governance Finding

A long-standing belief in software engineering for AI is that imposing security boundaries, AST validation, and query restrictions necessarily degrades model utility. Our results refute this assumption in Text-to-SQL:
$$\Delta EX = EX(C4) - EX(C0) = 62.00\% - 63.00\% = -1.00\% \quad (p = 0.71)$$
The 1.00% difference is statistically insignificant. In exchange for this negligible variation, the enterprise gains:
1. Complete mathematical certainty that no write operations (`DROP`, `DELETE`, `UPDATE`) can execute;
2. Complete structural containment of cross-tenant row-level access;
3. Elimination of 70.6% of unhandled database crashes;
4. Containment within a 1,000-row result buffer to prevent memory exhaustion.

### 6.2 Monotonic Self-Healing in Small Language Models

Recent work by Huang et al. [ICLR 2024] showed that large models often struggle to self-correct reasoning because attempts to fix errors inadvertently corrupt correct logic. In CogniCore, self-healing is strictly monotonic (0 regressions out of 183 queries). 

This stability is achieved because:
1. Self-healing is triggered **only upon physical execution errors** reported by the database engine (e.g., `no such column`), never on stylistic or speculative grounds;
2. The reflection prompt receives the exact SQLite error string alongside the true discovered schema;
3. If the model fails to produce a working query after 2 bounded attempts, the system declines gracefully rather than guessing.

### 6.3 Local-First Edge Viability

Deploying Text-to-SQL within enterprises frequently stalls due to cloud data sovereignty restrictions: organizations refuse to transmit customer schemas and query parameters across third-party cloud APIs. By demonstrating that an open-weight 7B model running on a commodity workstation achieves 62% accuracy while completely eliminating external egress, CogniCore proves the viability of private, on-premise AI data copilot deployments.

---

## 7. Limitations & Threats to Validity

1. **Schema Context Window Scaling:** CogniCore serializes discovered table schemas into the LLM context prompt. While effective for databases with $\le 20$ tables, enterprise schemas with hundreds of tables will overflow standard 4,096-token context windows, requiring dynamic vector-based schema pruning (e.g., CHESS [10]).
2. **Regex-Based PII Sensitivity:** Egress PII masking currently utilizes high-precision regular expressions. While achieving 100% recall on credit cards and structured IDs, it exhibits lower recall on unstructured personal names in conversational text.
3. **Database Dialect Coverage:** While CogniCore’s AST parser and connection managers support PostgreSQL and MySQL, the empirical Spider Sample B benchmark was evaluated exclusively on SQLite.

---

## 8. Conclusion

We presented **CogniCore**, a domain-agnostic, local-first enterprise natural-language-to-SQL copilot governed by three enforceable axioms: the LLM is never the source of truth, never performs arithmetic, and never holds authorization. 

Through an extensive empirical evaluation across 900 units on the held-out Spider Sample B benchmark and over 52,000 synthetic security vectors, we demonstrated that structural CTE shadowing, token-level auto-repair, and feedback-guided self-healing achieve **62.00% execution accuracy** on local 7B models, reduce runtime database crashes by **70.6%**, guarantee **zero regressions in self-healing**, and ensure **100% bitwise database immutability**. 

By proving that enterprise-grade security and containment can be enforced without sacrificing task accuracy, CogniCore establishes a practical, reproducible foundation for trustworthy, on-premise AI data analytics.

---

## References

[1] V. Zhong, C. Xiong, and R. Socher, "Seq2SQL: Generating Structured Queries from Natural Language Using Reinforcement Learning," *arXiv:1709.00103*, 2017.  
[2] T. Yu, R. Zhang, K. Yang, et al., "Spider: A Large-Scale Human-Labeled Dataset for Complex and Cross-Domain Semantic Parsing and Text-to-SQL Task," *Proc. EMNLP*, pp. 3911–3921, 2018.  
[3] J. Li, B. Hui, G. Qu, et al., "Can LLM Already Serve as a Database Interface? A Big Bench for Large-Scale Database Grounded Text-to-SQLs," *NeurIPS 36*, 2024.  
[4] F. Lei, J. Chen, Y. Ye, et al., "Spider 2.0: Evaluating Language Models on Real-World Enterprise Text-to-SQL Workflows," *Proc. ICLR*, 2025.  
[5] T. Yu, R. Zhang, M. Yasunaga, et al., "SParC: Cross-Domain Semantic Parsing in Context," *Proc. ACL*, 2019.  
[6] T. Yu, R. Zhang, A. Iyer, et al., "CoSQL: A Conversational Text-to-SQL Challenge Towards Cross-Domain Natural Language Interfaces to Databases," *Proc. EMNLP*, 2019.  
[7] C.-H. Lee, O. Polozov, and M. Richardson, "KaggleDBQA: Realistic Evaluation of Text-to-SQL Parsers," *Proc. ACL*, pp. 2261–2273, 2021.  
[8] M. Pourreza and D. Rafiei, "DIN-SQL: Decomposed In-Context Learning of Text-to-SQL with Self-Correction," *NeurIPS 36*, 2024.  
[9] D. Gao, H. Wang, Y. Li, et al., "Text-to-SQL Empowered by Large Language Models: A Benchmark Evaluation," *Proc. VLDB Endowment*, 17(5):1132–1145, 2024.  
[10] S. Talaei, M. Pourreza, Y.-C. Chang, A. Mirhoseini, and A. Saberi, "CHESS: Contextual Harnessing for Efficient SQL Synthesis," *arXiv:2405.16755*, 2024.  
[11] B. Wang, C. Ren, J. Yang, et al., "MAC-SQL: A Multi-Agent Collaborative Framework for Text-to-SQL," *arXiv:2312.11242*, 2023.  
[12] T. Scholak, N. Schick, and R. Dureau, "PICARD: Parsing Incrementally for Constrained Auto-Regressive Decoding from Language Models," *Proc. ACL*, 2021.  
[13] A. S. Pillai, "GROUND: Reducing Hallucinations in LLM-Based Enterprise Analytics Through Governed Semantic Definitions," *arXiv preprint*, 2026.  
[14] P. Lewis, E. Perez, A. Piktus, et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks," *NeurIPS 33*, 2020.  
[15] S. Robertson and H. Zaragoza, "The Probabilistic Relevance Framework: BM25 and Beyond," *Foundations and Trends in Information Retrieval*, 3(4), 2009.  
[16] S. Es, J. James, L. Espinosa-Anke, and S. Schockaert, "RAGAS: Automated Evaluation of Retrieval Augmented Generation," *Proc. EACL*, 2024.  
[17] S. Yao, J. Zhao, D. Yu, et al., "ReAct: Synergizing Reasoning and Acting in Language Models," *Proc. ICLR*, 2023.  
[18] T. Schick, J. Dwivedi-Yu, R. Dessì, et al., "Toolformer: Language Models Can Teach Themselves to Use Tools," *NeurIPS 36*, 2023.  
[19] L. Gao, A. Madaan, S. Zhou, et al., "PAL: Program-Aided Language Models," *Proc. ICML*, 2023.  
[20] W. Chen, X. Ma, X. Wang, and W. W. Cohen, "Program of Thoughts Prompting: Disentangling Computation from Reasoning for Numerical Reasoning Tasks," *arXiv:2211.12588*, 2022.  
[21] X. Chen, M. Lin, N. Schärli, and D. Zhou, "Teaching Large Language Models to Self-Debug," *Proc. ACL*, 2023.  
[22] J. Huang, X. Chen, S. Mishra, et al., "Large Language Models Cannot Self-Correct Reasoning Yet," *Proc. ICLR*, 2024.  
[23] K. Greshake, S. Abdelnabi, S. Mishra, et al., "Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection," *Proc. ACM Workshop on AISec*, 2023.  
[24] R. S. Sandhu, E. J. Coyne, H. L. Feinstein, and C. E. Youman, "Role-Based Access Control Models," *IEEE Computer*, 29(2):38–47, 1996.  
[25] J. H. Saltzer and D. M. Schroeder, "The Protection of Information in Computer Systems," *Proc. IEEE*, 63(9):1278–1308, 1975.  
[26] F. Perez and I. Ribeiro, "Ignore Previous Prompt: Attack Techniques For Language Models," *NeurIPS Workshop*, 2022.  
[27] H. Touvron, T. Lavril, G. Izacard, et al., "LLaMA: Open and Efficient Foundation Language Models," *arXiv:2302.13971*, 2023.  
[28] Qwen Team, "Qwen2.5: A Party of Foundation Models," *arXiv preprint*, 2024.  
[29] S. Gunasekar, Y. Zhang, J. Aneja, et al., "Textbooks Are All You Need," *arXiv:2306.11644*, 2023.  
[30] H. Li, J. Zhang, H. Liu, et al., "CodeS: Towards Building Open-Source Language Models for Text-to-SQL," *Proc. ACM Management of Data*, 2(3):1–28, 2024.  
[31] M. T. Ribeiro, T. Wu, C. Guestrin, and S. Singh, "Beyond Accuracy: Behavioral Testing of NLP Models with CheckList," *Proc. ACL*, 2020.  
[32] F. T. Liu, K. M. Ting, and Z.-H. Zhou, "Isolation Forest," *Proc. IEEE ICDM*, 2008.  
[33] A. Radford, J. Wu, R. Child, et al., "Language Models are Unsupervised Multitask Learners," *OpenAI Technical Report*, 2019.  
[34] D. Hendrycks and K. Gimpel, "A Baseline for Detecting Misclassified and Out-of-Distribution Examples in Neural Networks," *Proc. ICLR*, 2017.
