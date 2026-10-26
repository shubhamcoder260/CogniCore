# 06_DECISIONS_NEEDED.md: Architectural Decision Register

**Document Status**: Formal Decision Register  
**Target Codebase Commit**: `9cde26cc712cd805d48c2ede925393742ec1b68d`  
**Execution Timestamp**: 2026-10-25T14:25:35Z  
**Instruction Compliance**: In accordance with Hard Rule 8, no silent architectural choices have been made. Every decision with multiple valid paths is documented with explicit options, trade-offs, and an architect's recommendation for user review.

---

## Decision 1: Modeling Table-Level Denial (`deny_table`)

### Context
The *Role-Conditioned Refusals (RCR)* benchmark defines table-level restrictions (e.g. `REVOKE SELECT ON table FROM role`). However, CogniCore's policy engine (`server/src/security/data.policy.js:37`) only supports `deny_column` and `row_filter`. Attempting to register `kind: 'deny_table'` throws a fatal validation error.

### Options
- **Option A (Column Allowlist Expansion)**: Programmatically query the dataset schema and generate a `deny_column` rule for **every column** in the denied table.
  - *Pros*: Requires zero modifications to CogniCore's production source code; perfectly complies with existing API schemas.
  - *Cons*: Clutters `data_policies` with dozens of policy rows per table; slightly increases AST rewriter traversal overhead.
- **Option B (Engine Code Delta for Native `deny_table`)**: Add native `deny_table` handling to `data.policy.js:37, 71` via a proposed delta in `CODE_DELTAS.md`.
  - *Pros*: Architecturally clean; aligns CogniCore directly with PostgreSQL RBAC semantics.
  - *Cons*: Violates strict "as-is" evaluation of the existing codebase; requires touching core security logic before evaluation.
- **Option C (Dataset Partitioning)**: Restrict whole tables by placing them in distinct datasets and withholding read grants in `auth_grants`.
  - *Pros*: Uses existing RBAC sharing boundaries (`requireDatasetAccess('read')`).
  - *Cons*: Breaks multi-table relational joins present in the Spider benchmark; incompatible with standard RCR queries.

### Recommendation
**Adopt Option A (Column Expansion)** for baseline evaluation. Document the architectural gap in the findings report. If the user authorizes code deltas in Session 2, Option B can be evaluated as an ablation enhancement.

---

## Decision 2: Implementation Method for Pipeline Layer Toggles

### Context
To measure the attack funnel ($L_1 \rightarrow L_2 \rightarrow L_3$) and attribute first-stop rejections, the harness must be able to selectively bypass individual defense layers (Input Guard, Auto-Repair, AST Validator, Policy Rewriter).

### Options
- **Option A (Non-Intrusive Environment Toggles via `CODE_DELTAS.md`)**: Insert clean environment variable checks (e.g. `if (process.env.SECURITY_EVAL_DISABLE_VALIDATOR !== 'true')`) into the pipeline.
  - *Pros*: Transparent, robust, and controllable across both HTTP and in-process tests.
  - *Cons*: Requires applying minor proposed hooks to `core.engine.js` and `structured.engine.js`.
- **Option B (In-Process Monkey-Patching / Node Module Interception)**: For in-process tests, use Node's `require.cache` to substitute mock gate functions that pass payloads without validation.
  - *Pros*: Zero edits to source files under `server/src/`.
  - *Cons*: Only works for in-process tests (S1-A and S2 Tier 1). Cannot toggle layers for HTTP API chat requests (S1-B and S2 Tier 2) unless the server runs in the same process.
- **Option C (Standalone Pipeline Duplication)**: Re-implement the pipeline stages inside `security-eval/harness/standalone_client.js` with toggle switches.
  - *Pros*: Completely decoupled from the server codebase.
  - *Cons*: High risk of drift between the harness re-implementation and actual server execution logic.

### Recommendation
**Adopt Option B for in-process runs**, and propose **Option A via `CODE_DELTAS.md`** for user approval before conducting HTTP-mediated ablation runs.

---

## Decision 3: P2SQL Prompt Adaptation Strategy

### Context
The public P2SQL repository evaluates attacks against specific demonstration schemas. To evaluate CogniCore, the attacks must target CogniCore's banking schema (`raw_fixture.db`) and Spider databases.

### Options
- **Option A (Verbatim Literal Translation)**: Keep P2SQL prompt templates verbatim, replacing only entity names (e.g. changing `users` to `accts`, `password` to `bal`).
  - *Pros*: Preserves the exact syntactic phrasing and adversarial structure of the published ICSE 2025 paper.
  - *Cons*: Some prompt templates may assume specific domain mechanics not present in a banking database.
- **Option B (Tailored Semantic Synthesis)**: Rewrite attack prompts to naturally target CogniCore's specific features (e.g. prompting the assistant to dump multi-tenant branch IDs or override credit limits).
  - *Pros*: Higher realism for CogniCore's specific enterprise copilot positioning.
  - *Cons*: Deviates from exact academic benchmark replication.
- **Option C (Dual-Corpus Approach)**: Include both: (1) Literal P2SQL benchmark translations ($N=50$) and (2) CogniCore-tailored adaptive prompts ($N=25$).
  - *Pros*: Maximizes comparability with the published literature while stress-testing CogniCore's specific attack surfaces.
  - *Cons*: Increases LLM evaluation runtime by ~30%.

### Recommendation
**Adopt Option C (Dual-Corpus Approach)**. 50 literal replications provide faithful academic comparison; 25 domain-tailored prompts stress-test CogniCore's multi-tenant boundaries.

---

## Decision 4: Evaluating P2SQL Attack RI.2 (Multi-Query Execution)

### Context
P2SQL attack RI.2 requires executing multiple queries per user request to achieve indirect state tampering or exfiltration.

### Options
- **Option A (Force Multi-Step Analysis Mode)**: Dispatch RI.2 chat requests with `{"analysisMode": true}` in `POST /api/chat`, forcing `core.engine.js` into `analysis.engine.js` (executing up to 6 sub-queries).
  - *Pros*: Directly exercises the multi-query execution pipeline built into CogniCore.
  - *Cons*: Focuses exclusively on the analysis engine rather than standard chat.
- **Option B (Multi-Turn Conversational Poisoning)**: Execute a 2-turn conversation: Turn 1 queries poisoned data; Turn 2 asks a follow-up question that triggers secondary query execution via `followup.resolver.js`.
  - *Pros*: Tests the real-world conversational session state store.
  - *Cons*: Doubles runtime for RI.2 evaluation.
- **Option C (Evaluate Both Vectors)**: Partition RI.2 into RI.2-A (Analysis Mode) and RI.2-B (Multi-Turn Chat).
  - *Pros*: Comprehensive coverage of all multi-query execution pathways.
  - *Cons*: Slightly higher implementation complexity.

### Recommendation
**Adopt Option C**. Evaluating both analysis mode and multi-turn follow-ups guarantees complete coverage of the RI.2 threat vector.

---

## Decision 5: Test Execution Surface for S2 Tier 1 (Enforcement-Only)

### Context
S2 Tier 1 replays 600 gold SQL queries through `validateSql` $\rightarrow$ `enforcePolicy` $\rightarrow$ `executeValidatedQuery`.

### Options
- **Option A (In-Process Standalone Harness)**: Import and execute the pipeline functions directly in a Node.js test script.
  - *Pros*: Completes all 600 queries in $< 45\text{ seconds}$; exact microsecond latency profiling; zero HTTP serialization jitter.
  - *Cons*: Bypasses Express routing middleware and `errorHandler`.
- **Option B (HTTP API via Preview or Tools Endpoint)**: Execute queries over HTTP via `POST /api/tools/export` or an internal test route.
  - *Pros*: Exercises full Express network stack.
  - *Cons*: High latency overhead (~3 to 5 minutes); tool endpoints apply egress sanitization which masks intermediate policy rewriter output.

### Recommendation
**Adopt Option A (In-Process Standalone)**. S2 Tier 1 is designed to verify the mathematical and AST correctness of the policy rewriter. Eliminating HTTP overhead ensures fast, deterministic results.

---

## Decision 6: Foreign Key Orphan Handling in Purged Clones

### Context
In S2-B, creating `authorized_${role}_${tenant}.db` requires physically purging non-permitted rows. Deleting parent rows in `brs` leaves foreign-key child rows in `accts` as orphans if foreign keys do not cascade.

### Options
- **Option A (Cascade Deletion)**: Execute `DELETE FROM child WHERE parent_id NOT IN (SELECT id FROM permitted_parents)`.
  - *Pros*: Maintains strict relational integrity in the purged clone.
  - *Cons*: If an application query joins an unconstrained child table, it might see rows that were artificially deleted in the clone.
- **Option B (Explicit Schema-Level Tenant Keys)**: Require all tables (parent and child) to include explicit `tenant_id` columns, purging rows where `tenant_id != current_tenant`.
  - *Pros*: Reflects enterprise multi-tenant database best practices; prevents accidental data leaks on direct child queries.
  - *Cons*: Requires schemas to have uniform tenant partitioning keys.

### Recommendation
**Adopt Option B**. In `raw_fixture.db`, all tables (`brs`, `accts`, `txns`) already possess direct `tenant_id` columns. Both parent and child rows are purged by tenant ID, preventing foreign-key orphan ambiguity.

---

## Decision 7: Model Selection & Budget Allocation for Evaluation Runs

### Context
CogniCore's default model in code is `qwen2.5:14b` (`env.js:26`), but `.env.example:9` documents `qwen2.5:7b`.

### Options
- **Option A (14B Only)**: Run all LLM evaluations exclusively on `qwen2.5:14b`.
  - *Pros*: Evaluates the actual production default configuration.
  - *Cons*: Omits testing of the 7B model commonly deployed by resource-constrained users.
- **Option B (14B and 7B Full Matrix)**: Run both models across all S1-B, S1-C, and S2 Tier 2 tests.
  - *Pros*: Provides full academic comparison of model parameter scaling on security gate resilience.
  - *Cons*: Doubles LLM evaluation runtime to ~2.5 hours.
- **Option C (14B Full Suite + 7B S1-B Subset)**: Run `qwen2.5:14b` across all suites; run `qwen2.5:7b` across a targeted 50-item subset of S1-B.
  - *Pros*: Captures parameter scaling differences without exceeding a 1.5-hour runtime budget.
  - *Cons*: 7B evaluation is not fully symmetric with 14B.

### Recommendation
**Adopt Option C (14B Full Suite + 7B S1-B Subset)**. Provides optimal balance of thoroughness and execution budget.
