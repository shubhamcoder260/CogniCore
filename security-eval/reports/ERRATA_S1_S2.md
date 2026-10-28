# ERRATA — S1 & S2 Reports and Findings Registers

**Status:** Authoritative corrections. Where this document contradicts earlier
reports (PHASE0–PHASE5, MASTER, `findings_*.json`), **this document wins**.
**Date:** 2026-10-26
**Scope:** Suites S1-A, S1-B, S1-C, S1-D, S2-A, S2-B, S2-C as reported at
harness commit `72d90a7` / system rung `9cde26c`.
**Basis:** Independent re-verification from raw JSONL
(`reports/INDEPENDENT_AUDIT_S1_S2.md`) plus root-cause analysis of the runner
and corpus sources.

---

## 1. S1-A headline numbers are withdrawn

The following claims are **withdrawn and must not be quoted** from any earlier
report:

| Withdrawn claim | Why it is wrong | Replacement |
|---|---|---|
| "1,352 attacks safely blocked" | (a) includes 75 benign false-refusals; (b) decomposition 1,199 + 126 = 1,325 ≠ 1,352 | 1,277 attack-type items recorded BLOCKED-SAFE, of which **27 actually executed** (`EXECUTED_CLEAN`) — blocked attacks: **1,250**; executed-without-mutation: **27** |
| "0 mutations / 3,191 items, CP ≤ 0.0938%" | 1,229 of 3,191 items were never evaluated; denominator impossible | Zero mutations across **1,962 evaluated** items. Attack-only denominator: **1,304** → CP(95%) upper bound **0.2295%**; all-evaluated denominator → 0.1526% |
| "ASR = 0.00% (3,191 payloads)" (MASTER §1) | inflated denominator; also "ASR" is a leakage term, this metric measures mutation | Use "production mutation rate 0/1,962 evaluated; attack-only bound ≤ 0.23%" |
| "3,191 items evaluated" (anywhere) | 1,229 items were skipped with `ERROR_MISSING_FIXTURE` before any evaluation | **1,962 items evaluated** (1,277 attack + 75 benign false-refusal + 610 benign) |

### 1.1 Root cause (now precisely identified)

1. **Corpus defect:** 1,229 of 1,348 items in `validation/data/v4/attacks.jsonl`
   carried `fixture_db: "database/bank/B1_community.db"` (extra `database/`
   prefix). The runner resolved it against `…/data/fixtures/database/`,
   producing `…/database/database/bank/B1_community.db` → not found → the item
   was logged as `ERROR_MISSING_FIXTURE` and **silently skipped**. The first
   119 items (correct `bank/…` paths) ran; the tail never did.
2. **Runner weakness:** skips carried no item context, were absent from the
   final summary, and the run was still reported as a complete 3,191-item
   evaluation.
3. **Audit-note correction:** earlier audit text described these 1,229 records
   as "placeholders with `rawSql: 'None'`". That literal string was an artifact
   of the audit aggregation script (`str(None)`); the records are
   `ERROR_MISSING_FIXTURE` records without `rawSql` at all. Counts and
   conclusions are unchanged; the mechanism above is the correct one.

### 1.2 Fixes applied (runners + corpus)

- `validation/data/v4/attacks.jsonl`: all 1,229 `fixture_db` values normalized
  to the canonical `bank/B1_community.db` form (1,348 items verified contiguous,
  `att_0001`–`att_1348`, every `sql` non-empty; parses in Python and Node).
- `s1_a_runner.js`: strict corpus loader (malformed lines abort the run),
  fixture **preflight** (missing fixtures abort before any evaluation), skip
  records now carry full item context, summary reconciles
  `evaluatedCount + skippedCount + crashErrorCount = totalItems` and sets
  `valid: false` otherwise.
- **Exfil assessment added:** every executed item now records
  `returnedRowCount`, `returnedColumns`, `returnedRowsDigest`,
  `exfilAssessment` (`NO_ROWS_RETURNED` / `ROWS_RETURNED_CANARY_SCAN_CLEAN` /
  `CANARY_LEAK` / `ROWS_RETURNED_CANARIES_UNAVAILABLE`) and `canaryMatches`
  via the optional `data/canaries.json` map. The 27 previously unmeasured
  executions are measurable on the next run.
- `executedAttack` and `falseAccept` flags separate executed attacks from
  blocked ones without changing the outcome taxonomy.
- **Undisclosed result now disclosed:** the naive-driver ablation simulated
  **11 successful mutations** (1 CTE-wrapped `REPLACE INTO`, 10 CTE-wrapped
  `INSERT`s), all `VALIDATOR_BLOCKED` in production. This supports the
  defense-in-depth narrative and appears in no earlier report.

**Until S1-A is re-run on the repaired corpus, only §1's replacement numbers
(computed from the existing JSONL) are quotable.**

**Preregistration re-derivation statement (2026-10-27):** the corpus repair
changed only `fixture_db` strings (1,348/1,348 normalized to the canonical
`bank/B1_community.db` form; item count, SQL text, and labels untouched), so
no preregistered expectation or count depended on the pre-repair values.
Preregistered totals (1,348 contiguous attack items `att_0001`–`att_1348`) were
re-verified against the repaired file at fix time and are additionally enforced
at runtime by the S6 reconciliation asserts (AM-S6-2/3) for the shared
corpora.

---

## 2. S2-B V3 replay claims are withdrawn

| Withdrawn claim | Why | Replacement |
|---|---|---|
| "285 Clean Executions" | "clean" was never measured — no triage ran; includes 15 leak-expected probes presented as successes | Metric retired. Re-run reports the O10 verdict distribution |
| "225 Safely Blocked" | "safely" is interpretation: 30 of 45 validator blocks were leak-expected or rewrite-and-filter items (over-blocking) | Report `BLOCKED` verdicts with `reasonCode` + over-filtering counts |
| Absence of any leak figure | 15 `main.`-qualified namespace-bypass probes executed with no oracle | First measured leak numbers come from the re-run with `TriageOracle` |

### 2.1 Fixes applied

- `s2_b_runner.js` Part 3 now performs, per item: unconstrained raw execution,
  purged ground-truth clone (row filters as `DELETE … WHERE NOT (…)`, quoting
  identical to `data.policy.js#sqlStr`), the enforced production chain, and
  `TriageOracle.triage` → `ALLOWED-EXACT / LEAK / OVER-FILTERED / WRONG /
  BLOCKED` (+ `TRIAGE_INCOMPLETE` if the purge fails), plus an optional canary
  scan and a `matchesExpected` comparison against the corpus
  `expected_outcome`. The summary reports `verdicts`, `matchesExpected`,
  `measuredLeaks`, `skipped`, and `valid`.
- Fixture preflight: all 15 realm databases must exist before Part 3 starts.
- H2-A / H2-B policy objects corrected to use the `op` key expected by
  `data.policy.js` (previously `operator` — silently tolerated by a default).

---

## 3. Report errors corrected (audit Finding D, itemized)

| # | Location | Erroneous statement | Correction |
|---|---|---|---|
| D1 | PHASE0 §2 (F-034) | `input.guard.js` at `server/src/security/input.guard.js` | Path does not exist; the guard is at `server/src/guardrails/input.guard.js` |
| D2 | PHASE0 §2 | `OLLAMA_TIMEOUT_MS` at `env.js:56` | It is line 27; line 56 is inside the `documents` config block |
| D3 | PHASE3 §2 | "Top Constructs Performance" table shows only 100%-acceptance constructs | Five constructs scored 0/15 (`glob_operator`, `string_concat_op`, `limit_offset_comma`, `bracket_identifier`, `keyword_alias_quoted`) and one 15/30 (`quoted_alias_keyword`); any table must show all constructs |
| D4 | PHASE4 §3 / MASTER | "Linear O(N) scaling" on means 0.197 → 0.158 → 0.172 → 0.239 → 0.281 ms | Means are non-monotonic; supported claim: "no blowup; sub-millisecond latency across tiers 1–250" |
| D5 | MASTER §1 | "0 mutations / 3,191 items (ASR = 0.00%)"; omits H2 (S1-B), H3 (S1-D), S2-A H1/H3 | See §1 and §4 of this ERRATA |
| D6 | `findings_master.json` F-S1A-01 | Repeats 1,352 / 3,191 / 0.0938% | Superseded by §1 |
| D7 | `findings_phase3.json` | Finding has `"id": null` | Findings-register schema requires an ID; regenerate the register |
| D8 | All reports | `file:///home/shubh/...` links | Dead for every other reader; use repo-relative paths |
| D9 | MASTER | H4 reported as "PASS" without a verdict line | Five constructs at 0/15 acceptance → **H4: PARTIALLY FAILED** (over-rejection of GLOB, `\|\|`, comma-LIMIT, bracket identifiers, keyword aliases) |

---

## 4. Declarations required by prereg hard rules

The preregistration (`PREREG_S1_S2.md` v3.0.0-PREREG) requires any planned
evaluation that is not run to be declared "NOT RUN (reason)". The following
declarations were missing and are hereby made:

- **S1-B (RQ1/RQ3 robustness templates): NOT RUN** — never executed; no
  artifacts exist. Reason undocumented at the time; remains unexecuted.
- **S2-A Tier 1 (800 gold queries × 4 roles): NOT RUN** — `spider.zip` missing
  (`security-eval/data/downloads/` empty; issue I2). PHASE4's statement that
  "Tier 2 … was executed across the 15 realm databases" is **false** — that run
  is the S2-B V3 replay, which is not Tier 2.
- **S2-A Tier 2 (50 questions × 4 roles via /api/chat): NOT RUN** — no chat
  evaluation artifacts exist.
- **S1-D (250 payloads via /api/tools/\*): NOT RUN** — recorded honestly at the
  time as F-S1D-01; restate here for completeness. Note: the dependency premise
  ("xlsx not installable") is outdated — `xlsx` is declared in
  `server/package.json` and `npm ci` resolves it (I1 closed).

### 4.1 Preregistration deviations acknowledged (audit Finding C)

C1 (H2-A fixture and operator set changed: `raw_fixture.db`+20 →
`multi_tenant_bank.sqlite`+24), C2 (O11 contradiction: the multi-tenant bank was
created and used despite the "NOT created" override), C3 (S2-C scaling design
changed: 1 query × tiers {1,10,50,100,250} × 30 iters instead of 10 queries ×
tiers {1,5,10,25,50} × 1), C4 (S1-B silent omission — see above), C5/C6 (S2-A
Tier 1/2 omissions and mislabel — see above), C8 (manifests lacked runtime
versions at the time; current `ManifestWriter` records them) are acknowledged
as deviations from the preregistered plan. C7 (S1-D) was recorded.

---

## 5. What is NOT changed by this ERRATA

The following results were independently re-verified from raw artifacts and
stand as reported:

1. Ladder ancestry: 15 rungs, strictly linear, no dependency drift.
2. Oracle harness self-test: 10/10.
3. All 15 corpus line counts.
4. S2-B H2-A: 48/48 `ALLOWED-EXACT`, zero canary leaks, CP ≤ 6.05% (n=48).
5. S2-B H2-B: unjoined child query → LEAK; joined/subquery forms →
   SECURE-CONTAINED (Decision D-04 boundary documented).
6. Benign corpus: 610/685 accepted; the 75 rejections are exactly the five
   0/15 constructs plus half of `quoted_alias_keyword`, all via
   node-sql-parser failures.
7. S2-C scaling raw latency statistics (means/medians/p95/p99) — the *numbers*
   are correct; only the "Linear O(N)" *label* is withdrawn (D4).

---

## 6. Corrected S1-A quotable table (from existing JSONL, pending re-run)

| Metric | Value |
|---|---|
| Items loaded | 3,191 |
| Items evaluated | 1,962 |
| Items never evaluated (ERROR_MISSING_FIXTURE) | 1,229 (`att_0120`–`att_1348`) |
| Attack-type evaluated | 1,304 (1,277 BLOCKED-SAFE incl. 27 executed + 0 bypass) |
| Benign evaluated | 685 (610 allowed + 75 false-refusals) |

> Reconciliation: 1,277 attack + 685 benign = 1,962 evaluated; the 75 benign
> false-refusals belong to the benign corpora (v4_benign + v4b_c2_benign) and
> must never be counted as blocked attacks.

| Metric | Value |
|---|---|
| Production mutations | 0 / 1,962 |
| CP(95%) upper bound — all evaluated | 0.1526% |
| CP(95%) upper bound — attack-only (n=1,304) | **0.2295%** |
| Executed attacks without exfil assessment | 27 (measurable only after re-run) |
| Naive-driver simulated mutations | 11 (undisclosed in prior reports) |
