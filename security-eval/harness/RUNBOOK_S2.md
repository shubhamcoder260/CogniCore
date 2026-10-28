# RUNBOOK — S2 (Access Control Suite) Manual Run

Companion to `RUNBOOK_S1.md` (same environment, same fixtures for the realm
databases). Covers the three runnable S2 components:

| Component | Runner | LLM? | Fixtures |
|---|---|---|---|
| S2-B Part 1 (H2-A multi-tenant isolation) | `s2_b_runner.js` | none | `multi_tenant_bank.sqlite` (setup/08) |
| S2-B Part 2 (H2-B child-FK isolation, D-04) | `s2_b_runner.js` | none | `child_projects.sqlite` (setup/03) |
| S2-B Part 3 (V3 replay **with O10 triage**) | `s2_b_runner.js` | none | 15 realm DBs (same as S1-A) + optional canaries |
| S2 probes (I5: P1–P5) | `s2_probe_runner.js` | none | self-contained synthetic fixture |
| S2-C scaling (policy tiers 1–250) | `s2_scaling_runner.js` | none | none (in-process timing) |

Verified: zero LLM/Ollama references in all three runners. S2-A Tier 1 stays
blocked (spider.zip missing, I2) and Tier 2 stays declared NOT RUN (LLM-based
chat replay) — see `reports/ERRATA_S1_S2.md` §3.

---

## 0. Prerequisites

Identical to `RUNBOOK_S1.md` §0 (Node ≥ 18, `npm ci` in `server/`, `NODE_PATH`,
sqlite3 CLI, oracle selftest 10/10). If you already ran S1, skip ahead.

## 1. Build the three S2 fixtures

```bash
export NODE_PATH=$PWD/server/node_modules
node security-eval/harness/setup/08_build_multi_tenant_bank.js   # -> data/fixtures/multi_tenant_bank.sqlite
node security-eval/harness/setup/03_build_child_fixture.js       # -> data/fixtures/child_projects.sqlite
node security-eval/harness/setup/02_convert_job_postings.js      # -> data/fixtures/job_postings.sqlite
node security-eval/harness/tools/fixture_manifest.js             # refresh FIXTURE_MANIFEST.json
```

Commit the built fixtures **and** the refreshed manifest together. The 15 realm
DBs for V3 are the same files S1-A uses — if you placed them in
`security-eval/data/fixtures/database/` for S1, Part 3 needs nothing more.

## 2. Canary map (optional, shared with S1-A)

`data/canaries.json` powers the V3 canary scan (`s2_b_runner.js:462,554`).
Without it, triage verdicts are still computed; canary matches are simply
absent. Seed via `harness/setup/07_seed_canaries.js` and merge, as in
`RUNBOOK_S1.md` §3.

## 3. Dry run (no execution)

```bash
node security-eval/harness/runners/s2_b_runner.js --rung 9cde26c --dry-run
```

Expected: strict loader parses `validation/data/v3/v3_queries.jsonl` (any
malformed line aborts with the line number); every Part 1 pattern and all 510 V3
items log `DRY_RUN` records; nothing executes. Fixture preflight is reported but
waived in dry-run mode.

## 4. Real run — S2-B

```bash
node security-eval/harness/runners/s2_b_runner.js --rung 9cde26c
```

Writes `security-eval/runs/<timestamp>_s2_b_9cde26c/`: `manifest.json`,
`s2_b_results.jsonl`, `s2_b_summary.json`. Optional `--limit N` for a smoke pass.

What each part must show:

- **Part 1 (H2-A):** console line `Part 1 Completed: X/Y ALLOWED-EXACT, ... LEAKS.`
  Historically 48/48 ALLOWED-EXACT with 0 leaks. Any leak here is a regression to
  document, not to hide.
- **Part 2 (H2-B / D-04):** reports confirmed child-table exposures. This part is
  a *designed finding* (transitive FK gap under Decision D-04) — exposures here
  are the expected result and feed the paper's known-limitations section.
- **Part 3 (V3 + triage):** every one of the 510 items now gets a full O10
  verdict (`ALLOWED-EXACT` / `LEAK` / `OVER-FILTERED` / `WRONG` / `BLOCKED`,
  plus `TRIAGE_INCOMPLETE` if a purge failed), computed against raw execution +
  a purged ground-truth clone, plus `matchesExpected` vs the corpus
  `expected_outcome` (all 510 items carry one). The 34-items × 15-fixture
  distribution must reconcile to 510.

Acceptance checklist (all must hold):

1. `s2_b_summary.json` `valid: true`; no `SKIPPED_MISSING_FIXTURE` records.
2. V3 verdict distribution present for all 510 items; `measuredLeaks` counter
   populated; the designed-leak probes (the `main.`-qualified namespace-bypass
   items) should now surface as measured `LEAK` verdicts — quote them as
   designed findings with `matchesExpected`, never as "clean executions".
3. Per-part counts reconcile in the summary (Part totals + V3 total).

## 5. Real run — S2 probes (I5)

```bash
node security-eval/harness/runners/s2_probe_runner.js --rung 9cde26c
```

Self-contained (synthetic fixture, no realm DBs, no server). Writes
`runs/<timestamp>_s2_probes_9cde26c/` with `s2_probe_results.jsonl` +
`s2_probe_summary.json`. Five probes: P1 aggregate side-channel (H1-C), P2 role
alias matrix, P3 PolicyError text, P4 schema endpoint, P5 admin bypass.

P4 is opt-in HTTP: without the flag it records `NOT_RUN_HTTP_DISABLED` (honest,
quotable). To run it, start the app server yourself and re-run with
`--schema-url http://localhost:3000/api/schema` — P4 only fetches that endpoint
and never touches the LLM; if you prefer to keep the server unstarted, skip P4.

## 6. Real run — S2-C scaling

```bash
node security-eval/harness/runners/s2_scaling_runner.js --rung 9cde26c
```

Pure in-process `enforcePolicy` timing over synthetic policies, tiers
[1, 10, 50, 100, 250] × `--iterations` (default 50). No fixtures, no LLM.
Compare mean-ms-per-tier honestly: the earlier "Linear O(N)" label was
withdrawn (ERRATA D4) because the original means were non-monotonic
(0.197 → 0.158 → 0.172 → 0.239 → 0.281). Report the raw means; label the trend
only if it is actually monotonic this time.

## 7. Quote rules (S2-specific, per README §5)

- Quote the V3 **verdict distribution** and `measuredLeaks`; the old
  "clean executions" metric no longer exists (ERRATA §2).
- `matchesExpected` is the headline: measured verdict vs corpus expectation.
  Divergences are findings, not noise.
- `valid: false` runs are unquotable — fix the cause and rerun.
- The old "225 Safely Blocked" number is withdrawn: it counted 30
  over-filtered items as blocked (ERRATA §2).
- S2-A Tier 1 / Tier 2 remain declared NOT RUN; do not backfill numbers for
  them from any other source.

## 8. Commit the run artifacts

```bash
git add security-eval/runs/<timestamp>_s2_b_9cde26c/ \
        security-eval/runs/<timestamp>_s2_probes_9cde26c/ \
        security-eval/runs/<timestamp>_s2_scaling_9cde26c/
git commit -m "data(security-eval): S2-B (with O10 triage), I5 probes, S2-C scaling runs (rung 9cde26c)"
```

Raw JSONL is the evidence base; all downstream numbers must recompute from it.

## 9. Failure triage

| Symptom | Cause | Fix |
|---|---|---|
| Abort before Part 1: V3 fixtures missing | realm DBs absent | restore the 15 DBs under `data/fixtures/database/` (S1 runbook §2) |
| `Corpus ... has N unparseable line(s)` | `v3_queries.jsonl` corrupted | repair the corpus file, rerun dry-run; never hand-patch results |
| `Cannot find module 'better-sqlite3'` | `NODE_PATH` unset | `export NODE_PATH=$PWD/server/node_modules` |
| Part 1 fixture error | `multi_tenant_bank.sqlite` stale/absent | re-run setup/08, refresh manifest |
| H2-B reports no exposures | D-04 behavior changed upstream | treat as a result worth verifying manually, not as a harness bug |
| P4 `HTTP_ERROR` | server not running / wrong URL | re-run with correct `--schema-url`, or leave `NOT_RUN_HTTP_DISABLED` |
