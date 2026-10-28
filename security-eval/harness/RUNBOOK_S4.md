# RUNBOOK_S4 — Dependency and Relationship Leakage (deterministic, no LLM)

Prereg: `security-eval/prereg/PREREG_S4.md` (read it first — hypotheses, oracles,
verdict vocabulary, quotable rules). Source: Don't Be a Tattle-Tale (PVLDB 2022),
exact declared-FD inference track only; the statistical-imputation track is
NOT_RUN_TOOL_UNAVAILABLE; the FK-closure novelty mechanism is deferred (I10).

> **Fix note (2026-10-27, see prereg/PREREG_AMENDMENTS.md AM-S4-1/AM-S4-2 and
> reports/PEER_REVIEW_SELFCHECK.md):** self-check finding C1 (Part B's full-row
> comparison structurally guaranteed LEAK for projected queries) is FIXED —
> Part B now executes the identical SQL against a materialised purged clone
> and compares result multisets. B6 (favourable NO_RECONSTRUCTION without
> verification) is FIXED to ORACLE_INCOMPLETE. Both fixes are covered by new
> selftest controls (31/31). No hold remains on this runbook.

## 0. Prerequisites

```bash
cd <repo> && git checkout security-eval
export PATH=/home/z/my-project/tools/bin:$PATH   # portable sqlite3 3.50.4 (where applicable)
export NODE_PATH=$PWD/server/node_modules
cd server && npm ci && cd ..                     # once
```

The fixture and declarations must exist and be committed:

```bash
node security-eval/harness/setup/09_build_fd_fixture.js
# -> data/fixtures/fd_leak.sqlite (120 employees + FK chain + audits w/ orphans)
# -> data/s4/fd_declarations.json (FDs, policy, 14 Part-A queries, 10 Part-B probes, fixture SHA-256)
git add security-eval/data/fixtures/fd_leak.sqlite security-eval/data/s4/fd_declarations.json
git commit -m "security-eval(s4): build FD fixture and preregistered declarations (setup/09)"
```

The build is deterministic: re-running it reproduces the identical SHA-256
(`6aa20425f80883f606b8361e785c0f449984d07ccadaea220c0bb2f13820a6d3`).

## 1. Dry run (executes nothing)

```bash
node security-eval/harness/runners/s4_runner.js --dry-run
```

Expect: `DRY-RUN complete — no queries executed.` and 24 DRY_RUN records
(14 Part A + 10 Part B). Preflight is waived in dry-run; the fixture must still
be present for the full run.

## 2. Real run

```bash
node security-eval/harness/runners/s4_runner.js --rung 6f2dd4c   # ladder base
node security-eval/harness/runners/s4_runner.js --rung 8205910   # Item 1 (policy normalization)
node security-eval/harness/runners/s4_runner.js --rung HEAD
```

Exit codes: 0 ok · 2 preflight (missing fixture/declarations) · 3 SHA-256
mismatch · 1 crash. Per-rung run dirs: `runs/<ts>_s4_<rung>/`.

## 3. Accept the run (all must hold)

- `s4_summary.json`: `valid: true`, `dryRun: false`, `fixtureSha256` equals the
  committed declarations value.
- Part A: `evaluated == 14`, `quotable == true`; `armVerdicts` covers exactly the
  3 FD arms + CONTROL; every `armOutcomes` entry has `primary` + oracle fields.
- Part B: `evaluated == 10`, `quotable == true`; every executed probe has
  `purgedCounts` and a full-tuple `leak` assessment; orphan probes carry
  `orphanExposed`.
- Canary scan state is `CANARY_SCAN_CLEAN`, `CANARY_LEAK`, or
  `ROWS_RETURNED_CANARIES_UNAVAILABLE` — never silently absent.
- Sum of Part B `verdicts` values equals `partB.evaluated`.

## 4. Quote rules (S4-specific)

1. Part A is a designed-set measurement: quote per-arm outcomes
   (FD_LEAK / PARTIAL_RECONSTRUCTION / NO_RECONSTRUCTION / OVER_BLOCKED) — never
   a recall percentage over 3 FDs.
2. Part B zero-leak claims must carry the CP bound
   (`clopperPearsonUpper95_zeroLeaks`) with its denominator (Part B probes only).
3. `OVER_BLOCKED` is a UTILITY outcome, not a security pass; report it beside
   leaks, not instead of them.
4. The chained-reconstruction field (`secondaryChained`) is secondary; label it.
5. A run with `valid: false` or `quotable: false` must not be quoted.

## 5. Failure triage

| Symptom | Likely cause | Fix |
|---|---|---|
| exit 3 SHA-256 mismatch | fixture rebuilt with edits / partial commit | re-run setup/09, commit both artifacts |
| all Part A arms OVER_BLOCKED | policy denies a determinant column too | do NOT edit the fixture; file a prereg amendment changing the policy in fd_declarations.json (dated) |
| PARSER_OR_VALIDATOR_BLOCKED everywhere | runner worktree mismatch | check `--rung` value and ladder worktree checkout |
| canary state UNAVAILABLE | fixture built by an older setup/09 | rebuild + recommit |
| ORACLE_INCOMPLETE | fixture no longer satisfies a declared FD | someone edited data; rebuild via setup/09 |

## 6. Out of scope here

Imputation-tool track, FK-closure novelty mechanism (I10), and any LLM-mediated
variant. S4 is fully deterministic; if you ever see a model call, the environment
is wrong — stop and investigate.
