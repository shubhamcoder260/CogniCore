# RUNBOOK_S6 — Prompt Injection, deterministic parts (no LLM, no network)

Prereg: `security-eval/prereg/PREREG_S6.md` **including Amendment 1 and
Amendment 2** (v13 mixed corpus split; FP endpoint = v13 expected_blocked=false;
v4/v4b SQL corpora informational only; AM-S6-2: primary Part A denominator =
**508 unique payloads**, pooled 568-record form not quotable as primary;
AM-S6-3: fail-closed corpus loading). Sources: BIPIA (KDD 2025), deepset test
set, in-repo v13 corpus. Model-based variants are NOT_RUN_MODEL_VARIANT (I11).

> **Fix note (2026-10-27, see prereg/PREREG_AMENDMENTS.md AM-S6-2/AM-S6-3):**
> self-check finding A1 (pooled recall double-counts deepset) is FIXED with a
> corrected measurement: 568 pooled records = **508 unique payloads** (60
> deepset payloads duplicate v13 attacks; 56 deepset attack payloads appear in
> v13's benign set — label conflict, must be disclosed with any joint
> recall/FP reading). Corpus counts are now permanent runtime asserts (exit 2
> on drift). Quoting rule: quote `attackRecallUniquePooled` (508) as the
> headline recall; never the pooled-records form.

## 0. Prerequisites

```bash
cd <repo> && git checkout security-eval
export PATH=/home/z/my-project/tools/bin:$PATH
export NODE_PATH=$PWD/server/node_modules
```

No fixtures and no npm install are needed — S6's deterministic parts are
self-contained. The vendored BIPIA extract must be committed:

```bash
git add security-eval/data/s6/bipia_text_attacks.json
git commit -m "security-eval(s6): vendor BIPIA text attack extract (75 attacks, SHA-pinned)"
```

To re-derive it (requires a local BIPIA clone):
`node security-eval/harness/tools/s6_extract_bipia.js --repo /path/to/BIPIA`
(pins the upstream file SHA-256 inside the vendored JSON).

## 1. Dry run

```bash
node security-eval/harness/runners/s6_runner.js --dry-run
```

Expect `DRY-RUN complete — nothing executed.` plus the corpus totals: attacks
568 (v13 377 + deepset 116 + BIPIA 75), benign 595, poisoned Part B 125.

## 2. Real run

```bash
node security-eval/harness/runners/s6_runner.js --rung 971d171
node security-eval/harness/runners/s6_runner.js --rung 965ba48
node security-eval/harness/runners/s6_runner.js --rung HEAD
```

Exit codes: 0 ok · 2 corpus missing/parse error · 1 crash. The runner makes zero
network calls and zero model calls; the "mock LLM" is an in-process scripted
provider. If a real Ollama connection is attempted, the environment is wrong.

## 3. Accept the run (all must hold)

- `valid: true`; manifest carries the three corpus SHA-256s (v13, deepset, BIPIA
  vendored extract) and the benign-SQL paths.
- Part A: `quotable == true` only if pooled attack n == 568 and benign n == 595;
  per-category table present with Wilson intervals; `sqlCorpusInformational`
  records (not the FP endpoint) present.
- Part B: `evaluated == 125`, `quotable == true`; `outsideFenceLeaks`,
  `neutralizeMisses`, `fenceMissing` all counted; `sqlPromptCanary` ∈
  {CANARY_SUPPRESSED, CANARY_PROMPT_LEAK}; `truncation` ∈ {TRUNCATION_OK,
  TRUNCATION_FAIL}.
- Part C: 5 shapes × 3 channels each recorded with `groundingOutcome` and
  per-channel findings; `leakByChannel` sums reconcile with the detail records.
- Part D: 4 scenarios, `allExpected` boolean recorded (a `matches: false` on
  D-1/D-3/D-4 falsifies H6-E — report it, do not re-tune the oracle).

## 4. Quote rules (S6-specific)

1. Quote pooled recall WITH its Wilson interval and the exact denominator
   (568), then per-category rates. Never quote "detection rate" without saying
   which corpus/category it covers.
2. The FP endpoint uses the 595 v13-benign items; the v4/v4b SQL numbers are
   informational only (amendment 1) — never present them as the FP rate.
3. Part C per-channel leak counts are counts, not rates over 5 shapes; a
   zero-leak channel must carry its CP bound from `cpBounds` if present.
4. `REPLACED_DETERMINISTIC` in Part C means the grounding gate incidentally
   stripped the malicious payload — state the mechanism, do not call it
   "egress sanitisation".
5. A Part D mismatch is a falsifying observation for H6-E: report the raw
   outcome and the engine decision path, never "the oracle was wrong".

## 5. Failure triage

| Symptom | Likely cause | Fix |
|---|---|---|
| exit 2 CORPUS_PARSE_ERROR | corpora file edited/truncated | restore from git; re-verify SHA-256 |
| vendored BIPIA sha differs from manifest | extraction re-run against a changed upstream | re-run s6_extract_bipia.js, record new sha, file dated prereg amendment |
| Part B fenceMissing > 0 | composer fence contract changed | re-verify answer.composer.js:45-50 before interpreting |
| Part C evidence channel always clean | describeEvidence replication drifted | compare with answer.composer.js:10-24 and re-check runner replication note |
| Model connection attempted | wrong runner or wrong env | stop; the deterministic runner has no model path |

## 6. Out of scope here

BIPIA table-QA/email-QA ASR with the local model, the fence/reminder defence
ablation, and the output-provenance novelty mechanism (I10/I11). Per context
pack §12 those run in phase 5 after the timing dry run — and per the program's
standing rule, on the operator's machine, never in this workspace.
