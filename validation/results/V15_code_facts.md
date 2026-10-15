# V15 Code Facts: Sensitive-Information Exposure Control & PII Redaction

This document establishes the verified code-level facts for CogniCore's sensitive-information exposure control and PII redaction pipeline. All findings cite exact source file locations and verbatim code excerpts from `server/src/guardrails/pii.js` and associated engine/route handlers.

---

## 1. Core Architecture and Masking Roles

PII redaction is implemented in `server/src/guardrails/pii.js`. Masking is role-gated based on environment configuration:

- **Source**: `server/src/guardrails/pii.js:8`
```javascript
const MASK_ROLES = new Set((process.env.PII_MASK_ROLES || 'viewer,employee').split(',').map((s) => s.trim()).filter(Boolean));
```
- **Role Gating Logic**: `server/src/guardrails/pii.js:18`
```javascript
const shouldMask = (role) => MASK_ROLES.has(role);
```
- **Default Gating**:
  - Masked roles: `viewer`, `employee`.
  - Unmasked roles: `analyst`, `manager`, `admin`, and any custom unconfigured role.

---

## 2. Redaction Patterns and Transformation Rules

Pattern definitions and masking replacement callbacks in `server/src/guardrails/pii.js:10-16`:

```javascript
const PATTERNS = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, mask: (m) => m.replace(/^(.).*(@.*)$/, '$1***$2') },
  { re: /\b(?:\d[ -]?){13,19}\b/g, mask: (m) => `**** **** **** ${m.replace(/\D/g, '').slice(-4)}` },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, mask: () => '***-**-****' },
  { re: /\b\d{4}\s\d{4}\s\d{4}\b/g, mask: (m) => `**** **** ${m.slice(-4)}` },
  { re: /(?<!\d)\+?\d[\d\s\-().]{8,16}\d(?!\d)/g, mask: (m) => { const d = m.replace(/\D/g, ''); return d.length >= 9 && d.length <= 15 ? `${'*'.repeat(d.length - 3)}${d.slice(-3)}` : m; } },
];
```

### Pattern Analysis

1. **Email Address**:
   - Regex: `/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g` (`pii.js:11`)
   - Transformation: `(m) => m.replace(/^(.).*(@.*)$/, '$1***$2')`
   - Preserves: First letter of username and entire domain name (e.g., `alice@example.com` -> `a***@example.com`).
   - Gaps: Does not match obfuscated addresses (e.g. `user at domain dot com`).

2. **Credit Card / Generic 13-19 Digit Sequence**:
   - Regex: `/\b(?:\d[ -]?){13,19}\b/g` (`pii.js:12`)
   - Transformation: `(m) => '**** **** **** ' + m.replace(/\D/g, '').slice(-4)`
   - Preserves: Last 4 digits.
   - Gaps: No Luhn algorithm verification. Any 13 to 19 digit number (e.g., order numbers, epoch timestamps, serial keys) is blindly masked as a credit card.

3. **US Social Security Number (SSN)**:
   - Regex: `/\b\d{3}-\d{2}-\d{4}\b/g` (`pii.js:13`)
   - Transformation: `() => '***-**-****'`
   - Gaps: Does not match unhyphenated 9-digit SSNs (`\d{9}`) or space-separated SSNs (`\d{3}\s\d{2}\s\d{4}`).

4. **12-Digit Spaced Sequence (Aadhaar format)**:
   - Regex: `/\b\d{4}\s\d{4}\s\d{4}\b/g` (`pii.js:14`)
   - Transformation: `(m) => '**** **** ' + m.slice(-4)`
   - Gaps: Matches exactly 3 groups of 4 digits separated by whitespace. Unspaced 12-digit numbers are caught by Pattern 2 (13-19 digits fails; 12 digits unspaced is completely unmasked).

5. **Phone Number**:
   - Regex: `/(?<!\d)\+?\d[\d\s\-().]{8,16}\d(?!\d)/g` (`pii.js:15`)
   - Transformation: Extracts digits `d = m.replace(/\D/g, '')`. If length is between 9 and 15 digits, masks all but last 3 digits (`'*'.repeat(d.length - 3) + d.slice(-3)`).
   - Gaps: Masking strips formatting entirely, replacing string with raw asterisks and 3 digits.

6. **Out-of-Scope Identifier Gaps**:
   - **PAN (Permanent Account Number)**: 10-character alphanumeric Indian tax ID (e.g., `ABCDE1234F`). No pattern exists.
   - **Person Names**: No named-entity recognition (NER) or lexicon lookup in `maskText`. Person names are unredacted.

---

## 3. Invocation Points Across System Egress Channels

| Channel | Handler Location | Redaction Applied? | Mechanism & Code Reference |
| :--- | :--- | :---: | :--- |
| **Response Text** (`final.answer`) | `server/src/core/core.engine.js:169` | **YES** | `maskText(final.answer)` for roles `viewer` and `employee` or when `red.redacted > 0`. |
| **Evidence Sample Rows** | `server/src/core/core.engine.js:167` | **YES** | `redactEvidence(evidence, semantic, actor.role)` walks `ev.sample_rows` and masks PII columns and string values. |
| **Analytics Query Sample Rows** | `server/src/api/routes/analytics.js:135` | **YES** | `redactEvidence({ ...ev, sample_rows: result.rows }, dataset.profile?.semantic, req.user.role).evidence` |
| **Document Search Chunks** | `server/src/guardrails/pii.js:52` | **YES** | `chunks.map(c => ({ ...c, text: maskText(c.text) }))` in `redactEvidence`. |
| **Chat Execution Result** (`execResult.rows`) | `server/src/core/core.engine.js:195`<br>`server/src/api/routes/chat.js:51-52` | **NO** | `publicResult.execResult` exposes raw database execution rows directly to the client without calling `redactEvidence` or `maskText`. |
| **Dataset Preview** (`GET /api/datasets/:id/preview`) | `server/src/api/routes/datasets.js:54-55` | **NO** | Directly returns `adapter.preview(tableName, limit)`. Zero redaction invoked. |
| **CSV Export** (`POST /api/tools/export format=csv`) | `server/src/api/routes/tools.js:50`<br>`server/src/tools/shared.js:47-49` | **NO** | Direct dump of `executeValidatedQuery` to `toCsvBuffer`. Zero redaction invoked. |
| **Excel Export** (`POST /api/tools/export format=xlsx`) | `server/src/api/routes/tools.js:56`<br>`server/src/tools/shared.js:47-49` | **NO** | Direct dump of `executeValidatedQuery` to `toXlsxBuffer`. Zero redaction invoked. |
| **PDF Report** (`POST /api/tools/report`) | `server/src/api/routes/tools.js:67-74`<br>`server/src/tools/report.tool.js:49` | **NO** | Raw `result.rows` passed directly to `buildPdfReport` and rendered via `drawTable`. |
| **Audit Logs** (`AuthRegistry.appendAudit`) | `server/src/security/auth.registry.js`<br>`server/src/api/routes/chat.js:40-49` | **NO** | User questions, query parameters, and details logged verbatim in memory. |
| **Application Logs** (`logger.*`) | `server/src/config/logger.js:14-23` | **NO** | Console wrapper prints error messages and metadata unmasked. |
| **Error Responses** (`errorHandler`) | `server/src/api/middleware/errorHandler.js:5-14` | **NO** | Masking only hides stack traces in production; error messages are unredacted. |
