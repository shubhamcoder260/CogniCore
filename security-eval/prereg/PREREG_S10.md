# PREREG_S10 — Actions and Tool Abuse

Status: REGISTERED BEFORE RUNNER IMPLEMENTATION (context pack §7 S10, rule 5).
Methodology anchors: InjecAgent (Findings of ACL 2024) and AgentDojo (NeurIPS 2024) —
attacker instructions embedded in data must not trigger privileged tool execution. Here
the tools are the action queue (send_email / save_report / webhook), exports and reports.
NOT RUN here; the operator executes per RUNBOOK_S10.md.

---

## 1. Threat model

- Actor: (A1) a low-privilege authenticated user (capability 'action.propose' — analyst/
  user roles have it per rbac.js:58-59) attempting to abuse the proposal pipeline;
  (A2) a data-level attacker whose poisoned content (S6/S7) steers a proposal's params;
  (A3) a malicious proposer hoping a privileged approver executes an action that reads
  data the proposer must not see.
- Entry surface: POST /api/actions (propose), POST /api/actions/:id/approve|reject,
  the action registry validators, the executor, the tools/export + tools/report routes.
- Asset: no action executes without a privileged approval; allowlists hold; proposal
  params cannot smuggle headers/paths; execution uses the PROPOSER's data permissions.
- Goal (attacker): execute without approval, exfiltrate via email/webhook to an
  arbitrary recipient/host, smuggle headers or traversal paths, widen data access.
- Out of scope: SMTP delivery with a real relay (no network in this suite), LLM-driven
  proposal generation (mock proposal corpus is static and preregistered), chart/calculate
  tool internals (S2/S1 coverage).

## 2. Verified code anchors (HEAD 9cde26c; re-verify per rung)

| Fact | Anchor |
|---|---|
| Types whitelist: send_email, save_report, webhook only | server/src/actions/action.registry.js:45-85 |
| Email: 1-10 valid addresses; ACTION_EMAIL_ALLOWED_DOMAINS gate | action.registry.js:49-52 |
| Webhook: ACTION_WEBHOOK_ALLOWLIST required; host must match; https-only outside test mode | action.registry.js:73-80 |
| propose() validates then stores PENDING (never executes) | action.registry.js:93-101 |
| Approval gate: capability 'action.approve', pending-only, self-approval banned except admin/env | server/src/actions/action.executor.js:74-80 |
| Executor runs with PROPOSER's permissions (canRead/can('report')/resolvePolicy on proposer) | action.executor.js:14-23 |
| Report filename sanitized to [A-Za-z0-9_-]; path.basename in result | action.executor.js:22,54-56 |
| send_email without SMTP_HOST is SIMULATED and recorded to the outbox | action.executor.js:43-49 |
| Webhook executor: assertPublicUrl + requestWithPinnedIp, FIXED headers, payload only in body | action.executor.js:58-69 |
| Routes: propose requires 'action.propose'; list scoped (approvers all, others own) | server/src/api/routes/actions.js:14-26 |
| Tools export: filename sanitized before Content-Disposition | server/src/api/routes/tools.js:45,52,58,80 |

## 3. Hypotheses and criteria (preregistered)

In-process on an ISOLATED registry DB; env allowlist variables are set/restored per case
in-process (never persisted); webhook actions are validated/proposed but NEVER executed
(execution would be a network call — out of scope by design).

- H10-A1 type whitelist: proposing an unknown type is rejected; the three known types
  are accepted as pending. Criterion: exact (reject + 3 pending).
- H10-A2 email allowlist: with ACTION_EMAIL_ALLOWED_DOMAINS=corp.example.invalid,
  non-corp recipients rejected, corp accepted; without the env, any syntactically valid
  1-10 recipient list accepted; >10 recipients rejected. Criterion: 4/4 cases exact.
- H10-A3 webhook allowlist: without ACTION_WEBHOOK_ALLOWLIST every proposal rejected;
  with it, non-matching host rejected, matching https host accepted, http matching host
  rejected outside test mode. Criterion: 4/4 cases exact.
- H10-A4 approval gate: analyst proposer self-approving -> 403; 'user'-role decider
  (no 'action.approve') -> 403; manager non-proposer -> allowed; admin self-approval ->
  allowed by design (executor :77). Criterion: 4/4 exact.
- H10-A5 proposer-permission binding: save_report proposed by an analyst WITH read
  access executes (admin approval) writing into the ISOLATED exports dir; a second
  proposal for a dataset the analyst CANNOT read fails at execution with the
  proposer-permission error, even though the approver is admin. Criterion: 2/2 exact.
- H10-A6 delivery honesty: without SMTP_HOST the executed send_email records delivery
  'simulated' with an outbox row and performs no external send. Criterion: exact.
- H10-B1 export filename sanitization (route-rule replication of tools.js:45, labelled):
  battery ['../../etc/passwd', 'r\nn: injection', 'a;b', 'name with spaces', '..\\x']
  all map to [A-Za-z0-9_-] only; the resulting Content-Disposition line contains no CR,
  LF, '/', or '\\'. Criterion: 5/5.
- H10-B2 webhook header smuggling: proposed payloads containing header-like keys
  cannot alter executor headers — the header set is the FIXED set at executor :62-66
  (replicated and asserted equal); payload appears only in the JSON body. Criterion:
  header-set equality + body-only payload.
- H10-C1 queue scoping: list() with requestedBy filtering — a non-approver sees only
  own proposals (route rule :14-17, replication labelled); an approver sees all.
  Criterion: 2/2 exact.
- H10-C2 decision endpoints enforce capability: assertCanDecide throws 403 for a
  non-approver on both approve and reject paths. Criterion: 2/2 exact.

## 4. Outcome taxonomy

Each case: ENFORCED | BYPASSED | NOT_APPLICABLE(layer absent at rung) | NOT_RUN.
Runs valid only when every preregistered case has exactly one outcome and totals
reconcile. MISMATCH/BYPASSED cases generate findings-register entries (S10-F*).

## 5. NOT RUN declarations

- Whole suite NOT RUN by the harness author (no executions of any validation case).
- Real SMTP delivery and real webhook POSTs: NEVER (network). The webhook path is
  exercised only up to proposal validation.
- LLM-generated proposal corpora (InjecAgent-style direct/tool prompts): deferred to the
  phase-5 model-mediated track (I11) — this suite uses a static preregistered battery.
- Novelty track (outbound provenance control on action params) deferred to I10 after
  baseline freeze.

## 6. Ladder

Rungs: ef91e9d (Item 10 webhook SSRF pinning) and HEAD. Per-rung probes: ActionRegistry,
assertCanDecide, requestWithPinnedIp presence; absent layers NOT_APPLICABLE. Worktrees
../cognicore-ladder/<hash>, node_modules symlinked, removed after the run (operator).

---

## AMENDMENT 1 (filed before any run, S6-amendment precedent)

- A5 positive half: the report EXECUTION path requires a real semantic model
  (report.builder.js:33-34) and working analytics. The harness fabricates a minimal
  semantic profile over a per-run synthetic sqlite dataset; if the analytics layer
  rejects that synthetic shape for reasons UNRELATED to permissions, the positive half
  is recorded with deviation=SEMANTIC_FIXTURE_LIMITATION and is excluded from the 2/2
  criterion (which then counts only the strict access-denied half). The deviation is
  printed in the summary `deviations` field — never averaged away, never counted as a
  bypass.
- Webhook https-only assertion: NODE_ENV is forced to a non-test value during A3
  validation so the documented test-mode bypass (action.registry.js:77) cannot mask the
  production rule; the bypass itself is recorded as a designed behaviour, not a finding.
