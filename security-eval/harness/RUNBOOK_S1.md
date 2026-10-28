# RUNBOOK — S1 (SQL Injection Suite) Manual Run

Audience: the operator running S1 on their own machine. This covers **S1-A only**
(3,191 items across 6 corpora). It encodes the audit fixes and the prereg rules
(raw JSONL recomputability, no fabrication, deviations declared).

**S1-A involves zero LLM calls** (verified: no Ollama/LLM/chat references in the
runner). It exercises only the deterministic production chain: table repair →
SQL validation → row policy → sandboxed execution.

Out of scope here: **S1-B** is formally declared NOT RUN (see
`reports/ERRATA_S1_S2.md` §3); **S1-C** stays blocked until the sealed C1/C2
corpora arrive (open item I8). S2 re-runs: see `harness/README.md` §4.

---

## 0. Prerequisites

| Requirement | Check |
|---|---|
| Node.js ≥ 18 | `node --version` |
| `server/` deps installed | `cd server && npm ci && cd ..` (278 pkgs incl. xlsx) |
| `better-sqlite3` reachable | `export NODE_PATH=$PWD/server/node_modules` from repo root |
| `sqlite3` CLI ≥ 3.40 on PATH | `sqlite3 --version` (only needed by oracles, not the runner itself) |
| Oracle self-test green | `node --test security-eval/harness/oracles/oracle_selftest.js` → must pass 10/10 |

## 1. Commit the audit fixes first

The working tree carries 4 modified + 5 new paths. Commit them before running so
the run manifest records a clean commit:

```bash
git add security-eval/.gitignore \
        security-eval/harness/runners/s1_a_runner.js \
        security-eval/harness/runners/s2_b_runner.js \
        validation/data/v4/attacks.jsonl \
        security-eval/harness/README.md \
        security-eval/harness/runners/s2_probe_runner.js \
        security-eval/harness/tools/fixture_manifest.js \
        security-eval/reports/ERRATA_S1_S2.md \
        security-eval/reports/INDEPENDENT_AUDIT_S1_S2.md
git commit -m "fix(security-eval): repair v4 attack corpus, harden S1-A/S2-B runners, add I5 probes, publish ERRATA"
```

## 2. Place the 15 realm fixtures

S1-A resolves every item against `security-eval/data/fixtures/database/<fixture_db>`
(leading `database/` in corpus values is stripped automatically). All 15 must exist
or preflight aborts (exit code 2). Source: the project's original `database.zip`,
supplied by the operator 2026-10-28 (open item I2 CLOSED — provenance documented:
SHA-256 `feef7df886a3478c4d669b1858eed790ab97f7733b1e9504a6673bed15e6d9c9`;
integrity ok 15/15; authenticity confirmed — all 637 statements the original S1-A
run executed compile clean against these schemas; see
`data/manifests/FIXTURE_SCHEMA_CHECK.md` and `data/fixtures/FIXTURE_MANIFEST.json`).

```
bank/B1_community.db        bank/B2_district.db       bank/B3_metro.db
fooddelivery/F1_quickbite.db fooddelivery/F2_citygrub.db fooddelivery/F3_national.db
hospital/H1_clinic.db       hospital/H2_legacymed.db  hospital/H3_metropol.db
industry/I1_workshop.db     industry/I2_factory.db    industry/I3_plantops.db
university/U1_stateuniv.db  university/U2_metrouniv.db university/U3_institute.db
```

Notes: the 166 `v4/regressions.jsonl` records carry no `fixture_db` and default to
`bank/B1_community.db` by design (they target the `brs` table there). Verify
placement with `node security-eval/harness/tools/fixture_manifest.js`.

## 3. (Recommended) Seed canaries

Without a canary map, executed items still get `returnedRowCount`/`returnedColumns`
plus a row digest, but `exfilAssessment` degrades honestly to
`ROWS_RETURNED_CANARIES_UNAVAILABLE`. To get full leak assessment:

```bash
node security-eval/harness/setup/07_seed_canaries.js   # writes per-db token manifests
# merge security-eval/data/canary/<db_id>/ manifests into security-eval/data/canaries.json
# format: { "default": ["TOKEN"], "bank/B1_community.db": ["T1", ...] }
```

## 4. Dry run (no execution)

```bash
export NODE_PATH=$PWD/server/node_modules
node security-eval/harness/runners/s1_a_runner.js --rung 9cde26c --dry-run
```

Expected: strict loader parses all 6 corpora (any malformed line aborts with the
line number), logs `DRY_RUN` records for all 3,191 items, executes nothing.
Counts must reconcile: 1,348 + 166 + 352 + 640 + 220 + 465 = 3,191.

## 5. Real run

```bash
node security-eval/harness/runners/s1_a_runner.js --rung 9cde26c
```

- Deterministic, no network, no LLM; writes to `security-eval/runs/<timestamp>_s1_a_9cde26c/`:
  `manifest.json`, `s1_a_results.jsonl`, `s1_a_summary.json`.
- Exit codes: `0` clean, `1` fatal error, `2` preflight failure (missing fixture — fix paths, rerun).
- Optional: `--limit 50` for a smoke pass first; `--worktree <dir>` to target another ladder rung.

## 6. Accept the run (all must hold)

1. Exit code 0; `s1_a_summary.json` has `valid: true`.
2. `evaluatedCount == 3191`, `skipped == 0`, no `ERROR_MISSING_FIXTURE` anywhere.
3. `outcomes.mutationBypass` CP bounds present with **both** denominators
   (`allEvaluated` and `attackOnly`), valid only while bypass count is 0.
4. Every record with `executedAttack: true` carries a measured `exfilAssessment`
   (`NO_ROWS_RETURNED` / `CANARY_LEAK` / `ROWS_RETURNED_CANARY_SCAN_CLEAN`) —
   not `ROWS_RETURNED_CANARIES_UNAVAILABLE` if you seeded canaries in step 3.
5. `evaluatedCountsByCorpusType` sums to `evaluatedCount`.

## 7. Quote rules (README §5, S1-specific)

- Quote `evaluatedCount`, never `totalItems` (3,191 is the corpus size, not n).
- Attack claims use the **attack-only** CP denominator; say which denominator you quote.
- `BLOCKED-SAFE` (never executed) ≠ `executedAttack` (ran to completion). Never sum
  them into "attacks blocked".
- `falseAccept` flags mark attacks whose expected outcome was `reject` but which
  executed — report them separately, they are the dangerous class.
- If `valid: false`, the run is unquotable — fix and rerun.
- The old headline numbers ("1,352 blocked", "0.0938%") are **withdrawn**; see
  `reports/ERRATA_S1_S2.md` §1 for the corrected quotable table.

## 8. Commit the run artifacts

```bash
git add security-eval/runs/<timestamp>_s1_a_9cde26c/
git commit -m "data(security-eval): S1-A run on repaired corpus (rung 9cde26c)"
```

Raw JSONL is the evidence base; all downstream numbers must recompute from it.

## 9. Failure triage

| Symptom | Cause | Fix |
|---|---|---|
| Exit 2, preflight lists fixtures | realm DBs missing/misplaced | restore from `database.zip` under `data/fixtures/database/`, rerun |
| `Corpus ... has N unparseable line(s)` | corpus file corrupted | do not hand-patch results; repair the corpus file, rerun dry-run |
| `Cannot find module 'better-sqlite3'` | `NODE_PATH` unset | `export NODE_PATH=$PWD/server/node_modules` |
| Summary `valid: false` | skips or crashes during run | inspect `s1_a_results.jsonl` for `status: ERROR_*` records, fix cause, rerun |
