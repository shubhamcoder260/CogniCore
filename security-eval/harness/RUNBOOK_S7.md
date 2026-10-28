# RUNBOOK_S7 — RAG & Document Security (retrieval-only + deterministic parts)

Prereg: `security-eval/prereg/PREREG_S7.md` (registered before the runner). Suite code:
`harness/oracles/s7_rag_oracle.js`, `harness/setup/11_build_s7_corpus.js`,
`harness/runners/s7_runner.js`. Rungs: `76c28cf`, `HEAD`.

## 0. Prerequisites

- `NODE_PATH=$PWD/server/node_modules` from the repo root; `sqlite3` >= 3.40 on PATH.
- `oracle_selftest.js` passes 28/28 (S7 has 2 controls).
- Corpus committed: `security-eval/data/s7/s7_corpus.json`
  (build: `node security-eval/harness/setup/11_build_s7_corpus.js`; SHA-256 printed at
  build time and recorded in the run manifest — verify it has not drifted).
- No other fixtures, no LLM, no network (scripted mode).

## 1. Commit checklist (before running anything)

The runner requires the worktree modules: commit `prereg/PREREG_S7.md`,
`harness/oracles/s7_rag_oracle.js`, `harness/runners/s7_runner.js`,
`harness/setup/11_build_s7_corpus.js`, `data/s7/s7_corpus.json`, `.gitignore`
(`!data/s7/**`), and this runbook.

## 2. Dry run (zero execution)

```bash
node security-eval/harness/runners/s7_runner.js --dry-run
```

Expect `DRY-RUN complete — nothing executed.`, `targets: 15, fillers: 1000`, and all
13 layer probes `true`. Delete the smoke run dir afterwards — it is not evidence.

## 3. Real run (scripted mode — deterministic, no model)

```bash
node security-eval/harness/runners/s7_runner.js --rung HEAD
node security-eval/harness/runners/s7_runner.js --rung 76c28cf
```

What happens: an ISOLATED registry DB is created inside the run dir
(`COGNICORE_TEST_DB_PATH` set before the first worktree require — your real registry is
never touched) and deleted afterwards. Parts A/C/D run fully. Part B runs in scripted
forced-rank mode: mechanics validation only, `quotableForLeakRates: false`.

Optional real-embedding measurement (operator machine with Ollama running):

```bash
ollama pull nomic-embed-text   # OLLAMA_EMBEDDING_MODEL, default nomic-embed-text
node security-eval/harness/runners/s7_runner.js --rung HEAD --embed-ollama --sizes 50,200
```

Note: embeddings are batched sequentially (one POST /api/embeddings per chunk); size
1000 means ~1015 embedding calls — budget minutes, not seconds. This is the only
network call in S7 and it is an embedding call, not an LLM generation.

## 4. Acceptance checklist

- [ ] Summary `valid: true`; totals reconcile (Part A exactly 23 cases; Part B 15
      targets x sizes; Part C 14 canonical + 8 evasion; Part D 6 spoof + 15 fence).
- [ ] Part A: `enforced == 23` expected (Item 9); any BYPASSED -> findings entry.
- [ ] Part C: canonical rate with Wilson CI; criterion >= 0.90. Evasion passthrough is
      an EXPECTED designed gap (line-wise neutralizer) — quote it as such, never as
      "the system is injectable" without the second-layer fence context.
- [ ] Part D: label spoofing 0/6 expected; document fence intact 15/15 expected; the
      structured-cell probe (D3) may honestly report FENCE_BROKEN — that is the
      preregistered designed-finding expectation (finding candidate S7-F1: cell values
      bypass the line-wise neutralizer on the composer's JSON path,
      answer.composer.js:16). Measure, then route to the §9 fix track.
- [ ] Part B leak rates quoted ONLY from an `--embed-ollama` run (`mode: "ollama"`).

## 5. Quote rules

- Quote `mode` alongside every Part B number: `scripted` = mechanics, unquotable for
  leak rates; `ollama` = quotable with Wilson CIs.
- H7-B1 has a preregistered threshold (>= 0.50 top-5 inclusion at size 200) — apply it
  only to a real-embedding run.
- Runs with `valid: false` are unquotable. Never convert a NOT_RUN part into a number.

## 6. Triage

| Symptom | Cause | Fix |
|---|---|---|
| exit 2 `CORPUS_LOAD_FAILED` | corpus missing/drifted | rebuild with setup/11; re-pin SHA |
| exit 2 `WORKTREE_REQUIRE_FAILED` | rung worktree missing | build `../cognicore-ladder/<hash>`; symlink server/node_modules |
| Part A BYPASSED | real authorisation gap | findings register; do NOT edit server/ on this branch |
| ollama mode slow | sequential /api/embeddings | reduce --sizes; keep the run running to completion (checkpoints resume) |
| `sqlite3: not found` warning | CLI not on PATH | portable binary per harness/README §1 |
