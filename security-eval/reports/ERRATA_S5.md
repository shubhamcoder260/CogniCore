# ERRATA — S5 Harness/Rung Interface Defect (Part D crash at 971d171)

**Status:** Defect record. No prior S5 run produced a reconciled summary;
nothing is withdrawn.
**Date:** 2026-10-29
**Scope:** `harness/runners/s5_runner.js` Part D vs rung 971d171 system code.
**Fix:** runner `FIXHASH`; ladder worktrees untouched (history stays frozen).

## 1. Defect

At rung 971d171, the rung's `server/src/semantic/semantic.builder.js:113`
renders `c.stats.missing` unguarded. The frozen S5 material
(`data/s5/s5_material.json`) carries no per-column `stats` for any of its
9 semantic columns, so the rung's `buildPrompt` crashes deterministically
(TypeError: Cannot read properties of undefined (reading 'missing')) on
Part D's first call. The guard `c.stats?.missing` was introduced by the very
next rung, 965ba48 (Item 12, prompt hygiene). The crash is the live
demonstration of the fragility Item 12 fixed.

## 2. Impact

No run at 971d171 ever completed pre-fix (manifest-only attempts kept as
evidence). HEAD and 965ba48 runs were unaffected. Nothing quotable existed
for S5 before the fix; nothing is invalidated.

## 3. Fix

`s5_runner.js` Part D wrapped in try/catch; on rung crash the part records
`RUNG_CRASH` (new outcome label, declared here per prereg hard rules) with
the error string, and the run completes instead of aborting.

## 4. Quotable S5 ladder baseline (post-fix)

| Rung | B (error probes) | C (prompt surfaces) | D (cross-user isolation) | A (endpoint scan) |
|---|---|---|---|---|
| 971d171 (pre-Item-12) | 6/6, leaks=3, quotable | 8/8, leaks=2, quotable | RUNG_CRASH | NOT_RUN_HTTP_DISABLED |
| 965ba48 (Item 12) | 6/6, leaks=3, quotable | 8/8, leaks=6, quotable | SHARING_DETECTED | NOT_RUN_HTTP_DISABLED |
| HEAD | 6/6, leaks=3, quotable | 8/8, leaks=6, quotable | SHARING_DETECTED | NOT_RUN_HTTP_DISABLED |

Ladder finding: prompt-surface leakage (C) rises 2 -> 6 across the Item 12
boundary and persists at HEAD; error-surface leakage (B) is constant (3/6);
cross-user sharing detected from 965ba48 onward. Observed at every rung:
`column_validator_unknown_columns {"count":1,"columns":["secret_column"],"enforce":false}`
(recorded verbatim).

Part A requires a live server + tokens (RUNBOOK_S5 §4); recorded honestly as
NOT_RUN_HTTP_DISABLED.
