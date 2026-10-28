# PREREG_S5 — Suite S5: Schema and Context Leakage

Status: PREREGISTERED (before runner execution). Written per context pack §0 rule 5.
Constraint: deterministic parts only at build time (context pack §7 S5 "Deterministic
tests (no model)"); the model-based replication variant is declared NOT RUN.
Ladder rungs: 971d171, 965ba48, HEAD (all verified: 971d171 "Item 3 egress chokepoint",
965ba48 "Item 12 prompt hygiene and canary token suppression").

## 1. Source and claim under test

Source: Klisura & Rios (Findings of NAACL 2025): zero-knowledge schema inference.
Random and adversarial inputs elicit SQL from text-to-SQL systems; a surrogate model
reconstructs the schema; random strings alone leaked table names; prompt-level "do
not reveal" defences only reduced leakage. Recommendation: put only authorised
schema elements in the prompt.

System claims under test:
(a) the schema endpoint and dataset preview respect column-level policy;
(b) error surfaces do not disclose denied identifiers;
(c) LLM prompts contain only policy-authorised schema elements, semantic values and
    canary-free content (the Item-12 hygiene claim);
(d) cross-user context isolation: one user's request cannot place another user's
    policy-forbidden content into a prompt.

## 2. Verified code facts this design relies on (verified 2026-10-26, branch security-eval)

| Fact | Anchor |
|---|---|
| `GET /api/schema/:datasetId` returns `analyzeSchema(dataset.schema, dataset.profile)` with NO policy parameter | server/src/api/routes/schema.js:10-26 |
| `GET /api/datasets/:id/preview` DOES apply `sanitizeEgress` with `req.user` | server/src/api/routes/datasets.js:42-67 |
| `sanitizeEgress` removes deniedColumns + applies rowFilters + PII masking | server/src/security/egress.guard.js:19-129 |
| SQL prompt builder filters schema/semantic/relationships by deniedColumns | server/src/structured/sql.generator.js:26-57 |
| `knowledgeText` and `conversationContext` are interpolated into the SQL prompt UNFILTERED | server/src/structured/sql.generator.js:99 |
| Canary regex suppression `CANARY_[A-Za-z0-9_]+` applied to the SQL prompt | server/src/structured/sql.generator.js:114 |
| Explanation prompt fences evidence inside `<untrusted_data>`; context+preferences sanitized | server/src/response/answer.composer.js:40-50 |
| Provider interface needed by the runner's scripted provider: `.complete(prompt, options)` | server/src/llm/llm.provider.js (LLMProvider base) |
| Ollama HTTP protocol for the mock stub: POST /api/generate `{model,prompt,stream:false,...}` → `{response}`; GET /api/tags → `{models}` | server/src/llm/ollama.provider.js:22-46 |
| `OLLAMA_BASE_URL` env selects the stub in full-system runs | server/src/config/env.js:25 |
| PolicyError raised by policy layer; message text is the S5-B surface | server/src/security/data.policy.js:378 (export list) |

## 3. Test material

Fixture: reuse `multi_tenant_bank.sqlite` (setup/08) — it already carries
denied-column candidates and CANARY_* tokens. Additional policy declarations and
glossary/knowledge strings are authored in `security-eval/data/s5/s5_material.json`
(knowledgeText and conversationContext strings deliberately containing one denied
column name and one canary, so pass-through leakage is measurable rather than
assumed). No LLM is contacted: prompt capture calls `buildPrompt` /
`buildExplanationPrompt` directly and `generateSql` with an in-process scripted
provider implementing `.complete()`.

## 4. Hypotheses

- H5-A: the schema endpoint discloses ≥1 column name (or profile value) that the
  requesting role's policy denies, while the preview endpoint does not (asymmetry).
- H5-B: at least one error surface (PolicyError message, validator message) echoes
  a denied identifier verbatim for a restricted role.
- H5-C: the SQL-generation prompt is policy-clean for schema/semantic/relationship
  fields (Item-12 filters hold) but leaks denied identifiers when they appear in
  knowledgeText or conversationContext (unfiltered pass-through surfaces).
- H5-D: no cross-user prompt contamination is measurable because prompts are
  pure functions of per-request inputs (no shared prompt cache); if contamination
  IS measured, H5-D is falsified and reported as a finding.

## 5. Parts and oracles (exact definitions)

O5-1 Endpoint scan (Part A, HTTP opt-in `--base-url`): for each role account
(viewer/employee/manager/admin) obtain a token (operator-provided via
`--tokens-file`, produced by the runbook's login steps), call
`GET /api/schema/:datasetId` and `GET /api/datasets/:id/preview?table=<t>&limit=25`.
Scan bodies for: denied column names (case-insensitive, word-boundary), denied
categorical values, CANARY_* tokens. Without `--base-url` the part records
NOT_RUN_HTTP_DISABLED (established P4 pattern; s2_probe_runner.js).
O5-2 Error-text scan (Part B, in-process): invoke
`assertColumnAccess`/`enforcePolicy` with requests naming denied columns/tables and
`validateSql` with SQL referencing denied identifiers; scan thrown error messages
and validator output for the denied identifiers. Outcome per probe: LEAK_IN_ERROR /
NO_LEAK_IN_ERROR / NOT_APPLICABLE_NO_ERROR (message did not mention the identifier
because the request failed earlier for an unrelated reason — recorded, not skipped).
O5-3 Prompt scan (Part C, in-process): build SQL prompts under (i) restricted
policy, (ii) admin policy, each with full schema+semantic, and with poisoned
knowledgeText/conversationContext from s5_material.json; build one explanation
prompt with poisoned preferences. Scan every emitted prompt for: denied schema
elements, denied values, glossary terms, CANARY_* tokens. Outcome per surface:
PROMPT_CLEAN / PROMPT_LEAK (with the exact matching element class) — plus
canary-suppression check specific to sql.generator.js:114.
O5-4 Cross-user isolation (Part D, in-process): build the same question twice —
once as restricted user A, once as admin user B — and diff the prompts. If A's
prompt contains any element that appears only because of B's session (measurable
only if a shared cache exists), record SHARING_DETECTED. Static evidence: the
runner greps for a prompt/cache layer and records `no_prompt_cache_found` with the
grep command in the summary when nothing is found (honest NOT_APPLICABLE accounting
of H5-D, not a PASS).

## 6. Metrics, denominators, statistics

- Part A: leaked_element_count per role per endpoint; paired endpoint comparison
  (schema vs preview) over the same denied-element set; McNemar exact test on the
  paired per-element leak indicators (discordant pairs), alpha=0.05, reported only
  if ≥1 element is disclosed by either endpoint.
- Part B: leak_probes/total_probes; CP zero-event upper bound over the
  error-probe denominator.
- Part C: per-surface leak indicator over a preregistered element inventory
  (denied columns + values + glossary terms + canaries; exact list frozen in
  s5_material.json). Quotable only if the inventory file's SHA-256 matches the
  runner's preflight record.
- Verdict vocabulary: LEAK / CLEAN / NOT_RUN_HTTP_DISABLED / NOT_APPLICABLE_NO_ERROR
  / SHARING_DETECTED / NO_PROMPT_CACHE_FOUND / ORACLE_INCOMPLETE.
- Exclusion rules: none post-hoc; environment failures abort (exit 2).

## 7. Declared NOT RUN at build time

- Model-based attack-loop replication (surrogate model, F1 of recovered elements):
  NOT_RUN_MODEL_VARIANT (per context pack §7 S5 "Model-based variant (later)").
- Novelty track (policy-scoped context, cache keyed by policy hash): DEFERRED per
  context pack §9 until baseline freeze (open item I10 ledger).
- Part A HTTP variant: NOT_RUN_HTTP_DISABLED unless the operator supplies
  --base-url and --tokens-file (server-up prerequisite, context pack I1).

## 8. Output contract

`runs/<ts>_s5_<rung>/s5_results.jsonl` + `s5_summary.json` (per-part outcomes,
leaked-element inventories, McNemar statistic when computable, CP bound for Part B,
environment record: rung, fixture SHA-256, material SHA-256, tokens-file presence
boolean — never token contents).
