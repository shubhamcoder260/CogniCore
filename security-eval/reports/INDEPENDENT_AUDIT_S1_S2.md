# Independent Audit of Suites S1 & S2 — Re-Verification Against Raw JSONL

**Auditor:** Independent AI re-verification (no role in producing the original reports)
**Date:** 2026-10-26
**Repository:** CogniCore, branch `security-eval`, HEAD `7568f03`
**System-under-test (SUT) baseline:** `9cde26c` (verified: `git diff 9cde26c 72d90a7 -- server/ client/ validation/ docs/` is empty, so runs executed at harness commit `72d90a7` did exercise `9cde26c` system code)
**Method:** Every number below was recomputed directly from the JSONL artifacts in `security-eval/runs/` and the corpora in `validation/data/`. No claim was taken from any existing report. Aggregation script: `scripts/audit_s1_s2.py` (workspace copy; reproducible with `python3` over the run directories).

---

## 1. Verdict Summary

| # | Claim under audit | Verdict |
|---|---|---|
| V1 | Ladder ancestry: 15 rungs, strictly linear | **VERIFIED** (recomputed `git merge-base --is-ancestor` for all 14 links) |
| V2 | Oracle selftest 10/10 | **VERIFIED** (reproduced in this workspace: Node v24.21.0, sqlite3 3.50.4) |
| V3 | Corpus line counts (v3 510, v3b 1,430, v3c 46,920, v3d 40; v4 attacks 1,348, benign 220, boundary 12, fuzz 350, regressions 166; v4b b2 352, c2 465, d2 27; v4c 29; v4d 640; v13 972) | **VERIFIED** (all 15 counts match exactly) |
| V4 | S2-B H2-A: 48/48 exact, 0 leaks, CP ≤ 6.05% | **VERIFIED** from `s2_b_results.jsonl` (48 × `ALLOWED-EXACT`, CP bound 0.060503) |
| V5 | Benign: 685 evaluated, 610 accepted, 75 rejected | **VERIFIED** from `benign_results.jsonl` |
| V6 | Scaling latency table (mean/median/p95/p99 per tier) | **VERIFIED** — raw stats match the report table to the digit |
| V7 | S1-A: "0 mutations / 3,191 items", "1,352 attacks blocked", CP ≤ 0.0938% | **REFUTED AS STATED** — see Finding A |
| V8 | S2-B V3 replay: "285 clean / 225 safely blocked" | **MISLEADING** — no triage performed; 15 leak-expected queries executed unflagged — see Finding B |
| V9 | Scaling "Linear O(N) scaling" | **UNSUPPORTED** — means are non-monotonic (tier 10 mean < tier 1 mean) — see Finding D4 |
| V10 | PHASE0 "input.guard.js at server/src/security/ (F-034)", "OLLAMA_TIMEOUT_MS at env.js:56" | **REFUTED** — see Finding D1 |

---

## 2. What Checks Out Clean

1. **Ladder.** All 15 rungs exist; the chain `6f2dd4c → 20a2164 → … → 9cde26c` is strictly linear (0 merge commits in `6f2dd4c..9cde26c`; all 14 pairwise ancestor checks pass). Dependency invariant confirmed: no `package.json`/`package-lock.json` drift across the ladder.
2. **Oracle harness.** `node --test security-eval/harness/oracles/oracle_selftest.js` passes 10/10 in a fresh clone (with `NODE_PATH=<repo>/server/node_modules` and a `sqlite3` CLI on PATH). Positive and negative controls behave as documented.
3. **I1 resolved in this workspace.** `xlsx` **is** declared in `server/package.json` (`^0.18.5`). `npm ci` installs 278 packages; `require('xlsx')` and `require('better-sqlite3')` both succeed. The prior reports' statement that installing was "prohibited by hard invariants" misread the rule (the prohibition is on *editing* `package.json`, not on `npm ci`).
4. **S2-B H2-A.** All 48 records in `s2_b_results.jsonl` part `H2-A` are `ALLOWED-EXACT`, `canaryLeaked: false`, 24 distinct patterns × 2 tenants. CP upper bound 6.05% correct for n=48.
5. **H2-B (child table).** Part `H2-B`: unjoined `SELECT * FROM tasks` → `LEAK`; joined and subquery forms → `SECURE-CONTAINED`. Matches the D-04 claim.
6. **Benign acceptance.** 610/685 (89.05%) verified; the 75 refusals are exactly: `glob_operator` 0/15, `string_concat_op` 0/15, `limit_offset_comma` 0/15, `bracket_identifier` 0/15, `quoted_alias_keyword` 15/30 — all via node-sql-parser parse failures.
7. **Run manifests** record input SHA-256 checksums and rung tags; the 903c3c1 ladder run used a proper worktree (`../cognicore-ladder/903c3c1`).

---

## 3. Finding A (High): S1-A reconciliation failure — 1,229 of 3,191 items were never evaluated

**Evidence:** `security-eval/runs/2026-10-26T06-20-54-799Z_s1_a_9cde26c/s1_a_results.jsonl` (3,191 lines).

Re-aggregation from raw JSONL:

| Outcome | Count | Composition |
|---|---|---|
| `BLOCKED-SAFE` | 1,352 | **1,277 attack-type items + 75 benign-type items** (the benign false-refusals) |
| `ALLOWED-BENIGN` | 610 | benign corpora (v4_benign 220 + v4b_c2 465) |
| *(no outcome)* | **1,229** | **`ERROR_MISSING_FIXTURE` records: `status: "ERROR_MISSING_FIXTURE"` with a doubled-path `fixturePath` (`…/fixtures/database/database/bank/B1_community.db`); itemIds `att_0120`–`att_1348`. These records carry no `outcome`/`rawSql`/`corpusSource` fields at all — the audit script's earlier "rawSql: None" rendering was a `str(None)` artifact of its own printing, not file content.** |
| **Total** | **3,191** | reconciles |

- The 1,229 skipped records are the unprocessed tail of the v4 attacks corpus (1,348 items; only `att_0001`–`att_0119` carried real outcomes). **Actual evaluated items: 1,962, not 3,191.** Root cause (verified after this audit, see `reports/ERRATA_S1_S2.md` §1.1): 1,229 corpus items carry `fixture_db: "database/bank/B1_community.db"` (extra `database/` prefix), which the runner resolved against `…/data/fixtures/database/` producing a doubled `database/database/` segment; the runner logged `ERROR_MISSING_FIXTURE` and silently skipped each item.
- **MASTER/PHASE5 claim "1,352 attacks safely blocked" is wrong twice:** (a) 1,352 is the *total* BLOCKED-SAFE count including 75 benign false-refusals; attacks-only = 1,277; (b) the cited decomposition "VALIDATOR_BLOCKED 1,199 + PARSER_BLOCKED 126" sums to 1,325, not 1,352 — because 75 of the 126 parser blocks are the benign rejections. Attacks-only parser blocks = 51.
- **"State mutation rate 0/3,191, CP ≤ 0.0938%" uses an impossible denominator.** 1,229 items never ran, so they cannot contribute evidence. Recomputed bounds: n = 1,962 (all evaluated) → **0.1526%**; n = 1,304 (attack-only evaluated: 1,277 blocked + 27 executed) → **0.2295%**. The honest headline bound is **≤ 0.23% (attack-only)**, not ≤ 0.0938%.
- **27 attack-type items have `firstStopCode = EXECUTED_CLEAN`** (1 × `v4_attacks`, 26 × `v4_regressions`; the regressions are literal-embedded-keyword probes such as `WHERE city = 'update'`, designed to be accepted). No mutation occurred (`prodMutated` truthy = 0 across the file), but S1-A records **no canary/exfil field**, so exfiltration status for executed items is unmeasured.
- **Undisclosed ablation result:** `naiveMutated` truthy = **11** (1 CTE-wrapped `REPLACE INTO` + 10 CTE-wrapped `INSERT` writes, all `VALIDATOR_BLOCKED` in production). Under the naive-driver ablation these would have mutated the database. This is *supporting* evidence for the defense-in-depth narrative — and it appears in no report.
- Root cause (confirmed): a corpus-level `fixture_db` path-prefix defect combined with a runner that skipped missing-fixture items silently and did not reconcile skips in its summary. The earlier checkpoint/resume hypothesis is withdrawn — the current `s1_a_runner.js` has no resume path at all; the run was produced by an uncommitted predecessor script. Fixes: corpus repaired (1,229 paths normalized), runner hardened (strict loader, preflight abort, exfil assessment, reconciled `valid` summary) — see `reports/ERRATA_S1_S2.md` §1.2. Runner fix + re-run required before any new S1-A number is quotable.

**Corrected S1-A table (quotable version):**

| Metric | Corrected value |
|---|---|
| Items with recorded outcomes | 1,962 / 3,191 loaded |
| Attacks evaluated | 1,304 (1,277 blocked + 27 executed) |
| Benign evaluated | 685 (610 allowed + 75 false-refusals) |
| Attacks never evaluated (placeholders) | 1,229 (`att_0120`–`att_1348`) |
| Production mutations | 0 → 95% CP upper bound **0.2295%** (attack-only denominator) |
| Naive-driver simulated mutations | 11 (undisclosed in reports) |
| Executed attacks without exfil assessment | 27 |

---

## 4. Finding B (High): S2-B "V3 replay" has no triage — and 15 designed-leak probes executed unflagged

**Evidence:** `security-eval/runs/2026-10-26T06-41-07-326Z_s2_b_9cde26c/s2_b_results.jsonl` (part `V3`, 510 records) vs `validation/data/v3/v3_queries.jsonl` (510 items).

- The runner (`security-eval/harness/runners/s2_b_runner.js:356-428`) logs `firstStop` but **never computes a `verdict`**: no purged-clone comparison, no canary scan, no `expected_outcome` comparison. All 510 records have `verdict` absent. The O10 triage categories (`ALLOWED-EXACT` / `LEAK` / `OVER-FILTERED` / `WRONG`) do not exist for this part.
- Cross-tab of corpus `expected_outcome` × observed `firstStop` (joined on item id):

| expected_outcome | n | EXECUTED_CLEAN | POLICY_BLOCKED | VALIDATOR_BLOCKED | PARSER_BLOCKED |
|---|---|---|---|---|---|
| `rewrite_and_filter` | 255 | 225 | 0 | 15 | 15 |
| `leak` | 30 | **15** | 0 | 15 | 0 |
| `permit` | 45 | 45 | 0 | 0 | 0 |
| `policy_error` | 165 | 0 | 165 | 0 | 0 |
| `syntax_error` | 15 | 0 | 0 | 15 | 0 |

- **15 items whose corpus label is `leak` executed cleanly and were reported as "clean executions."** Examples: `SELECT "br_id", "br_nm" FROM main."brs"` — schema-qualified `main.` references, the known namespace-bypass probe family. Whether they truly leaked is *unknown* (no oracle ran), but the corpus designed them to leak and nothing measured it. The report's "285 Clean Executions" therefore includes 15 unverified-leak probes presented as successes.
- The "225 Safely Blocked" decomposition is: 165 policy errors + 45 validator blocks + 15 parser blocks. "Safely" is an interpretation; per the corpus labels, 30 of the 45 validator blocks were `leak`-expected or `rewrite_and_filter` items (i.e., the validator over-blocked them).
- Coverage: 510 of 48,900 V3-family queries (v3 510; v3b 1,430, v3c 46,920, v3d 40 **never replayed**).
- The fixtures used (15 realm databases under `security-eval/data/fixtures/database/`) are **not in the repository** (`security-eval/.gitignore` line 2 ignores `*.sqlite`) and their source `database.zip` is not committed either — this part is currently unreproducible from a fresh clone.

---

## 5. Finding C (Medium): Preregistration deviations

Against `security-eval/prereg/PREREG_S1_S2.md` (v3.0.0-PREREG):

| # | Prereg says | Executed reality | Severity |
|---|---|---|---|
| C1 | H2-A on `raw_fixture.db` + authorized clones, **20 mutation operators** | `multi_tenant_bank.sqlite`, **24 patterns** | Deviation — fixture and operator set both changed |
| C2 | O11: "Multi-tenant bank is NOT created" | `08_build_multi_tenant_bank.js` created it and H2-A ran on it | Contradicts the binding override text |
| C3 | S2-C scaling: **10 queries × tiers (1, 5, 10, 25, 50) = 50 executions** | **1 query × tiers (1, 10, 50, 100, 250) × 30 iterations = 150** | Different design; results not comparable to prereg plan |
| C4 | S1-B: 9 RQ1 templates × k=3 + 50 RQ3 × k=1 | **Never run; never declared "NOT RUN (reason)"** in any report | Hard rule 3 violation (silent omission) |
| C5 | S2-A Tier 1: 800 queries × 4 roles = 3,200 | Not run (spider.zip missing) — recorded as blocker ✓ | Honest, but the MASTER table omits H1 (S2-A) entirely |
| C6 | S2-A Tier 2: 50 questions × 4 roles = 200 chat requests | Not run; PHASE4's "Tier 2 … was executed across the 15 realm databases" actually refers to the V3 replay, which is not Tier 2 | Mislabelled claim |
| C7 | S1-D: 250 payloads via `/api/tools/*` | Not run (xlsx) — recorded as finding F-S1D-01 ✓ | Honest |
| C8 | Manifests record node & sqlite versions | Manifests contain neither (`runtime` block empty of versions) | Completeness gap |

Note on H4 (benign acceptance): the MASTER table reports "Utility Baseline (EX) … PASS" but never states an H4 verdict; with five constructs at 0/15 acceptance, a prereg-honest reading is **H4 partially failed** (over-rejection on GLOB, `||`, comma-LIMIT, bracket identifiers, keyword aliases).

---

## 6. Finding D (Medium): Report errors (I7 confirmation, itemized)

1. **PHASE0 §2:** "input.guard.js resides exclusively at `server/src/security/input.guard.js` (Fact F-034)" — **false**: that path does not exist; the guard is at `server/src/guardrails/input.guard.js` (as FACTS_RUNTIME.md itself records). The two documents contradict each other.
2. **PHASE0 §2:** "OLLAMA_TIMEOUT_MS at `server/src/config/env.js:56`" — **false**: it is line 27; line 56 is inside the `documents` config block.
3. **PHASE3 §2 table:** "Top Constructs Performance" lists only 100%-acceptance categories; the five 0/15 constructs and the 50% `quoted_alias_keyword` are omitted from the table (the 75 refusals are disclosed in prose only in MASTER). A table that silently shows only successes is not acceptable under §5 lessons.
4. **PHASE4 §3 / MASTER:** "Linear O(N) scaling" on means 0.197 → 0.158 → 0.172 → 0.239 → 0.281 ms — non-monotonic; the data supports "no blowup, sub-millisecond", not linearity.
5. **MASTER §1 hypothesis table:** omits H2 (S1-B), H3 (S1-D), S2-A H1/H3, and reports "0 mutations / 3,191 items (ASR = 0.00%)" with the inflated denominator (see Finding A). "ASR" is also the wrong term for a mutation-only metric.
6. **findings_master.json F-S1A-01:** repeats "blocked 1,352 attacks", "3,191 payloads", bound 0.0938% — same errors.
7. **findings_phase3.json:** single finding has `"id": null` — violates the findings-register schema (ID required).
8. **All reports** embed `file:///home/shubh/...` links to the previous author's machine — dead links for any other reader.

---

## 7. Finding E (Medium): Reproducibility gaps

1. `security-eval/.gitignore` ignores `*.sqlite` → `multi_tenant_bank.sqlite`, `child_projects.sqlite`, `job_postings.sqlite`, and the 15 realm databases are **not in the repo**. Setup scripts (02/03/08) exist, but the realm databases' source (`database.zip`) is not committed and its provenance is undocumented.
2. Harness scripts require `better-sqlite3` but live outside `server/`; they need `NODE_PATH=<repo>/server/node_modules` (undocumented). The `sqlite3` CLI dependency of `logical_hash_oracle.js` is also undocumented.
3. S1-C corpora directory contains only `README.md` — C1/C2 remain pending (matches I8; honestly recorded in `s1_c_summary.json`).
4. `security-eval/data/downloads/` is empty — spider.zip still missing (I2).

---

## 8. I1–I8 Status After This Audit

| Issue | Status | Note |
|---|---|---|
| I1 (xlsx) | **RESOLVED in this workspace** | `xlsx` is declared; `npm ci` fixes it. F-S1D-01's premise ("not declared / cannot install") is outdated |
| I2 (spider.zip) | OPEN | `data/downloads/` empty |
| I3 (S1-A totals) | **CONFIRMED, now quantified** | 1,229 never-evaluated placeholders; corrected numbers in §3 |
| I4 (V3 replay) | **CONFIRMED, now quantified** | No triage; 15 leak-expected executed unflagged; §4 |
| I5 (S2 probes) | OPEN | No probe runner/artifacts exist (`COUNT(*)`, role alias, PolicyError text, schema endpoint, admin bypass) |
| I6 (ladder) | OPEN | Only 903c3c1 (100 items) beyond HEAD runs |
| I7 (report errors) | **CONFIRMED, itemized** | §6 |
| I8 (S1-C seal) | OPEN | `security-eval/corpora/` empty except README |

---

## 9. Recommended Next Actions (in order)

1. **Fix the S1-A runner resume bug** and re-run the attack tail (`att_0120`–`att_1348`) so S1-A totals reconcile; add a canary/exfil field for executed items. Until then, quote only the corrected §3 table.
2. **Re-run S2-B V3 with the triage oracle** (purged clones + canary scan) on all 510 v3 items — the 15 executed leak-expected probes become the first measured leak numbers — then extend to v3b/v3d (and a sampled v3c).
3. **Run the five S2 probes (I5)** — all in-process, no LLM: `COUNT(*)` on fully-denied tables, `user`-role policy alias, PolicyError message content, schema endpoint, admin bypass.
4. **Commit the fixtures** (or a deterministic generator + provenance for `database.zip`) so V3/H2-A are reproducible; record node/sqlite versions in manifests.
5. **Issue corrected reports** (or an ERRATA note) for the §6 items; add "NOT RUN (reason)" lines for S1-B and S2-A Tier 1/2 in the MASTER table.
6. Then proceed to the pack's phase plan (mock LLM stub → S5/S6 deterministic → S8 → S9), now with a clean S1/S2 baseline.

---

## Appendix: Reproduction Commands

```bash
# clone
git clone --branch security-eval https://github.com/thesauravyadav925925-gif/CogniCore.git
cd CogniCore/server && npm ci && cd ..

# sqlite3 CLI (if absent): download from sqlite.org into PATH

# oracle selftest (10/10)
NODE_PATH=$PWD/server/node_modules node --test security-eval/harness/oracles/oracle_selftest.js

# ladder ancestry (15 rungs)
for h in 6f2dd4c 20a2164 8205910 56313f7 971d171 903c3c1 932996b 9e8ae7b \
         493a6bc 17cce2f 76c28cf ef91e9d c8b008e 965ba48 9cde26c; do git cat-file -e $h^{commit}; done

# S1-A re-aggregation (null records, outcomes, first-stop)
python3 - <<'EOF'
import json
from collections import Counter
rows=[json.loads(l) for l in open('security-eval/runs/2026-10-26T06-20-54-799Z_s1_a_9cde26c/s1_a_results.jsonl')]
print(len(rows), dict(Counter(str(r.get('outcome')) for r in rows)))
print(dict(Counter(str(r.get('firstStopCode')) for r in rows)))
print('null complete records:', sum(1 for r in rows if r.get('outcome') is None and r.get('rawSql') in (None,'None')))
EOF

# S2-B V3 cross-tab (expected_outcome x firstStop) and H2-A verdicts
python3 - <<'EOF'
import json
from collections import Counter, defaultdict
items={json.loads(l)['id']: json.loads(l) for l in open('validation/data/v3/v3_queries.jsonl')}
rows=[json.loads(l) for l in open('security-eval/runs/2026-10-26T06-41-07-326Z_s2_b_9cde26c/s2_b_results.jsonl')]
xt=defaultdict(Counter)
for r in (x for x in rows if x.get('part')=='V3'):
    xt[items[r['evalId']]['expected_outcome']][str(r.get('firstStop'))]+=1
print({k: dict(v) for k,v in xt.items()})
print(dict(Counter(str(r.get('verdict')) for r in rows if r.get('part')=='H2-A')))
EOF
```
