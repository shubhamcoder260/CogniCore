# RUNBOOK_S9 — Authentication & Application Security Checklist

Prereg: `security-eval/prereg/PREREG_S9.md` (17 static + 6 in-process checks,
expectations fixed before the runner existed). Suite code:
`harness/oracles/s9_checklist_oracle.js`, `harness/runners/s9_runner.js`.
Rungs: `903c3c1`, `493a6bc`, `c8b008e`, `HEAD`.

## 0. Prerequisites

- `NODE_PATH=$PWD/server/node_modules`; `sqlite3` >= 3.40 on PATH; selftest 28/28.
- No LLM, no network (HTTP corroboration is opt-in and limited to GET /api/health).

## 1. Commit checklist

Commit `prereg/PREREG_S9.md`, `harness/oracles/s9_checklist_oracle.js`,
`harness/runners/s9_runner.js`, and this runbook.

## 2. Dry run

```bash
node security-eval/harness/runners/s9_runner.js --dry-run
```

Expect `DRY-RUN complete — nothing executed.`, 17 static + 6 probe checks,
`httpCorroboration: NOT_RUN_HTTP_DISABLED`, and the per-rung `layers` map. Delete the
smoke dir afterwards.

## 3. Real run

```bash
node security-eval/harness/runners/s9_runner.js --rung HEAD
node security-eval/harness/runners/s9_runner.js --rung c8b008e
node security-eval/harness/runners/s9_runner.js --rung 493a6bc
node security-eval/harness/runners/s9_runner.js --rung 903c3c1
```

What happens: an ISOLATED registry DB inside the run dir (your real registry is never
touched; deleted afterwards). In-process probes call the production functions:
lockout simulation (5 failures -> locked, progressive doubling), session revocation,
first/second-user roles, upload validator on 3 synthesized files, SSRF gate with an
INJECTED DNS lookup (zero network), CSV formula guard.

Layer availability per rung: lockout appears at 493a6bc, session revocation at 903c3c1,
the upload polyglot guard at c8b008e, SSRF pinning at ef91e9d — checks touching absent
layers are NOT_APPLICABLE, never failures.

Optional HTTP corroboration (informational only):

```bash
node security-eval/harness/runners/s9_runner.js --rung HEAD --base-url http://127.0.0.1:4000
```

## 4. Acceptance checklist

- [ ] Summary `valid: true`; every check id appears exactly once
      (`totalsReconcile: true`).
- [ ] Static family: report x/17 MATCH (NOT_APPLICABLE excluded from the denominator
      at early rungs).
- [ ] Probes: 6/6 MATCH at HEAD (NOT_APPLICABLE respected at early rungs).
- [ ] The five preregistered finding candidates are expected to CONFIRM at HEAD:
      S9-F1 (no JWT algorithm allowlist), S9-F2 (no helmet/CSP/HSTS), S9-F3 (error
      message passthrough), S9-F4 (plaintext credentials), S9-F5 (no audit hash
      chain). A MATCH on their check means the documented gap EXISTS — that is the
      preregistered expectation, not a new discovery. Any MISMATCH means the code
      changed since the facts were verified — investigate before quoting.
- [ ] S9-P4/S9-P5 verdicts come from real validator calls — quote the evidence lines.

## 5. Quote rules

- Never report "S9 PASS". Report "x/N MATCH against preregistered expectations;
  M/N preregistered gaps confirmed present".
- HTTP corroboration never overrides in-process verdicts.
- At rungs earlier than the layer commit, quote x/N *applicable* checks and say which
  layers were NOT_APPLICABLE.

## 6. Triage

| Symptom | Cause | Fix |
|---|---|---|
| exit 2 `WORKTREE_REQUIRE_FAILED` | worktree/node_modules missing | build ladder worktree; symlink server/node_modules |
| S9-P1 fails | lockout behaviour drifted from 5/15min/x2/24h | findings entry; re-verify auth.registry.js constants |
| S9-P5 public-IP case throws | lookup injection signature mismatch | check assertPublicUrl call shape; do NOT switch to real DNS |
| upload probes behave differently | file.validator changed | re-run fact verification; findings entry |
