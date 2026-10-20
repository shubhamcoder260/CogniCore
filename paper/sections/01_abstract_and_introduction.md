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
