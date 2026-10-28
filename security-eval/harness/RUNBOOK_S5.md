# RUNBOOK_S5 — Schema and Context Leakage, deterministic parts (no LLM)

Prereg: `security-eval/prereg/PREREG_S5.md`. Source: Klisura & Rios (Findings of
NAACL 2025), deterministic tests only; the surrogate-model attack loop is
NOT_RUN_MODEL_VARIANT (I11); policy-scoped-context novelty is deferred (I10).

## 0. Prerequisites

```bash
cd <repo> && git checkout security-eval
export PATH=/home/z/my-project/tools/bin:$PATH
export NODE_PATH=$PWD/server/node_modules
cd server && npm ci && cd ..
node security-eval/harness/setup/10_build_s5_fixture.js
# -> data/fixtures/s5_context.sqlite + data/s5/s5_material.json (frozen inventory + policy + poisoned strings)
git add security-eval/data/fixtures/s5_context.sqlite security-eval/data/s5/s5_material.json
git commit -m "security-eval(s5): build s5_context fixture and frozen material (setup/10)"
```

Deterministic build; re-run reproduces
`c209d4a57529b55117f97adefa9694b2462ff7454664c80a2120b530aeeeaa11`.

## 1. Dry run

```bash
node security-eval/harness/runners/s5_runner.js --dry-run
```

Expect `DRY-RUN complete — no probes executed.` The summary echoes the preregistered
part totals (6 error probes, 8 prompt surfaces, 4 endpoint checks).

## 2. Real run (in-process parts; no server needed)

```bash
node security-eval/harness/runners/s5_runner.js --rung 971d171   # Item 3 egress chokepoint
node security-eval/harness/runners/s5_runner.js --rung 965ba48   # Item 12 prompt hygiene
node security-eval/harness/runners/s5_runner.js --rung HEAD
```

Exit codes: 0 ok · 2 preflight · 3 fixture/material SHA-256 mismatch · 1 crash.

## 3. Part A — endpoint scan (HTTP opt-in; else honest NOT_RUN)

Parts B/C/D need no server. Part A drives the real endpoints and needs:

1. A server-up environment (context pack I1: `xlsx` dependency installed once).
2. `s5_context.sqlite` uploaded as a dataset; the viewer/admin role accounts exist;
   the S5 policy applied to the dataset for the viewer role.
3. Login tokens per role (operator-obtained), saved as JSON:
   `{"viewer": "<jwt>", "admin": "<jwt>"}` (file permissions 600; never commit).

```bash
node security-eval/harness/runners/s5_runner.js --rung HEAD \
  --base-url http://127.0.0.1:3000 --tokens-file ./s5_tokens.json --dataset-id <uploaded-id>
```

Without these flags the part records `NOT_RUN_HTTP_DISABLED` and everything else
still runs. The tokens file path is recorded as a boolean, never its contents.

## 4. Accept the run (all must hold)

- `valid: true`; `fixtureSha256` matches the committed material.
- Part B: `evaluated == 6`, `quotable == true`; every probe has `outcome` ∈
  {LEAK_IN_ERROR, NO_LEAK_IN_ERROR, NOT_APPLICABLE_NO_ERROR} with the message
  recorded; zero-leak claims quote `clopperPearsonUpper95_zeroLeaks`.
- Part C: `evaluated == 8`, `quotable == true`; C-S2 is `AUTHORIZED_BASELINE`
  (admin prompt intentionally contains everything — never counted as a leak);
  C-S1 is the Item-12 filter check; C-S3/C-S4/C-S7 measure the unfiltered
  pass-through surfaces; C-S8 answers the canary-suppression check.
- Part D: outcome `NO_PROMPT_CACHE_FOUND` (with staticEvidence) or
  `SHARING_DETECTED` (would falsify H5-D — report as a finding, do not bury it).
- Part A: either `NOT_RUN_HTTP_DISABLED` or per-endpoint records with
  `httpStatus` + `matches`; if both viewer endpoints ran, the `asymmetry` block
  (McNemar b/c over paired element indicators) must be present.

## 5. Quote rules (S5-specific)

1. Never call Part C's C-S2 (admin baseline) a leak — it is the authorized
   reference; leaks are counted on restricted surfaces only.
2. `NOT_APPLICABLE_NO_ERROR` probes reduce the informative denominator: if any
   exist, say how many and which, and do not quote a leak rate over the full 6.
3. Part A claims require the HTTP part to have actually run; a summary with
   `NOT_RUN_HTTP_DISABLED` supports no endpoint statement at all.
4. H5-D falsification (SHARING_DETECTED) is headline material, not a footnote.

## 6. Failure triage

| Symptom | Likely cause | Fix |
|---|---|---|
| exit 3 | fixture/material edited or stale | re-run setup/10, commit both |
| PROMPT_BUILD_ERROR on C-S5/C-S6 | evidence shape drifted from composer contract | check `server/src/response/answer.composer.js:10-24`; runner evidence object must keep `source_type/columns/sample_rows/row_count` |
| O5-2 all NOT_APPLICABLE_NO_ERROR | policy no longer denies the probe identifiers | amendment via setup/10 re-run + dated note; never hand-edit material |
| Part A 401/404 | token expired or dataset id wrong | regenerate tokens; confirm dataset id |

## 7. Out of scope here

Model-based schema-inference loop (I11), policy-scoped-context mechanism (I10),
and any Ollama contact. The runner must make zero network calls unless Part A
flags are supplied — verify with a firewall or `ss -tp` if in doubt.
