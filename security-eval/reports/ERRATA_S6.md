# ERRATA — S6 Harness Defects on First Real Run

**Status:** Defect record. No prior S6 run produced a reconciled summary;
nothing is withdrawn.
**Date:** 2026-10-29
**Scope:** `harness/runners/s6_runner.js` — summary accessor + canary-probe
input well-formedness.
**Fix:** runner `FIXHASH`; ladder worktrees untouched.

## 1. Defects

1. **Stale summary accessor (all rungs):** the summary block read
   `partA.attackRecall.pooled`, a key that no longer exists — Part A was
   restructured by AM-S6-2 into flat keys
   (`attackRecallUniquePooled` / `attackRecallPooledRecordsNotPrimary`),
   and the oracle nests the metrics under `.pooled`. The summary block was
   never updated, so the first real run crashed at summary stage
   (TypeError: reading 'pooled') on every rung.
2. **Canary-probe semantic not well-formed for historical rungs (971d171):**
   the inline semantic passed to `buildPrompt` carried no per-column `stats`;
   pre-965ba48 `renderSemanticPrompt` reads `c.stats.missing` unguarded
   (see ERRATA_S5 §1) → deterministic crash at that rung.

## 2. Impact

No S6 run had ever completed before the fix (manifest-only attempts kept as
evidence); nothing quotable existed, nothing is invalidated. Preregistered
totals (568 pooled / 508 unique / benign 595 / Part B 125) unchanged.

## 3. Fixes

1. Summary accessor: `partA.attackRecallPooledRecordsNotPrimary.pooled`.
2. Canary semantic gains `stats: { missing: 0 }` — harness input
   well-formedness only; probe content (canary string) unchanged, rungs
   untouched. The console line now quotes the PRIMARY unique-payload recall
   first, per the AM-S6-2 quoting rule.

## 4. Note on preflight

`--dry-run` validates corpus presence only; it executed no parts and caught
neither defect. Real runs remain the only execution-coverage check.

## 5. Quotable S6 ladder baseline (post-fix)

| Metric | 971d171 | 965ba48 | HEAD |
|---|---|---|---|
| A primary recall (unique payloads) | 25.59% (130/508) | 25.59% (130/508) | 25.59% (130/508) |
| A pooled-records form (comparability only) | 23.06% (131/568) | 23.06% (131/568) | 23.06% (131/568) |
| A FP on benign questions | 0.00% (0/595) | 0.00% (0/595) | 0.00% (0/595) |
| B outside-fence leaks / truncation | 0/125, OK | 0/125, OK | 0/125, OK |
| B SQL-prompt canary | CANARY_PROMPT_LEAK | CANARY_SUPPRESSED | CANARY_SUPPRESSED |
| C leaks by channel (answer/evidence/rows) | 3/5, 0/5, 0/5 | 3/5, 0/5, 0/5 | 3/5, 0/5, 0/5 |
| D allExpected | true | true | true |
