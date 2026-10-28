# RUNBOOK_S10 — Actions and Tool Abuse

Prereg: `security-eval/prereg/PREREG_S10.md` (+ Amendment 1, filed before any run).
Suite code: `harness/oracles/s10_abuse_oracle.js`, `harness/runners/s10_runner.js`.
Rungs: `ef91e9d`, `HEAD`.

## 0. Prerequisites

- `NODE_PATH=$PWD/server/node_modules`; `sqlite3` >= 3.40 on PATH; selftest 28/28.
- No LLM, ZERO NETWORK by construction: webhook actions are validated and proposed but
  NEVER executed; email execution runs without SMTP_HOST (simulated delivery);
  save_report writes into an ISOLATED exports dir (DATA_DIR redirected to the run dir).

## 1. Commit checklist

Commit `prereg/PREREG_S10.md`, `harness/oracles/s10_abuse_oracle.js`,
`harness/runners/s10_runner.js`, and this runbook.

## 2. Dry run

```bash
node security-eval/harness/runners/s10_runner.js --dry-run
```

Expect `DRY-RUN complete — nothing executed.` with parts A/B/C declared (14 + 8 + 4
cases) and all probes true. Delete the smoke dir afterwards.

## 3. Real run

```bash
node security-eval/harness/runners/s10_runner.js --rung HEAD
node security-eval/harness/runners/s10_runner.js --rung ef91e9d
```

What happens (all on an ISOLATED registry DB + isolated DATA_DIR, both deleted after):
- Part A: type whitelist, email domain allowlist (env set/restored per case), webhook
  allowlist incl. https-only (NODE_ENV forced away from 'test' during validation),
  approval gate (self-approval ban, capability, pending-only), proposer-permission
  binding via two real save_report executions on a per-run synthetic sqlite dataset
  with a fabricated semantic profile, simulated email delivery + outbox.
- Part B: export filename sanitization battery (route-rule replication of tools.js:45)
  and webhook header smuggling (fixed executor header set, executor :62-66).
- Part C: approval-queue scoping + decision capability enforcement.

## 4. Acceptance checklist

- [ ] Summary `valid: true`; caseCount >= 9; every case exactly one verdict.
- [ ] Expected at HEAD: A1-A4 ENFORCED, A6 SIMULATED_WITH_OUTBOX, B1/B2 ENFORCED,
      C1/C2 ENFORCED.
- [ ] A5: the access-denied half is STRICT (analyst without grant must fail at
      execution with the proposer-permission error even under an admin approver). The
      positive half may carry `deviation: SEMANTIC_FIXTURE_LIMITATION` if the analytics
      layer rejects the synthetic profile shape — recorded in `summary.deviations`,
      excluded from the criterion, never counted as a bypass (Amendment 1).
- [ ] Any BYPASSED/MISMATCH -> findings register entry (S10-F*), do not edit server/
      on this branch.

## 5. Quote rules

- Report "x/N MATCH against preregistered expectations" + the deviations list; never a
  bare "S10 PASS".
- The webhook header set assertion is an executor-rule REPLICATION (labelled in the
  record); the route-level enforcement of proposal capability is verified by the
  capability matrix in S7-A5 and the route code anchors in the prereg.
- Runs with `valid: false` are unquotable.

## 6. Triage

| Symptom | Cause | Fix |
|---|---|---|
| exit 2 `WORKTREE_REQUIRE_FAILED` | worktree/node_modules missing | build ladder worktree; symlink server/node_modules |
| exit 2 `NOT_APPLICABLE: action layer absent` | rung before the actions feature | record rung characteristics; run only at ef91e9d/HEAD |
| A4 manager decision DENIED | capability matrix changed | re-verify rbac.js:57; findings entry |
| A5 unrelated execution error | analytics/adapter drift | read `result.error` in the record; findings entry — do not widen the prereg criterion |
| real SMTP configured on the machine | SMTP_HOST env leaks into the run | unset SMTP_HOST before running; delivery must be `simulated` |
