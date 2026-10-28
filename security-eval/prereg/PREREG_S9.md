# PREREG_S9 — Authentication and Application Security (checklist suite)

Status: REGISTERED BEFORE RUNNER IMPLEMENTATION (context pack §7 S9, rule 5).
Standards note (pack): OWASP ASVS / API Security Top 10 are industry checklists and are
cited as such, not as peer-reviewed sources. The checklist below is preregistered with
the exact expected verdict per check BEFORE the runner exists; PASS/FAIL is only ever
reported against these preregistered expectations, never invented post hoc.
NOT RUN here; the operator executes per RUNBOOK_S9.md.

---

## 1. Threat model

- Actor: unauthenticated internet client (brute force, token forgery, SSRF probing),
  low-privilege authenticated user (IDOR, privilege escalation), or local attacker with
  registry-file read access (credential storage).
- Entry surface: /api/auth/*, /api/admin/*, dataset/trace routes, upload pipeline,
  API connector, error handler, registry database.
- Asset: account integrity, session integrity, tenant isolation, upload safety,
  internal network isolation, secret hygiene, audit integrity.
- Out of scope: SQL/policy behaviour (S1/S2), action/tool abuse (S10), load testing.

## 2. Verified code anchors (HEAD 9cde26c; re-verify per rung)

| Fact | Anchor |
|---|---|
| signToken: HS256-family default, role inside payload, expiresIn from config | server/src/security/auth.js:13-19 |
| verifyToken: no `algorithms` allowlist | auth.js:21-23 |
| JWT secret default 'CHANGE_ME_dev_only_insecure_secret'; production assert exists | server/src/config/env.js:50-51,70-77 |
| First-user-admin bootstrap; later users role 'user' | server/src/api/routes/auth.js:33-36 |
| Password policy: length >= 8 only | auth.js:26-28 |
| Lockout: 5 attempts / 15 min window / base 1 min x2 progressive / 24 h cap | server/src/security/auth.registry.js:204-207,262-266 |
| Login IP taken from spoofable x-forwarded-for | auth.js:54 |
| Session revocation checked in requireAuth | server/src/security/rbac.js:30-32 |
| Chat rate limit: in-memory sliding window, 30/min default, Retry-After | server/src/guardrails/rate.limit.js:7-22 |
| Traces: list scoped to user; detail owner-or-admin | server/src/api/routes/traces.js:12,16-18 |
| Datasets: read/manage via requireDatasetAccess on every route | server/src/api/routes/datasets.js:37,42,70,88,98,104 |
| Upload: requireAuth + capability 'upload'; magic bytes, script-polyglot, SQLite trigger/view/virtual-table strings, page-boundary, zip caps; fails closed | server/src/api/routes/upload.js:31; server/src/security/file.validator.js:99-176 |
| SSRF: DNS resolution + private-range rejection + PINNED IP request + host allowlist env | server/src/ingestion/api.connector.js:143-180 |
| CSV formula-injection guard (prefix ' for =+-@\t\r non-numeric) | server/src/tools/export.tool.js:10-16 |
| Security headers: NO helmet/CSP/HSTS middleware on the app | server/src/app.js:24-57 (absence) |
| Error handler: err.message always returned; stack only in development | server/src/api/middleware/errorHandler.js:4-14 |
| Credentials stored as plaintext JSON in the registry | server/src/ingestion/dataset.registry.js:131+ (getCredentials) |
| Audit log: plain INSERT, no hash chaining / tamper evidence | server/src/security/auth.registry.js:135+ (appendAudit) |
| Admin routes admin-only; PATCH role validates against ROLES | server/src/api/routes/admin.js:7,15-23 |

## 3. Preregistered checklist (expected verdict fixed BEFORE the run)

Each check: id | method | expectation. Verdicts: MATCH (observed == expectation) or
MISMATCH (finding entry, never silent). NOT_APPLICABLE when the layer does not exist at
the rung (per-rung probes). PASS rate is reported only as x/N MATCH — never "suite PASS".

Static checks (grep the worktree at the rung; evidence = file:line):
- S9-01 static JWT expiry configured (expiresIn present in signToken) — EXPECT PRESENT.
- S9-02 static JWT secret weak default in dev + production assert — EXPECT BOTH FACTS
  (weak default is a FINDING-class fact for dev deployments; the production assert is
  the mitigating control).
- S9-03 static no `algorithms` allowlist in verifyToken — EXPECT ABSENT (finding
  candidate S9-F1: algorithm pinning missing; assess jsonwebtoken version behaviour).
- S9-04 static first-user-admin bootstrap — EXPECT PRESENT.
- S9-05 static PATCH role admin-only via requireRole('admin') — EXPECT PRESENT.
- S9-06 static lockout constants (5 / 15 min / 1 min x2 / 24 h) — EXPECT PRESENT.
- S9-07 static requireAuth checks session revocation — EXPECT PRESENT (903c3c1+).
- S9-08 static chat rate limiter exists and is in-memory — EXPECT PRESENT + in-memory
  (the in-memory part is a documented limitation, pack §3).
- S9-09 static traces owner-or-admin scoping — EXPECT PRESENT (903c3c1+).
- S9-10 static datasets requireDatasetAccess on read/share/delete — EXPECT PRESENT.
- S9-11 static upload: magic-byte/structure check + trigger/view/virtual-table strings +
  zip caps — EXPECT PRESENT (c8b008e+).
- S9-12 static SSRF: assertPublicUrl + pinnedIp + allowlist env — EXPECT PRESENT
  (ef91e9d+).
- S9-13 static CSV formula-injection guard in export.tool — EXPECT PRESENT.
- S9-14 static security headers middleware (helmet/CSP/HSTS) — EXPECT ABSENT (finding
  candidate S9-F2).
- S9-15 static error handler: stack gated to development; message passthrough — EXPECT
  BOTH FACTS (message passthrough = finding candidate S9-F3, severity info).
- S9-16 static credentials plaintext at rest in registry — EXPECT PRESENT (finding
  candidate S9-F4).
- S9-17 static audit log without hash chaining — EXPECT PRESENT (finding candidate S9-F5).

In-process probes (real functions on an ISOLATED registry DB; no HTTP):
- S9-P1 lockout simulation: 5 recordFailedLogin calls then checkLoginLock.locked == true
  with a Retry-After > 0; 6th failure doubles the lock duration — EXPECT enforced.
- S9-P2 session revocation: revokeSession then isSessionActive == false — EXPECT
  enforced (903c3c1+).
- S9-P3 first/second user roles via the route rule (countUsers()==0 -> admin, else
  'user') on a fresh registry — EXPECT enforced.
- S9-P4 upload validator on 3 synthesized files: (a) .pdf containing '<script' rejected;
  (b) fake .xlsx (PK header, no xl/ entries) rejected; (c) plain .csv text accepted —
  EXPECT exactly this (c8b008e+).
- S9-P5 SSRF: assertPublicUrl('http://127.0.0.1/') and
  'http://169.254.169.254/' throw; with an INJECTED lookup returning a public IP the
  call passes and pins that IP (no network used) — EXPECT enforced (ef91e9d+).
- S9-P6 CSV guard: toCsvBuffer on ['=SUM(A1)', '+2', '-1', '@x', '42'] prefixes the
  first four with a quote, leaves '42' intact — EXPECT enforced.

HTTP checks: opt-in via --base-url + --tokens-file (real routes; e.g. 429 after lockout,
401 after logout, security headers observed). Default NOT_RUN_HTTP_DISABLED; HTTP
results never override in-process verdicts — they are recorded as corroboration.

## 4. Statistics and reporting

- Report: x/N MATCH per method family (static 17, in-process 6, HTTP optional), every
  MISMATCH with evidence paths and a findings-register entry (S9-F1..F5 candidates
  above). No rates, no CIs needed for a checklist; zero-event statistics do not apply.
- Totals reconcile: every checklist id appears exactly once per run with exactly one
  verdict; runs with any missing verdict are valid:false.

## 5. NOT RUN declarations

- Whole suite NOT RUN by the harness author (no executions).
- HTTP corroboration: NOT_RUN_HTTP_DISABLED unless --base-url/--tokens-file provided.
- Secret strength entropy measurement, TLS configuration, and dependency CVE scanning
  are out of scope (no tooling preregistered).

## 6. Ladder

Rungs: 903c3c1 (session binding), 493a6bc (login lockout), c8b008e (upload guard),
HEAD. Per-rung probes mark layers introduced later as NOT_APPLICABLE (e.g. lockout
probes at 903c3c1, upload polyglot probes at 493a6bc and earlier). Worktrees
../cognicore-ladder/<hash>, node_modules symlinked, removed after the run (operator).
