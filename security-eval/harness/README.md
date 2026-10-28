# Security-Eval Harness — Operating Manual

This README closes the reproducibility gaps identified in the independent audit
(Finding E): undocumented `NODE_PATH` and `sqlite3` CLI requirements, missing
fixture provenance, and missing canary-map documentation.

## 1. Environment requirements

| Requirement | Why | Setup |
|---|---|---|
| Node.js >= 18 | runners, worker threads, `fetch` in probe P4 | system package |
| `better-sqlite3` | every runner/oracle | **not** a dependency of `security-eval/` — resolved from `server/node_modules` |
| `sqlite3` CLI (>= 3.40) | `logical_hash_oracle.js` shells out to it | install or place a portable binary on `PATH` |
| `NODE_PATH` | module resolution for harness scripts | `export NODE_PATH=$PWD/server/node_modules` from the repo root |

After cloning:

```bash
git clone --branch security-eval https://github.com/thesauravyadav925925-gif/CogniCore.git
cd CogniCore/server && npm ci && cd ..   # installs 278 packages incl. xlsx (resolves I1)
export NODE_PATH=$PWD/server/node_modules
node --test security-eval/harness/oracles/oracle_selftest.js   # must pass 31/31
```

## 2. Fixtures

Runners abort in **preflight** when a referenced fixture is missing — no partial
runs are produced (an audit response to Finding A's 1,229 silently skipped items).

| Fixture | Required by | Built by | Committed? |
|---|---|---|---|
| `data/fixtures/multi_tenant_bank.sqlite` | S2-B H2-A | `harness/setup/08_build_multi_tenant_bank.js` | yes (`.gitignore` whitelisted) |
| `data/fixtures/child_projects.sqlite` | S2-B H2-B | `harness/setup/03_build_child_fixture.js` | yes |
| `data/fixtures/job_postings.sqlite` | S2-C | `harness/setup/02_convert_job_postings.js` | yes |
| `data/fixtures/database/<domain>/<db>.db` (15 realm DBs) | S1-A, S2-B V3 | operator `database.zip` (SHA-256 verified + authenticity-confirmed 2026-10-28, I2 closed) | to be committed |

Build + verify:

```bash
node security-eval/harness/setup/08_build_multi_tenant_bank.js
node security-eval/harness/setup/03_build_child_fixture.js
node security-eval/harness/setup/02_convert_job_postings.js
node security-eval/harness/tools/fixture_manifest.js   # writes data/fixtures/FIXTURE_MANIFEST.json
```

Commit the built fixtures **and** `FIXTURE_MANIFEST.json` together. The 15 realm
databases are staged from the operator-supplied `database.zip`
(SHA-256 `feef7df886a3478c4d669b1858eed790ab97f7733b1e9504a6673bed15e6d9c9`,
provenance documented in the manifest; verification report
`data/manifests/FIXTURE_SCHEMA_CHECK.md`).

## 3. Canary map (optional, for S1-A exfil assessment + S2-B V3 canary scan)

Runners read `security-eval/data/canaries.json` if present:

```json
{
  "default": ["GLOBAL_CANARY_TOKEN"],
  "bank/B1_community.db": ["CANARY_B1_1", "CANARY_B1_2"],
  "B1_community.db": ["also matched by basename"]
}
```

- Tokens may be plain strings or `{ token, table, column }` objects.
- `security-eval/data/canary/<db_id>/` manifests produced by
  `harness/setup/07_seed_canaries.js` can be merged into this file.
- **Without a canary map**, S1-A still records `returnedRowCount`,
  `returnedColumns` and a row digest for every executed item, and marks
  `exfilAssessment: ROWS_RETURNED_CANARIES_UNAVAILABLE` — measured, honestly
  unassessed, never silently presented as "safe".

## 4. Runners

All runners write to `security-eval/runs/<timestamp>_<suite>_<rung>/`:
a `manifest.json` (commit, runtime versions, input SHA-256 checksums),
a JSONL results file, and a `<suite>_summary.json`.

| Runner | Command | Notes |
|---|---|---|
| S1-A | `node security-eval/harness/runners/s1_a_runner.js --rung 9cde26c` | strict corpus loader; fixture preflight; per-item `executedAttack`, `exfilAssessment`, `canaryMatches`; summary carries `evaluatedCount`, `skippedCount`, `valid`, and zero-event CP bounds with explicit denominators. Exit code 2 on preflight failure. |
| S2-B | `node security-eval/harness/runners/s2_b_runner.js --rung 9cde26c` | V3 part now computes full O10 triage per item: raw (unconstrained) rows, purged ground-truth clone (`DELETE ... WHERE NOT (...)`, quoting mirrors `data.policy.js`), enforced chain, `TriageOracle.triage` verdict, canary scan, `matchesExpected`. |
| S2 probes (I5) | `node security-eval/harness/runners/s2_probe_runner.js --rung 9cde26c` | self-contained synthetic fixture; five probes (aggregate side-channel H1-C, role alias, PolicyError text, schema endpoint (opt-in `--schema-url`), admin bypass). No LLM. |
| Benign | `node security-eval/harness/runners/benign_runner.js` | unchanged |
| S2-C scaling | `node security-eval/harness/runners/s2_scaling_runner.js` | unchanged |
| S1-C | `node security-eval/harness/runners/s1_c_runner.js` | requires sealed C1/C2 corpora (I8) |
| S3 (deterministic) | `node security-eval/harness/runners/s3_runner.js --rung 9cde26c` | SecureSQL 932-sample replay through the production chain; **no LLM**; requires `data/s3/policy_translations.json` (hand-authored from `tools/s3_inspect_benchmark.js` worksheet) + Spider/BIRD databases under `data/downloads/secureSQL/databases/`; prereg `prereg/PREREG_S3.md` pins the benchmark SHA-256 (exit 3 on mismatch); runbook `harness/RUNBOOK_S3.md`. |
| S4 (deterministic) | `node security-eval/harness/runners/s4_runner.js --rung 6f2dd4c\|8205910\|HEAD` | Dependency & relationship leakage: Part A exact declared-FD reconstruction over 14 preregistered allowed-column queries (3 FD arms + control), Part B 10 referential probes compared against a materialised purged clone DB (identical SQL on both sides, result-multiset comparison — C1 fix 2026-10-27, projection/JOIN-safe); **no LLM**; requires `data/s4/fd_declarations.json` + `data/fixtures/fd_leak.sqlite` (both emitted by `setup/09_build_fd_fixture.js`, SHA-256 pinned, exit 3 on mismatch); runbook `harness/RUNBOOK_S4.md`. |
| S5 (deterministic parts) | `node security-eval/harness/runners/s5_runner.js --rung 971d171\|965ba48\|HEAD` | Schema & context leakage: error-text probes (O5-2), 8 preregistered prompt surfaces via direct `buildPrompt`/`buildExplanationPrompt` capture (O5-3), cross-user prompt diff + static cache evidence (O5-4); endpoint scan (O5-1) is HTTP opt-in (`--base-url --tokens-file --dataset-id`, else `NOT_RUN_HTTP_DISABLED`); **no LLM**; requires `data/s5/s5_material.json` + `data/fixtures/s5_context.sqlite` (both from `setup/10_build_s5_fixture.js`); runbook `harness/RUNBOOK_S5.md`. |
| S6 (deterministic parts) | `node security-eval/harness/runners/s6_runner.js --rung 971d171\|965ba48\|HEAD` | Prompt injection: guard recall over 568 pooled attack records = **508 unique payloads** (v13 377 + deepset 116 − 60 verbatim dupes + BIPIA 75; primary denominator per AM-S6-2) + FP on 595 v13-benign items (O6-1), fence compliance over 125 poisoned evidence cells (O6-2), answer-path exfiltration through 5 scripted malicious shapes x 3 channels with the exact engine grounding rule (O6-3), grounding-gate scenarios (O6-4); **no LLM, no network**; corpora vendored + SHA-256 pinned (`data/s6/bipia_text_attacks.json` from `tools/s6_extract_bipia.js`); corpus counts are permanent runtime asserts (exit 2 on drift); runbook `harness/RUNBOOK_S6.md`. |
| Mock LLM stub | `node security-eval/harness/tools/mock_llm_stub.js --port 11435` | Context pack §8: Ollama-protocol recording stub (POST /api/generate, GET /api/tags); scripted responses via `--script`; start the server with `OLLAMA_BASE_URL=http://127.0.0.1:<port>` for full-system S5/S6 runs. Not a model. |
| S7 (retrieval-only) | `node security-eval/harness/runners/s7_runner.js --rung 76c28cf\|HEAD` | RAG & document security: 23-case authorisation battery on an isolated registry DB (route rules replicated from knowledge.js, rbac called directly), retrieval-only poisoning over `data/s7/s7_corpus.json` (15 targets x clean+instruction poison, sizes 50/200/1000) in deterministic scripted mode (`--embed-ollama` switches to the real nomic-embed-text measurement — the only permitted network call, still not an LLM), neutralizeInjection canonical(14)+evasion(8-pair) battery with exact McNemar, provenance-spoof + fence-integrity incl. the structured-cell breakout probe (designed finding expectation S7-F1); **no LLM**; corpus from `setup/11_build_s7_corpus.js` (SHA-pinned); runbook `harness/RUNBOOK_S7.md`. |
| S8 (availability) | `node security-eval/harness/runners/s8_runner.js --rung 903c3c1\|932996b\|HEAD` | Resource exhaustion: 14-class generated battery (gate positive/negative controls, recursive CTE timeout, row cap, repeated + concurrent heavy, health-after) + v4c (29) and v4/boundary (12) replay; gate runs on the harness MAIN thread (the availability surface), every execution in a per-item worker with the preregistered watchdog (timeout+5000 ms); requires `data/fixtures/s8_availability.sqlite` from `setup/12_build_s8_fixture.js` (SHA-pinned); runbook `harness/RUNBOOK_S8.md`. |
| S9 (auth/appsec checklist) | `node security-eval/harness/runners/s9_runner.js --rung 903c3c1\|HEAD` | Auth & application-security checklist: 17 preregistered static checks with file:line evidence (file-missing ⇒ fail, never skip) + 6 probe drivers (lockout, session, first-admin, upload validation, SSRF-injected lookup, CSV-formula); per-rung layer availability content-probed; HTTP corroboration opt-in (`--base-url`); **no LLM**; runbook `harness/RUNBOOK_S9.md`. |
| S10 (actions/tool abuse) | `node security-eval/harness/runners/s10_runner.js --rung 903c3c1\|HEAD` | Actions & tool-use abuse: webhook actions validated/proposed but NEVER executed (zero network by construction), email simulated delivery, save_report on a synthetic semantic dataset, filename sanitization + header-smuggling batteries with generic-vs-specific reject semantics; env set/restored per case; **no LLM, no network**; runbook `harness/RUNBOOK_S10.md`. |

## 5. Aggregation rules (read before quoting numbers)

1. Quote `evaluatedCount` / `evaluatedCountsByCorpusType`, never `totalItems`.
2. The zero-event Clopper-Pearson bound is meaningful only while
   `outcomes.mutationBypass === 0`; use the `attackOnly` denominator for
   attack claims and say which one you are quoting.
3. Attacks with `executedAttack: true` are NOT blocked attacks. Separate
   `BLOCKED-SAFE` (never executed) from `executedAttack` (ran to completion).
4. For S2-B V3, quote the verdict distribution and `measuredLeaks`; do not
   report "clean executions" — that metric no longer exists.
5. A run with `valid: false` (skips or crashes present) must not be quoted.

## 6. Known open items after the audit

**Peer-review self-check (2026-10-27) and fix pass:** the adversarial audit of
all suites against their preregistrations is `reports/PEER_REVIEW_SELFCHECK.md`
(1 CRITICAL + 8 major + 9 honesty findings + 7 notes). The CRITICAL (C1, S4-B
oracle) and all required majors are FIXED with dated amendments in
`prereg/PREREG_AMENDMENTS.md` (AM-S4-1/2, AM-S3-1, AM-S2B-1/2/3/4, AM-S1-1/2,
AM-S6-2/3, AM-S7-1, AM-S2SC-1) plus B6; the selftest was extended to 31/31 and
dry-run smokes re-passed. The fix-status addendum at the end of the selfcheck
lists what was fixed vs disclosed. Note: the audit's own A1 overlap figure
(452 unique) was corrected by the permanent runtime reconciliation to
**508 unique payloads** (60/116 deepset verbatim in v13 attacks) — documented
in AM-S6-2.
- I2: `spider.zip` still missing (`data/downloads/` empty) — S2-A Tier 1 blocked. The realm-database half of I2 (`database.zip` provenance) is CLOSED: operator-supplied 2026-10-28, SHA-256 `feef7df886a3478c4d669b1858eed790ab97f7733b1e9504a6673bed15e6d9c9`, 15/15 layout + integrity + authenticity verified (`data/manifests/FIXTURE_SCHEMA_CHECK.md`).
- I6: ladder re-runs beyond 903c3c1 still pending.
- I8: S1-C corpora seal (C1/C2) still pending.
- `database.zip` provenance for the 15 realm databases: DOCUMENTED + VERIFIED 2026-10-28 (I2 realm half closed; `spider.zip` half remains open).
- I9: S3 policy translation not yet authored (146 distinct conditions in `data/s3/policy_worksheet.json`) and Spider/BIRD databases not yet placed under `data/downloads/secureSQL/databases/` — S3 real runs are preflight-blocked until both exist; benchmark itself is vendored and hash-pinned.
- I10: S3/S4/S6 novelty-track mechanisms (cumulative-disclosure ledger, FK-closure policy propagation, output provenance control) deferred until the baseline is frozen (context pack §9); prior-art check required before any claim.
- I11: S5 Part A endpoint scan and the model-based variants (S5 surrogate-model loop, S6 BIPIA table-QA ASR + defence ablation) are NOT RUN by design until a server-up environment and, respectively, a local model are available (context pack §12 phase 5).
- I12: S7 Part B real-embedding mode (`--embed-ollama`, nomic-embed-text) is NOT RUN here — needs the operator machine with the embedding model pulled; the scripted forced-rank mode is mechanics-only and NOT quotable for leak rates.
- S9/S10 model/HTTP extensions (S9 HTTP corroboration via `--base-url`, S10 LLM-generated proposal corpora) are opt-in or deferred to phase 5; the preregistered in-process batteries are complete.
- Selftest status: `oracle_selftest.js` is **31/31 PASS** (10 original + 2 S3 + 4 S4/S5 + 4 S6-era + 8 S7-S10 controls + 3 S4 C1/B6-era controls).
