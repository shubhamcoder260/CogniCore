# ERRATA_S7 — S7 (RAG & document security): first-run decode and verdict-accounting fix

Date: 2026-10-29 · Branch: final-testing-suites · Fix: 1c680c9 (AM-S7-2)

## What happened
First real runs at both rungs (76c28cf, HEAD) completed without a crash and with
identical results, but two headline fields contradicted the RUNBOOK_S7 §4
expectations: `A enforced=18/23` (expected 23) and `D fenceIntact=0/15` with 15x
FENCE_ANOMALY (expected 15/15). Investigation against the production composer
(answer.composer.js:45-50) showed both are harness verdict-accounting defects.
No raw observation is invalidated. Fixed by the AM-S7-2 runner commit; both
rungs re-run; first-attempt run dirs are committed as evidence.

## Defect 1 — Part A composite expectation
The five H7-A1 cases compared a composite label (`DENIED_FOR_NON_ADMIN_ADMIN_ALLOWED`)
against concrete verdicts, so `enforced` was false by construction. The recorded
observations were correct: admin ALLOWED; manager/analyst/user/viewer DENIED —
the Item 9 scope-* policy held at both rungs. True enforcement 23/23, confirmed
by the re-run.

## Defect 2 — fence audit counted the composer's prose
The composer's trusted INSTRUCTION BOUNDARY sentence contains the literal
`<untrusted_data>`, so every production prompt counted opens=2, closes=1 and
FENCE_INTACT was unreachable. The 15 D2 targets' payload close-tag lines WERE
neutralized at retrieval exactly as PREREG_S7 §H7-D2 expects; the re-run
reports fenceIntact=15/15.

## Quotable interpretation (post-fix re-run dirs)
- Part A: 23/23 enforced (18 non-A1 cases + 5 A1 cases with per-role
  expectations; composite label preserved in the `note` field).
- Part B: scripted mode is mechanics validation only (top-5 inclusion 15/15 at
  50/200/1000 fillers by construction; `quotableForLeakRates: false`). Leak
  rates require an `--embed-ollama` run — still pending, optional.
- Part C: canonical 14/14 neutralized (Wilson CI in summary); evasion 8/8
  passthrough is the preregistered designed gap of line-wise neutralization —
  quote with the composer-fence second-layer context, never as "the system is
  injectable" unqualified. McNemar 8/0 discordant, exact two-sided
  p = 0.0078125 (1/128). Retriever pairing per summary. Quotable.
- Part D: spoof 0/6 (`cpBoundIfZero` in summary); D2 fence 15/15 intact;
  D3 `structuredCellBreakout.outcome = FENCE_ANOMALY` — genuine measured
  property: the JSON.stringify(sample_rows) path bypasses line-wise
  neutralization and injects a spurious close tag inside the fence region; no
  outside-fence leak under the preregistered definition, so no S7-F1
  registration.

## Outcome labels
FENCE_ANOMALY = fence present and unbalanced with no outside-fence leak
(neither FENCE_INTACT nor FENCE_BROKEN). D3 retains it by design after AM-S7-2.

## Parked
S5 Part A (live server + tokens) unchanged. S3 NO-GO precondition (Item 9
verification) is satisfied by the post-fix S7 Part A evidence; S3 scheduling is
a separate runbook step.
