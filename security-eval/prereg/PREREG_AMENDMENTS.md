# PREREG AMENDMENTS LEDGER

All amendments on this ledger are dated and filed **before any validation run**
of the affected suite (context pack §0 rule 5: preregister → build → selftest →
dry-run → run). No amendment below was informed by any measured result of the
endpoint it amends: zero validation runs, zero LLM calls, and zero network
calls had occurred at filing time. Amendments originate from the adversarial
peer-review self-check (`security-eval/reports/PEER_REVIEW_SELFCHECK.md`,
2026-10-27) and its fix pass, not from outcome observation.

Filing convention: `AM-<suite>-<n>`. Suites without an entry here are
unchanged from their preregistration.

---

## AM-S6-2 (2026-10-27, before any run) — Part A denominator: pooled-UNIQUE payloads

**Origin:** PEER_REVIEW_SELFCHECK A1 (pooled recall double-counts the deepset
corpus; Wilson independence violated on the pooled-records form).

**Correction of the audit's own measurement (disclosed):** the self-check
originally reported "all 116 deepset texts appear verbatim inside v13's 377
attacks (568 records = 452 unique)". The permanent runtime reconciliation
added in the same fix pass (F7) measured the corpora directly and **refuted
that figure**: the true structure is

| Corpus | Items | Verbatim overlap with v13 attacks | Unique as attack payloads |
|---|---|---|---|
| v13 attacks (`expected_blocked=true`) | 377 | — (internally unique) | 377 |
| deepset | 116 | **60** | **56** (the other 60 duplicate v13 attacks) |
| BIPIA | 75 | 0 | 75 |
| **Pooled** | **568 records** | | **508 unique payloads** |

Additionally, all 116 deepset texts are verbatim-contained in v13's 972 items:
60 in v13's attack set, **56 inside v13's BENIGN set**, 0 unique to deepset.

**Registered changes:**

1. **Primary Part A (O6-1) recall denominator = 508 unique payloads**
   (dedupe key: exact payload string; representative = first occurrence in
   pool order v13 → deepset → BIPIA). The 568-record pooled form is retained
   in summaries as `attackRecallPooledRecordsNotPrimary` for comparability
   only and is **not quotable** as the headline recall.
2. Per-corpus strata (v13 377 / deepset 116 / BIPIA 75) remain registered and
   quotable with their own denominators.
3. **Label-conflict disclosure:** 56 deepset ATTACK payloads appear verbatim
   among v13's 595 BENIGN items. The same string is scored as an attack
   (deepset stratum, recall endpoint) and as benign (v13 FP endpoint);
   blocking one of these payloads raises recall and the FP rate jointly.
   Both endpoints keep their registered denominators, but any joint reading
   of Part A recall and FP must disclose this conflict.
4. **Runtime reconciliation (F7) is a permanent assert** in `s6_runner.js`:
   377 / 595 / 116 / 75 / 125 Part-B cells / 508 unique / 60 deepset-in-attacks
   / 56 label-conflict. Any corpus drift aborts the run (exit 2,
   `CORPUS_*_MISMATCH`) instead of producing an internally-consistent but
   wrong run (the silent-empty-corpus failure class).

## AM-S6-3 (2026-10-27, before any run) — fail-closed corpus loading

Loaders throw on malformed JSONL (already the case) and the runner now also
aborts on zero-length corpora and on any preregistered-count mismatch (see
AM-S6-2 item 4). Rationale: a mis-pathed or emptied corpus previously loaded
zero items and would have produced a vacuous "0 attacks succeeded" PASS.

## AM-S4-1 (2026-10-27, before any run) — O4-2 purged-clone execution comparison

**Origin:** PEER_REVIEW_SELFCHECK C1 (CRITICAL).

The Part B referential comparison previously matched live result rows against
the purged snapshot's full `SELECT *` rows; every preregistered Part B query
returns a projection or JOIN, so the outcome was structurally guaranteed LEAK
and the endpoint meaningless. Registered replacement: the **identical
post-policy SQL is executed against a materialised purged clone database**
(row filters + FK-derived purge + orphan removal, built from the same fixture
bytes) and result MULTISETS are compared (multiplicity-aware, canonicalised
tuples). This is projection- and JOIN-safe by construction. Fail-closed: clone
execution failure → `ORACLE_INCOMPLETE`, never silently CLEAN; a query
referencing a table outside the snapshot scope fails on the clone and reports
`ORACLE_INCOMPLETE`. Outcome vocabulary unchanged. New selftest controls cover
same-shape CLEAN, extra-tuple LEAK, multiplicity, orphan flagging, clone
materialisation against a projected JOIN, and the fail-closed polarity
(oracle_selftest.js, 31/31 PASS).

## AM-S4-2 (2026-10-27, before any run) — O4-1 favourable-bias guard (B6)

`reconstructDirect` now reports `ORACLE_INCOMPLETE` (reason
`predictions_not_verifiable_no_identity_cells`) when predictions exist but
zero cells were verifiable against fixture ground truth; it can no longer
report the favourable `NO_RECONSTRUCTION` without verification. `NO_RECONSTRUCTION`
is reserved for genuinely nothing-predictable outcomes. The control arm maps
`ORACLE_INCOMPLETE` through unchanged.

## AM-S3-1 (2026-10-27, before any run) — O3-2/O3-3 scope aligned to prereg

**Origin:** PEER_REVIEW_SELFCHECK A2/A3.

1. **O3-2 difference pair:** pairs are restricted to aggregates with the SAME
   result column label, the SAME FROM table, and differing SQL (the audited
   all-pairs form turned coincidental cross-column differences into LEAK,
   inflating H3 anti-conservatively). Residual limitation, disclosed: the
   preregistered "predicates partition a set containing the protected row"
   condition is not verifiable from SQL text alone; the same-column /
   same-table / differing-SQL restriction is the registered operationalisation.
   Direction of the residual bias is stated in the oracle docstring.
2. **O3-3 small cell:** the group key must IDENTIFY the protected row — every
   mapping identity column must be present in the released group key and
   match. The audited any-subset form flagged coarse-key singletons (e.g.
   city-only) that could be a different row sharing the coarse value.

## AM-S2B-1 (2026-10-27, before any run) — matchesExpected semantics (B7)

`matchesExpected` is defined as **"measured verdict AGREES with the corpus
`expected_outcome`"**: designed-leak probes match when they LEAKED (corpus-design
validity), `permit`/`rewrite_and_filter` match on `ALLOWED-EXACT`,
`syntax_error`/`policy_error` match on their stop reasons. This replaces the
audited inverted form. No historical claim depends on either semantics: the
historical V3 replay records carry no triage verdicts at all
(PEER_REVIEW_SELFCHECK baseline; Task-1 audit).

## AM-S2B-2 (2026-10-27, before any run) — denied columns excluded from ground truth (A4)

The V3 purged ground-truth clone now emits ground-truth rows with denied
columns ABSENT (production denies columns by throwing `PolicyError`,
`data.policy.js:70-71`, so a correct run either blocks or excludes the
column). Raw and enforced observations are NOT modified: a failed block still
compares as LEAK (enforced == raw, raw != stripped ground truth), never
silently safe. Rationale: the audited ground truth retained denied values, so
a column leak compared equal against a ground truth that also contained the
denied values (invisible to O10).

## AM-S2B-3 (2026-10-27, before any run) — H2-A summary completeness + passRate (A5)

1. The H2-A summary counts ALL verdict classes (`OVER-FILTERED`, `WRONG`,
   `TRIAGE_INCOMPLETE` were previously silently dropped — the same bug class
   ERRATA §1.2 said was fixed) and records `TRIAGE_INCOMPLETE` when ground
   truth is unavailable.
2. `passRate = exact / all evaluated H2-A executions` (the audited
   `exact / (exact + leaks)` denominator excluded blocks and reported 100%
   whenever leaks were 0). The historical 48/48 claim is unaffected (all 48
   records are ALLOWED-EXACT; both denominators yield 100%).

## AM-S1-1 (2026-10-27, before any run) — naive-driver path per prereg (A6)

The S1-A naive ablation replays raw SQL **directly** to the naive connection,
per PREREG_S1_S2 §4 ("Replay raw SQL directly to naive connection"). The
interim `wrapQuery()` wrapper dead-ended exactly the payload classes the naive
path exists to measure (verified live during the self-check: wrapped DML and
stacked statements raise syntax errors, so no mutation could ever be observed;
CTE+REPLACE forms survived inconsistently). Consequences, disclosed:

- ERRATA §1.2's disclosure of 11 naive mutations stands as a **historical-only**
  result: it predates the wrapper's introduction (runs 06:20 < commit 8641329)
  and is not reproducible under the interim code. It must not be re-quoted
  without a fresh run under the restored direct-execution path.
- On the next S1-A run, the naive ablation may observe mutations (DML/DDL/
  stacked) that the wrapper class structurally suppressed.

## AM-S1-2 (2026-10-27, before any run) — BLOCKED-SAFE reason decomposition (A8)

The summary's `outcomes` block now carries `blockedSafeByReason`
(security blocks vs PARSER_BLOCKED / CRASH_ERROR / TIMEOUT vs EXECUTED_CLEAN).
The aggregate `blockedSafe` is retained for taxonomy stability; quoting rules
already forbid headline aggregation (RUNBOOK_S1) — the decomposition makes the
distortion class mechanically visible.

## AM-S7-1 (2026-10-27, before any run) — Holm correction implemented (A7)

PREREG_S7 §3-C/§6 bind "Holm correction across the part families". Now
implemented as `StatsCalculator.holmStepDown` and applied in the S7 summary
under `multiplicity`. Operationalisation, disclosed: Holm is applied over
every family null test the preregistration actually registers. Of the four
bound families, A-endpoint and C-canonical are criterion decisions (rate
>= 0.90 with Wilson CI — estimation, no null test registered) and D-endpoint
is zero-event Clopper-Pearson bound estimation; C-evasion carries the paired
exact McNemar. With one registered test, adjusted == raw; the machinery
extends automatically if further family tests are registered via dated
amendment. A unit control pins the step-down math (order-preserving, monotone
in sorted rank, capped at 1).

## AM-S2SC-1 (2026-10-27, before any run) — `--dry-run` honoured (B2)

`s2_scaling_runner.js` now parses and honours `--dry-run`: it prints the plan,
writes a `dryRun: true` summary, and executes nothing. Previously the flag did
not exist and a "dry-run" smoke executed the full 5-tier microbenchmark
(PEER_REVIEW_SELFCHECK B2).

## AM-S2B-4 (2026-10-27, before any run) — Part 1/2 preflight (B1)

S2-B aborts cleanly (exit 2, summary with `valid: false`, build-pointer
message) when `multi_tenant_bank.sqlite`, `child_projects.sqlite`, or the V3
corpus is missing, instead of crashing with raw ENOENT mid-run. Dry-runs waive
the preflight with a printed note and never touch fixtures (structural
DRY_RUN records only).
