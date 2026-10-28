# Peer-Review Self-Check — All Suites S1–S10

**Status:** Independent adversarial audit of the harness against its own preregistrations,
corpora, and historical reports. Every finding below was verified live (code read at
file:line and/or reproduced by execution on this machine). No validation runs, no LLM
calls, no network calls were performed; dry-run smokes were executed and their run
directories deleted.
**Date:** 2026-10-27
**Scope:** 10 preregs, 10 runbooks, 15 runners, 15 oracles, stats.js, 12 setup scripts,
corpora, fixtures, historical reports (PHASE0–5, MASTER, ERRATA), 6 historical run dirs.
**Baseline checks (all PASS):** `node --check` 100% of harness JS; `oracle_selftest.js`
28/28; fixture SHA-256s match declaration JSONs (fd_leak `6aa20425…`, s5_context
`c209d4a5…`, s8 `56c77424…`, s7 corpus `0d881283…`, BIPIA source pin, secureSQL pin
matches PREREG_S3); all 9 preregistered ladder rungs exist (`git cat-file -t`); stats.js
CP/Wilson/McNemar math verified correct; runbook commands reference real files and
only real CLI flags; corpora field names match loader expectations.

Severity legend: **C** = invalidates the named endpoint if run as-is; **A** = major
prereg↔implementation mismatch or metric-definition flaw (fix or file dated amendment
BEFORE any run); **B** = honesty/reconciliation defect; **C-note** = caveat to disclose.

---

## C-class (endpoint-invalidating)

**C1. S4 Part B (O4-2) is structurally guaranteed to report LEAK for every executing query.**
`assessReferential` (s4_inference_oracle.js:198-231) compares returned rows against
`snapshot.tables[primaryTable]` — the purged clone's **full `SELECT *` rows**. Every
preregistered Part B query returns a **column subset or a JOIN projection**
(fd_declarations.json: B-Q1 3 cols of audits; B-Q4/B-Q5/B-Q6 chain_accounts⋈branches⋈…;
B-Q9 2 cols of branches; B-Q10 3 cols of chain_accounts). A projected tuple can never
string-match a full-row tuple, so `leaked = returnedRows.length` regardless of system
behavior; H4's referential endpoint and its CP bound become meaningless, and
`partBLeaks===0` can never occur. Verified by construction (tuple shapes differ) and by
the selftest's blindness: oracle_selftest.js:381-386 tests `assessReferential` only with
**same-shape** rows. **Fix before RUNBOOK_S4:** execute the identical preregistered SQL
against the purged clone and triage result multisets (the s2_b_runner pattern), or
project purged rows onto the query's SELECT list.

## A-class (major — fix or amend before any run)

**A1. S6 Part A pooled recall double-counts the deepset corpus.** All 116 deepset texts
appear verbatim inside v13's 377 attacks (measured: 116/116 overlap; BIPIA 0/75). The
H6-A endpoint pools 377+116+75 = **568 records = only 452 unique payloads**; deepset is
weighted 2× and Wilson independence is violated. PREREG_S6 (AMENDMENT 1) registers 568
as the denominator. Needs a dated amendment (dedupe by payload or report pooled-unique +
per-corpus strata) before the first run.

**A2. S3 O3-2 implemented broader than preregistered.** PREREG_S3 §5: "every ordered pair
of **same-column** aggregates **whose predicates partition a set containing the protected
row**". s3_inference_oracle.js:112-136 checks **all ordered pairs of all released scalar
aggregates** for |a−b| = |protectedValue| — unrelated coincidental differences become
LEAK. Anti-conservative (inflates H3 findings). Same direction in **A3**: prereg O3-3
requires the group key to *identify* the protected row; the implementation (fixed during
selftest) matches on **any present subset** of identity columns with ≥1 present — a
singleton coarse-key group (e.g. city only) counts as identifying.

**A4. S2-B purged ground truth ignores `deniedColumns`.** `buildPurgedClone`
(s2_b_runner.js:83-110) applies only `rowFilters`; all 510 V3 items carry both fields and
225 have non-empty deniedColumns. Any executed query that returns denied-column values is
compared against a ground truth that **also contains them** → ALLOWED-EXACT masks the
column leak (the triage oracle cannot see it; only the optional canary scan could).
Column-level ground truth must also be purged (NULL/drop) for O10 to be a complete leak
oracle.

**A5. S2-B H2-A summary silently drops verdict classes and mis-denominates passRate.**
s2_b_runner.js:313-323 counts only ALLOWED-EXACT/BLOCKED/LEAK — **OVER-FILTERED, WRONG,
TRIAGE_INCOMPLETE increment no counter** and vanish from the summary (the exact bug
class ERRATA §1.2 said was fixed). passRate = exact/(exact+leaks) (line 632) excludes
`h2aBlocked` — 40 exact + 8 blocked + 0 leaks reports 100%. Historical 48/48 verified
genuine (all 48 JSONL records are ALLOWED-EXACT), so past claims stand; the hole opens
on any re-run that produces over-filtering.

**A6. S1-A naive-driver ablation deviates from prereg and is structure-fragile.**
PREREG_S1_S2 §4: Naive-Driver = "Replay raw SQL **directly** to naive connection".
s1_a_runner.js:347-348 wraps raw SQL in `SELECT * FROM (...) LIMIT 1000` first. Verified
live: wrapped `DROP TABLE brs` → syntax error (no mutation measured); direct → table
dropped; wrapped stacked `SELECT 1; DROP TABLE t` → syntax error. The ablation cannot
demonstrate mutation for DML/DDL/stacked payloads — the exact classes the naive path
exists to measure. Worse, the lazy CTE regex (sandbox_manager.js:111) mis-captures
`WITH … REPLACE INTO t (…) SELECT …` into an **executable mutating** statement while
killing `WITH … INSERT …` forms — behaviour depends on payload punctuation. ERRATA §1.2
discloses "11 naive mutations" from the historical run, which predates wrapQuery's
introduction (runs 06:20 < commit 8641329 12:17) and is **unreproducible** under current
code. Needs amendment: naive path per prereg (direct exec) or a dated redefinition.

**A7. PREREG_S7 multiplicity correction (Holm) is implemented nowhere.** Prereg §3-C and
§6 bind "Holm correction across the part families"; `rg -i holm harness/` = 0 matches.
Either implement or amend before S7 runs.

**A8. S1-A BLOCKED-SAFE conflates security blocks with execution failures.**
s1_a_runner.js:364: any non-EXECUTED_CLEAN stop — including PARSER_BLOCKED (syntax
error; no security property), TIMEOUT_ABORTED, CRASH_ERROR — increments
`outcomes.blockedSafe`. firstStopCounts decomposes, and RUNBOOK_S1:112-113 forces the
attack-only denominator and BLOCKED-SAFE≠executedAttack, but the headline "blocked"
metric still counts parse failures as blocks (the same distortion class as the
withdrawn "1,352 blocked" claim). Summary should emit blockedSafe by reason code.

## B-class (honesty/reconciliation)

**B1. S2-B dry-run crashes without fixtures** (verified: exit 1, raw ENOENT at
s2_b_runner.js:242 — purged-clone build precedes the dry-run guard; Part 1 has no
fixture preflight). "Dry-run logs DRY_RUN records" holds only after setup/08+03.
Also `sqlite3` CLI absence prints mid-run (`/bin/sh: sqlite3: not found`) — documented
prerequisite, but hardening is cheap.

**B2. s2_scaling_runner ignores `--dry-run`** — it executed the full 5-tier × 50-iteration
microbenchmark and wrote a real scaling_summary.json during a "dry-run" smoke (verified
live). Inconsistent with the harness-wide dry-run contract; surprises operators.

**B3. Hardcoded `valid:true`**: s4_runner.js:327 and s10_runner.js:329 set valid
unconditionally (S1-A/S2-B/S3 wire valid to reconciliation). S4's control arm
("expected NO_RECONSTRUCTION") is recorded but a control failure flags nothing in the
summary.

**B4. S10 reconciliation is a rubber stamp**: `totalsReconcile: results.length >= 9`;
dry-run hardcodes `cases: 14/8/4` while the real batteries are email 4 + webhook 4 +
filename 5 (+ Part A's heterogeneous A1–A6) — the smoke-verified counts in worklog
Task 8 came from these hardcoded numbers, not from battery sizes.

**B5. S6 fenceAudit checks only the payload-head position** (s6_injection_oracle.js:92-99):
an occurrence starting inside the fence and straddling past `</untrusted_data>` is not
outside-flagged. Latent only — no poisoned payload in s5_material contains fence tags
(verified) — but the missing shape is a real fence-escape class.

**B6. S4 O4-1 cross-check hole**: `withPrediction>0 && crosschecked===0` → fraction 0 →
`NO_RECONSTRUCTION` (favorable to the system) instead of ORACLE_INCOMPLETE (unverifiable).
Prereg fraction is defined-predictions/known-Y-rows; implementation is
verified-correct/verified-rows. Prereg says emp_id is present-in-result "by
construction", so impact is bounded — but the favorable-bias direction is the dangerous
one for a security eval.

**B7. S2-B mixed attribution channels**: BLOCKED reasonCode derives from error-message
regex (TriageOracle.classifyReasonCode) while a structural `firstStop` exists
separately; `matchesExpected` treats expected_outcome `leak` as "match when NOT leaked",
inverting the methodNote's "compares measured verdict to corpus expected_outcome"
(design-leak probes: the corpus expects the D-04 boundary to leak). Define one semantics
in the prereg.

**B8. Canonical serialization cannot honour prereg O10 storage-class promises**:
TriageOracle.canonicalRow maps INTEGER and REAL to JS `number` (5 vs 5.0 identical;
JSON.stringify(5.0)="5"); integers >2^53 lose precision (no safeIntegers); S4
tupleSet normCell(String()) collapses TEXT '1' vs INTEGER 1. Practical leak-mismatch
risk is low but the O10 contract text over-promises.

**B9. S4 orphan-exposure specificity**: any cell whose String() equals any orphan ID
string sets `orphanExposed` (cross-table, cross-type collisions possible). Primary leak
signal (full-tuple) unaffected.

## Notes (disclose, no code change required)

- N1. Prereg S1 names `v4b/b2.jsonl` / `v4b/c2.jsonl`; disk+runner use
  `b2_probes.jsonl` / `c2_benign.jsonl` (same families, doc drift).
- N2. `regressions.jsonl` (166 items) carries no `fixture_db`; runner defaults
  `bank/B1_community.db` (s1_a_runner.js:185) — a runner decision not in the prereg.
  attacks.jsonl itself is 100% single-fixture (verified pre- and post-repair), so "each
  item executes against its own fixture schema" is de facto single-fixture for this file.
- N3. S5 McNemar units are elements (per prereg) but leak indicators correlate within a
  single response — independence caveat must be disclosed with any Part A p-value.
- N4. S2-B H2-A CP n=48 = 24 patterns × 2 tenants (clustered, not fully independent).
- N5. S3 dry-run with no mapping exits 0 with `valid:true`, 932× POLICY_UNEXPRESSIBLE,
  quotable:false — the "hard-abort (exit 3)" applies to real runs; ensure readers
  distinguish.
- N6. Selftest coverage gaps: S4 `reconstructChained` and `buildPurgedSnapshot`
  (imported then `void`-ed), S5 `pairedIndicators`/`promptDiff` untested;
  `assessReferential` tested only with same-shape rows (which is why C1 escaped).
- N7. S6 constants verified correct against production after re-check: composer fence is
  `<untrusted_data>` (answer.composer.js:45-50) and the neutralize marker is exactly
  `'[removed: instruction-like text in source]'` (input.guard.js:56). (An earlier
  suspicion of mismatch was this auditor's own grep-flag artifact — corrected.)

## What survives peer review as-is

S1-A production-chain mutation detection (fresh sandbox + logical hash + directory
snapshot oracles) is sound; S1-A preflight/reconciliation/exfil fields fix the historical
withdrawn-claim mechanics; S2-B Part 3 verdicts + TRIAGE_INCOMPLETE + preflight fix the
historical unflagged-leak mechanics; S2-B matchesExpected/purge machinery is usable after
A4/A5 fixes; S3 runner denominators keep ORACLE_INCOMPLETE in the leak denominator;
S4/S5 fixture hash pinning and byte-reproducible builders verified; S5 scanner word-
boundary/canary logic and O5-1 per-element pairing match prereg; S6 Wilson math and
Part B composer/fence plumbing match production constants; S7 route-rule-replication
batteries carry their derivation labels and 23-case count matches prereg; S8 worker +
watchdog(timeout+5000) matches the pack formula; S9 static checks are honest
(file-missing ⇒ fail, not skip); S10 webhook proposals are never executed (zero network
by construction). The ERRATA's replacement numbers were re-derived and stand.

## Required order of operations before any validation run

1. Fix C1 (S4 Part B purged-comparison) and add a different-shape negative control to
   oracle_selftest so the class cannot regress.
2. File dated amendments: A1 (S6 dedupe/568→452), A6 (S1 naive path), A7 (S7 Holm),
   plus B7 semantics choice; apply code fixes A2/A3/A4/A5/A8.
3. Re-run oracle_selftest (add controls for the fixed paths), then dry-run smokes again.
4. Only then execute RUNBOOK_S1→S10 per the existing runbooks.

---

## Fix status (2026-10-27 — same-day fix pass, all before any validation run)

Steps 1–3 of the required order of operations are COMPLETE. Every code fix and
amendment was applied the same day, before any validation run; the only
executions were the selftest and dry-run smokes (smoke run dirs deleted).

| Finding | Disposition | Evidence |
|---|---|---|
| C1 (S4-B guaranteed LEAK) | **FIXED** — `assessReferentialVsPurgedClone` + `materializePurgedClone`: identical SQL on sandbox vs materialised purged clone, multiset comparison; different-shape/materialisation/fail-closed controls added | s4_inference_oracle.js, s4_runner.js; AM-S4-1; selftest 31/31 |
| B6 (favourable NO_RECONSTRUCTION) | **FIXED** — predictions without verifiable identity cells → ORACLE_INCOMPLETE; control added | AM-S4-2; s4_runner control arm updated |
| A1 (S6 pooled double-count) | **FIXED + AUDIT CORRECTED** — runtime dedupe with permanent asserts. **The audit's own figure was wrong:** verbatim deepset-in-v13-attacks = **60/116** (not 116/116); pooled unique = **508** (not 452); 56 deepset attack payloads sit in v13's benign set (label conflict, disclosed). The permanent assert caught the discrepancy — exactly its designed purpose. | AM-S6-2; s6_runner.js asserts; RUNBOOK_S6 quoting rule |
| A2 (S3 O3-2 all-pairs) | **FIXED** — same-column + same-FROM + differing-SQL restriction; residual partition-text limitation disclosed | AM-S3-1; s3_inference_oracle.js |
| A3 (S3 O3-3 subset identity) | **FIXED** — full mapping identity required in group key; coarse-key false-LEAK class removed; controls updated | AM-S3-1; selftest S3 controls |
| A4 (S2-B deniedColumns ignored) | **FIXED** — ground truth excludes denied columns (absent, not NULL — production denies by PolicyError); raw/enforced unmodified so failed blocks still classify LEAK | AM-S2B-2; stripDeniedColumns in s2_b_runner.js |
| A5 (H2-A dropped verdicts + passRate) | **FIXED** — all verdict classes counted; TRIAGE_INCOMPLETE on missing ground truth; passRate = exact/all evaluated | AM-S2B-3 |
| A6 (S1 naive wrap) | **FIXED** — direct execution per prereg; historical 11-mutation disclosure marked historical-only | AM-S1-1 |
| A7 (Holm missing) | **FIXED (implemented)** — stats.holmStepDown + S7 summary multiplicity block; operationalisation disclosed (criterion families carry no null test) | AM-S7-1; selftest Holm control |
| A8 (BLOCKED-SAFE conflation) | **FIXED** — outcomes.blockedSafeByReason decomposition | AM-S1-2 |
| B1 (S2-B dry-run ENOENT crash) | **FIXED** — Part 1/2 preflight (exit 2 + build pointer on real runs; waived with note on dry-runs; dry-runs never touch fixtures) | AM-S2B-4 |
| B2 (s2_scaling ignores --dry-run) | **FIXED** — flag parsed; dry-run writes plan summary, executes nothing | AM-S2SC-1 |
| B7 (matchesExpected inversion) | **FIXED** — agreement semantics registered (leak matches when LEAKED); no historical claim depended on either semantics | AM-S2B-1 |
| B3, B4, B5, B8, B9 | **DISCLOSED, OPEN** — hardcoded valid:true (s4/s10), S10 reconciliation rubber stamp + dry-run counts, fenceAudit head-position-only, canonical serialization storage-class promises, orphan-exposure String() collisions. Not in the required fix list; a reviewer must treat them as known caveats. | This report (B-class above) |
| F7-class (silent-empty corpus) | **FIXED** (extends the audit list) — S6 loads are fail-closed: zero-length corpora, malformed JSONL, and any preregistered-count drift abort exit 2; counts 377/595/116/75/125/508/60/56 permanently asserted | AM-S6-2/3 |
| N1–N7 | **STAND AS DISCLOSED** (notes; N6's `assessReferential`/`buildPurgedSnapshot` selftest gap is now closed by the C1 controls; `reconstructChained`/`pairedIndicators`/`promptDiff` remain untested — disclosed) | Notes above |

**Verification after the fix pass:** `node --check` 10/10 changed files;
`oracle_selftest.js` **31/31 PASS** (was 28/28); dry-run smokes re-passed for
every changed runner (S1-A, S2-B, S2-scaling, S3, S4, S5, S6, S7, S10 — all
exit 0, "DRY-RUN complete", nothing executed); smoke run dirs deleted; the 6
historical run dirs untouched. Zero validation runs, zero LLM calls, zero
network calls throughout.
