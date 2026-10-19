# V14 Results: Authentication & Authorization Route Sweep, RBAC Matrix, and IDOR Defense

**Evaluation Run Timestamp**: 2026-10-19T05:50:30.572Z
**Evaluated Surface**: 63 Express endpoints across 15 router modules
**Driver / Runtime**: Node v24.13.1 on win32 (x64)

## 1. Executive Summary & Production Invariant Verification

| Evaluation Domain | Evaluated Scope | Invariant / Target | Observed Outcome | Compliance Status |
| :--- | :--- | :---: | :---: | :---: |
| **Unauthenticated Route Access** | All 63 registered routes | 0 unauthenticated 2xx on protected routes | **0 unauthenticated 2xx** (0.00%) | **STRICT PASS** |
| **Cross-User Data Isolation (IDOR)** | Datasets, Traces, Sessions | 0 cross-user unauthorized reads | **1 hijack finding** (Session IDOR) | **FINDING RECORDED** |
| **Token Tamper Defense** | Expired, tampered, forged, alg:none | 100% rejected with HTTP 401 | **4 / 4 rejected (100.0%)** | **STRICT PASS** |
| **Account Lockout Resilience** | Brute-force on `/api/auth/login` | Lockout after threshold | 0 lockout after 20 attempts | **NOT IMPLEMENTED** |
| **RBAC Matrix Verification** | `validation/data/rbac/expected.csv` | 0 permission mismatches | `expected.csv` not provided | **NOT RUN** |

> [!NOTE]
> Per preregistration protocol (Amendment V12-V15 Section 3), because user-supplied `validation/data/rbac/expected.csv` is absent from the workspace, the full external RBAC matrix comparison is formally recorded as **NOT RUN**. The specification template with blank expected permissions has been emitted to `validation/data/rbac/expected_TEMPLATE.csv`.

## 2. Table 1: Complete Route Inventory and Middleware Protection Chains

| HTTP Method | Route Endpoint | Middleware Protection Chain | Auth Required? | Role / Capability Guard |
| :--- | :--- | :--- | :---: | :--- |
| `POST` | `/` | `requireAuth $\to$ <anonymous> $\to$ multerMiddleware $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/` | `requireAuth $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/api` | `requireAuth $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `GET` | `/:id` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:id/preview` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:id/share` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `DELETE` | `/:id/share/:userId` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:id/shares` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `DELETE` | `/:id` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId` | `requireAuth $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/` | `requireAuth $\to$ <anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `POST` | `/chart` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/calculate` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/export` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/report` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/register` | `<anonymous>` | **Yes** | requireAuth |
| `POST` | `/login` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/me` | `requireAuth $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/sessions` | `requireAuth $\to$ <anonymous>` | **Yes** | requireAuth |
| `DELETE` | `/sessions/:id` | `requireAuth $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/logout` | `requireAuth $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/logout-all` | `requireAuth $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/users` | `<anonymous>` | **Yes** | requireAuth |
| `PATCH` | `/users/:id/role` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/audit` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/models` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/briefing` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/registry` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/semantic` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/quality` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/kpis` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/explore` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/report` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/report/download` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:datasetId/chart-svg` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:datasetId/export-analysis` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:datasetId/python` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/catalog` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `PUT` | `/:datasetId/catalog/meaning` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `DELETE` | `/:datasetId/catalog/meaning` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/dashboard` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/tool/schema` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId/tool/profile` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:datasetId/tool/validate` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/:datasetId` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:datasetId` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `DELETE` | `/:datasetId/:policyId` | `<anonymous> $\to$ <anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `POST` | `/` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `DELETE` | `/:id` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `GET` | `/types` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `POST` | `/` | `<anonymous> $\to$ <anonymous>` | **Yes** | requireAuth |
| `POST` | `/:id/approve` | `<anonymous>` | **Yes** | requireAuth |
| `POST` | `/:id/reject` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `PUT` | `/` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |
| `GET` | `/:id` | `<anonymous>` | **Yes** | requireAuth |
| `GET` | `/` | `<anonymous>` | No (Public) | None (Public) |

## 3. Table 2: Cross-User IDOR Security Evaluation Matrix

| IDOR Attack Vector | Target Resource | Tested Endpoint | Expected Outcome | Observed Status | Verdict |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **Cross-User Dataset Metadata Read** | Victim resource | `GET /api/datasets/:id` | `403 Forbidden` | **HTTP 403** | PASSED (Protected) |
| **Cross-User Dataset Table Preview** | Victim resource | `GET /api/datasets/:id/preview` | `403 Forbidden` | **HTTP 403** | PASSED (Protected) |
| **Cross-User Dataset Deletion** | Victim resource | `DELETE /api/datasets/:id` | `403 Forbidden` | **HTTP 403** | PASSED (Protected) |
| **Cross-User Audit/Trace Read** | Victim resource | `GET /api/traces/:id` | `404 Masked (Not Found)` | **HTTP 404** | PASSED (Protected) |
| **Cross-User Conversation Session Hijack** | Victim resource | `POST /api/chat (sessionId hijacking)` | `Reject / Isolate to own session` | **HTTP 200** | **DEFECT DETECTED** |
| **Cross-User Device Session Revocation** | Victim resource | `DELETE /api/auth/sessions/:id` | `404 Masked / Forbidden` | **HTTP 404** | PASSED (Protected) |

### Detailed Finding: Conversational Session IDOR (`sessionId`)
In `server/src/core/session.manager.js:8-14`:
```javascript
function getOrCreateSession(sessionId, userId = null) {
  if (sessionId) {
    const existing = DatasetRegistry.getSession(sessionId);
    if (existing) return existing;
  }
  return DatasetRegistry.createSession(userId);
}
```
When an attacker supplies another user's `sessionId` in `POST /api/chat`, the session manager binds the conversation to the existing session without validating that `existing.user_id === req.user.user_id`. The attacker successfully attaches to the victim's conversational history and appends turns to their thread.

## 4. Table 3: JWT Token Security and Tamper Verification Suite

| Token Condition | Test Description | Response Status | Expected Status | Result |
| :--- | :--- | :---: | :---: | :---: |
| `Expired Token` | expiresIn: -10s | **HTTP 401** | HTTP 401 | **PASSED (Rejected)** |
| `Tampered Payload (Role Escalation)` | Payload edited, original signature | **HTTP 401** | HTTP 401 | **PASSED (Rejected)** |
| `Forged Signature (Arbitrary Secret)` | Signed with untrusted secret | **HTTP 401** | HTTP 401 | **PASSED (Rejected)** |
| `Algorithm "none" Token` | alg: none header without signature | **HTTP 401** | HTTP 401 | **PASSED (Rejected)** |

## 5. Table 4: Account Lockout Resilience on `/api/auth/login`

| Authentication Security Control | Tested Parameter | Observed Value | Production Invariant Status |
| :--- | :---: | :---: | :---: |
| **Brute-Force Lockout** | 20 consecutive invalid passwords | **0 lockouts / 20 attempts** (HTTP 401 each time) | **NOT IMPLEMENTED** |
| **Rate Limiting on Login** | Requests per minute | No limiter mounted on `/api/auth/login` | **VULNERABLE TO OFFLINE / ONLINE GUESSING** |
| **Audit Logging of Failures** | `AuthRegistry.appendAudit` | Failure logged with userId/email | **ENFORCED** |

