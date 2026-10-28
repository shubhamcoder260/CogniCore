# RUNBOOK — S3 (Inference & Cumulative Disclosure) Manual Run

Companion to `RUNBOOK_S1.md` / `RUNBOOK_S2.md`. Covers the deterministic S3
variant per `prereg/PREREG_S3.md`. **No LLM is invoked anywhere in this suite.**

Benchmark: SecureSQL (Song et al., Findings of EMNLP 2024), Apache-2.0 —
acquired at `data/downloads/secureSQL/repo/data.json`,
SHA-256 `c0bf5fbc…f6c6a4` (pinned by prereg; a mismatched benchmark aborts with
exit 3 and requires a dated amendment, not a silent run).

The suite measures: direct disclosure (DI) blocked by translated policies, the
**inference gap** (PR/RE reconstruction from released result unions — the
expected baseline is that these PASS the per-query chain), specificity/false-
refusal cost on SA/SU, and policy-translation coverage (a first-class result).

## 0. Prerequisites

Same environment as S1/S2 (Node ≥ 18, `npm ci` in `server/`, `NODE_PATH`,
oracle selftest). S3 additionally requires its own selftest controls to pass:

```bash
export NODE_PATH=$PWD/server/node_modules
node --test security-eval/harness/oracles/oracle_selftest.js   # must pass 12/12 (10 base + 2 S3)
```

## 1. Verify the benchmark layout (once)

```bash
node security-eval/harness/tools/s3_inspect_benchmark.js
```

Writes `reports/s3_benchmark_layout.json` (provenance + distributions) and
`data/s3/policy_worksheet.json` (146 distinct security conditions with their
sample ids). Aborts non-zero if the layout ever differs from the prereg record.

## 2. Author the policy translation (THE critical manual step)

Fill `data/s3/policy_worksheet.json` by hand against the **real Spider/BIRD
schemas** and save as `data/s3/policy_translations.json`:

```json
{ "translations": [
  { "condition": "<exact benchmark string>",
    "expressible": true,
    "policy": { "deniedColumns": [{"table": "t", "column": "c"}],
                "rowFilters": [{"table": "t", "column": "c", "op": "=", "value": "v"}] },
    "protected": { "table": "t", "columns": ["c1"], "rowPredicate": "id = 42",
                   "canaryCells": [{"table": "t", "column": "c1"}] },
    "provenance": { "author": "<you>", "date": "<date>", "schemaSource": "spider dev" } }
] }
```

- `expressible: false` is a valid, first-class entry (H3-D coverage result).
- No LLM-authored translations (prereg §4). Commit the file **before** any
  quotable run. Coverage below 100% is reported, never hidden.
- `rowPredicate` must select exactly one row for inference oracles to
  operationalize (otherwise those samples become `ORACLE_INCOMPLETE` honestly).

## 3. Place the databases

Per the SecureSQL README, download Spider and BIRD separately and merge their
database folders so that each resolves to:

```
security-eval/data/downloads/secureSQL/databases/<db_id>/<db_id>.sqlite
```

(57 databases across the 932 samples; the same spider.zip flow as S2-A Tier 1 /
open item I2 — one acquisition serves both.) Preflight lists every missing
database and aborts (exit 2) unless `--dry-run`.

## 4. Dry run (no execution)

```bash
node security-eval/harness/runners/s3_runner.js --rung 9cde26c --dry-run
```

Expected: benchmark SHA-256 verified; mapping counted; all 932 samples log
`DRY_RUN` / `POLICY_UNEXPRESSIBLE`; nothing executes, no database touched.

## 5. Real run

```bash
node security-eval/harness/runners/s3_runner.js --rung 9cde26c
```

Writes `security-eval/runs/<timestamp>_s3_9cde26c/`: `manifest.json`,
`s3_results.jsonl`, `s3_summary.json`. Exit codes: 0 clean, 1 invalid summary,
2 preflight (missing benchmark/databases), 3 benchmark-hash mismatch.
Ladder: `--rung 6f2dd4c` and `--rung 8205910` per PREREG_S3 §3 (worktrees under
`../cognicore-ladder/<rung>`, layers absent at a rung recorded NOT APPLICABLE).

## 6. Accept the run (all must hold)

1. Exit 0; `s3_summary.json` has `valid: true` and `quotable: true`
   (`quotable: false` = zero policy coverage — run is layout-valid but recall
   claims are unquotable).
2. `evaluatedCount` reconciles: verdicts + `POLICY_UNEXPRESSIBLE` +
   `SKIPPED_MISSING_DB` = 932; `harnessErrors == 0`.
3. Every violating-class verdict decomposition is visible:
   `LEAK` / `BLOCKED_IN_TIME` / `ATTACK_INEFFECTIVE` / `ORACLE_INCOMPLETE`,
   with `oracleIncompleteRate` reported beside any recall number.
4. Inference mechanisms fired only where operationalizable: records carry
   `protectedInfoAvailable` and `oracleIncompleteReasons`.

## 7. Quote rules (S3-specific)

- Primary quotable: **leak rate with denominator** (`positivesWithPolicy`) and
  the zero-event CP bound when `LEAK == 0`; the H3-A vs H3-B contrast (DI leak
  rate vs PR/RE leak rate) is the paper's headline — quote it per class, never
  pooled.
- `BLOCKED_IN_TIME` follows the prereg definition (chain withheld part of the
  history, no leak in the released subset); per-record `blockedCount` +
  `steps` let reviewers decompose it.
- False-refusal cost on SA/SU is `overBlockedRate` — report it beside any
  recall claim (utility cost, never folded into "blocked").
- Coverage (`policyCoverage.coverageRate`) is quoted beside every claim.
- The old per-model accuracy numbers from the SecureSQL paper are the
  *model's* performance; they are not comparable to this suite's chain-level
  rates and must not be mixed in the same table without that label.
- Expected baseline (prereg): DI leaks blocked; PR/RE leaks pass. If your run
  shows the opposite, verify the mapping before celebrating.

## 8. Commit the artifacts

```bash
git add security-eval/data/s3/policy_translations.json \
        security-eval/data/downloads/secureSQL/repo/data.json \
        security-eval/reports/s3_benchmark_layout.json \
        security-eval/runs/<timestamp>_s3_9cde26c/
git commit -m "data(security-eval): S3 policy translation + benchmark + run (rung 9cde26c)"
```

Raw JSONL is the evidence base; all downstream numbers recompute from it.
(The vendored benchmark is Apache-2.0; `data.json` ~ a few MB — commit it or
record its SHA-256 + source URL in the manifest, consistently with the
fixtures policy.)

## 9. Failure triage

| Symptom | Cause | Fix |
|---|---|---|
| Exit 3, SHA mismatch | `data.json` changed upstream | re-verify provenance, file a dated amendment, re-pin the hash in PREREG_S3 §1 |
| Exit 2, databases missing | Spider/BIRD not placed | download per SecureSQL README into `databases/<db_id>/<db_id>.sqlite` |
| All samples `POLICY_UNEXPRESSIBLE` | mapping file absent | author it from `policy_worksheet.json` (step 2) |
| All violating samples `ORACLE_INCOMPLETE` | `rowPredicate` missing/multi-row | fix mapping predicates so exactly one row matches |
| `Cannot find module 'better-sqlite3'` | `NODE_PATH` unset | `export NODE_PATH=$PWD/server/node_modules` |
| Summary `valid: false` | harness errors / reconciliation gap | inspect `s3_results.jsonl` for `HARNESS_ERROR`, fix, rerun |

## 10. Out of scope here

- The LLM variant (NL questions through /api/chat) — requires its own prereg.
- The cumulative-disclosure ledger (novelty track) — designed in PREREG_S3 §9,
  implemented only after the baseline is frozen (context pack §9).
