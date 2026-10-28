# RUNBOOK_S8 — Resource Exhaustion and Availability

Prereg: `security-eval/prereg/PREREG_S8.md` (registered before the runner). Suite code:
`harness/oracles/s8_availability_oracle.js`, `harness/oracles/s8_item_worker.js`,
`harness/setup/12_build_s8_fixture.js`, `harness/runners/s8_runner.js`.
Rungs: `903c3c1`, `932996b`, `HEAD`.

## 0. Prerequisites

- `NODE_PATH=$PWD/server/node_modules`; `sqlite3` >= 3.40 on PATH; selftest 28/28.
- Fixture: `node security-eval/harness/setup/12_build_s8_fixture.js`
  (emits `data/fixtures/s8_availability.sqlite`, ~2.8 MB, 6 tables x 5,000 rows;
  SHA-256 pinned in the run manifest).
- No LLM, no network.

## 1. Commit checklist

Commit `prereg/PREREG_S8.md`, the two oracle files, the builder, the runner, the built
fixture (whitelisted via `!data/fixtures/**`), and this runbook.

## 2. Dry run

```bash
node security-eval/harness/runners/s8_runner.js --dry-run
```

Expect `DRY-RUN complete — nothing executed.`, `batteryClasses: 14`, `v4c: 29`,
`boundary: 12`, all probes true, LIMITS/maxRows/timeoutMs echoed from the worktree.
Delete the smoke dir afterwards.

## 3. Real run

```bash
node security-eval/harness/runners/s8_runner.js --rung HEAD
node security-eval/harness/runners/s8_runner.js --rung 932996b
node security-eval/harness/runners/s8_runner.js --rung 903c3c1
```

Expected wall time at HEAD: C8 (infinite recursive CTE) consumes the full 15 s engine
timeout; C10 runs 5 bounded CTEs; C11 runs 8 concurrent bounded CTEs — budget roughly
1-2 minutes per rung. Every execution happens inside a per-item worker thread with the
harness watchdog (timeout + 5000 ms); a blocking rung cannot wedge the harness.

v4c/boundary items resolve `bank/B1_community.db` under `data/fixtures/database/`;
without the realm fixtures (I2) those items record `SKIPPED_MISSING_FIXTURE` — honest,
never averaged away. The generated battery always runs.

## 4. Acceptance checklist

- [ ] `criteria.H8_A` true — 9/9 gate expectations exact (C2/C4/C5/C6a/C7b blocked by
      the complexity gate; C1/C3/C6b/C7a pass).
- [ ] `criteria.H8_B` true — C8 = TIMEOUT_WORKER_KILLED (wall time within
      [15000, 17000] ms, no watchdog) AND C12 health-after COMPLETED.
- [ ] `criteria.H8_C` true — C9 capped at exactly 1000 rows, `truncated: true`.
- [ ] `criteria.H8_D` — p99 main-thread drift <= 100 ms on C7a; if exceeded, finding
      candidate S8-F1 (tokenizer/complexity on the main event loop).
- [ ] Replay totals reconcile to 29 + 12 with per-item outcomes recorded.
- [ ] `zeroEventBounds.timeoutHung` present iff no TIMEOUT_HUNG anywhere.

## 5. Quote rules

- Timing comparisons across rungs are EXPLORATORY distributions (min/p50/p90/p99/max) —
  never "linear", never trend claims (see the withdrawn "linear O(N)" label in
  ERRATA_S1_S2). Only the four preregistered criteria (H8-A..D) take PASS/FAIL.
- At 903c3c1 the worker path may be absent (`probes.executeSqliteInWorker` false in the
  manifest): termination endpoints are NOT_APPLICABLE at that rung — record, don't guess.
- Runs with `valid: false` are unquotable.

## 6. Triage

| Symptom | Cause | Fix |
|---|---|---|
| exit 2 `MISSING_FIXTURE` | s8 fixture not built | run setup/12, commit it |
| C8 = TIMEOUT_OVERSHOOT | terminate() slow on that machine | record; investigate worker termination, findings entry |
| C8 = TIMEOUT_HUNG | engine timeout never fired or watchdog hit | findings entry S8-F2; do not average away |
| v4c all SKIPPED_MISSING_FIXTURE | realm fixtures absent (I2) | expected; build from database.zip per README §2 |
| exit 2 NOT_APPLICABLE | layer missing at rung | expected for some rungs; record rung characteristics |
