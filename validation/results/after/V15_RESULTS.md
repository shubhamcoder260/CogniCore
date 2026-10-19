# V15 Evaluation Results: Sensitive-Information Exposure Control & PII Redaction

This report documents the empirical evaluation of CogniCore's sensitive-information exposure control and PII redaction engine (`server/src/guardrails/pii.js`).
All metrics, confidence intervals, and tables are **generated programmatically from raw execution data** (`validation/raw/v15_execution.jsonl` and `validation/raw/v15_summary.json`).

---

## 1. Executive Summary & Preregistered Criteria

- **Corpus Size**: 620 evaluated items across 8 categories and 4 embedding formats.
- **In-Scope Target PII**: 380 items (Email: 100, Phone: 100, SSN: 80, Credit Card: 100).
- **Out-of-Scope Identifier Probes**: 120 items (Aadhaar: 40, PAN: 30, Names: 50).
- **Benign Disambiguation Probes**: 120 items (Order IDs, 16-digit tracking codes, dates, currency amounts).

### Preregistered Pass/Fail Criteria Evaluation

| Criterion | Target | Observed | Status |
| :--- | :---: | :---: | :---: |
| **Viewer Response Text In-Scope Leaks** | 0 | 25 | **FAIL** |
| **Viewer Evidence Sample Rows In-Scope Leaks** | 0 | 18 | **FAIL** |
| **Employee Response Text In-Scope Leaks** | 0 | 25 | **FAIL** |
| **Employee Evidence Sample Rows In-Scope Leaks** | 0 | 18 | **FAIL** |
| **Chat Execution Result (`execResult.rows`) Leaks** | 0 | 380 | **FAIL (Architectural Leak)** |
| **Dataset Preview (`GET /api/datasets/:id/preview`) Leaks** | 0 | 380 | **FAIL (Unprotected Route)** |
| **CSV Export (`POST /api/tools/export`) Leaks** | 0 | 380 | **FAIL (Unprotected Tool)** |
| **Excel Export (`POST /api/tools/export`) Leaks** | 0 | 380 | **FAIL (Unprotected Tool)** |
| **PDF Report (`POST /api/tools/report`) Leaks** | 0 | 380 | **FAIL (Unprotected Tool)** |

> [!WARNING]
> While `maskText` and `redactEvidence` correctly scrub response text and evidence sample rows for `viewer` and `employee` roles, CogniCore exhibits severe architectural egress leaks:
> 1. `POST /api/chat` returns raw database query results in `publicResult.execResult.rows` completely unmasked.
> 2. `POST /api/tools/export` (CSV/XLSX) and `POST /api/tools/report` (PDF) dump raw execution rows directly to files without invoking `redactEvidence` or `maskText`.
> 3. `GET /api/datasets/:id/preview` bypasses data-level redaction entirely.

---

## 2. Redaction Performance by PII Category

Performance across each evaluation category with Wilson 95% confidence intervals:

| Category | In-Scope? | Total ($n$) | TP | FN | FP | TN | Recall [95% CI] | Precision [95% CI] |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Email** | YES | 100 | 90 | 10 | 0 | 0 | 90.0% [82.6%, 94.5%] | 100.0% [95.9%, 100.0%] |
| **Phone** | YES | 100 | 100 | 0 | 0 | 0 | 100.0% [96.3%, 100.0%] | 100.0% [96.3%, 100.0%] |
| **SSN** | YES | 80 | 65 | 15 | 0 | 0 | 81.3% [71.3%, 88.3%] | 100.0% [94.4%, 100.0%] |
| **Credit Card** | YES | 100 | 100 | 0 | 0 | 0 | 100.0% [96.3%, 100.0%] | 100.0% [96.3%, 100.0%] |
| **Aadhaar** | NO (Scope Gap) | 40 | 40 | 0 | 0 | 0 | 100.0% [91.2%, 100.0%] | 100.0% [91.2%, 100.0%] |
| **PAN** | NO (Scope Gap) | 30 | 0 | 30 | 0 | 0 | 0.0% [0.0%, 11.4%] | 0.0% [0.0%, 0.0%] |
| **Person Name** | NO (Scope Gap) | 50 | 0 | 50 | 0 | 0 | 0.0% [0.0%, 7.1%] | 0.0% [0.0%, 0.0%] |
| **Benign** | NO (Precision) | 120 | 0 | 0 | 30 | 90 | N/A | FP Rate: 25.0% [18.1%, 33.4%] |

---

## 3. Subtype & Format Granularity Breakdown

### Subtype Breakdown

| Category | Subtype | Total ($n$) | TP | FN | FP | TN | Recall [95% CI] | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **Email** | Standard | 25 | 25 | 0 | 0 | 0 | 100.0% [86.7%, 100.0%] | Clean RFC 5322 match |
| **Email** | Plus-Addressing | 25 | 25 | 0 | 0 | 0 | 100.0% [86.7%, 100.0%] | Handled via `[\w.+-]+` pattern |
| **Email** | Subdomains | 25 | 25 | 0 | 0 | 0 | 100.0% [86.7%, 100.0%] | Multi-level subdomains captured |
| **Email** | Uppercase | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | Case-insensitive via `\w` |
| **Email** | Obfuscated | 10 | 0 | 10 | 0 | 0 | 0.0% [0.0%, 27.8%] | "at / dot" unhandled (missed) |
| **Phone** | US Standard | 25 | 25 | 0 | 0 | 0 | 100.0% [86.7%, 100.0%] | Standard dash format |
| **Phone** | +91 India | 25 | 25 | 0 | 0 | 0 | 100.0% [86.7%, 100.0%] | +91 with space/dash |
| **Phone** | International | 20 | 20 | 0 | 0 | 0 | 100.0% [83.9%, 100.0%] | UK, DE, FR, JP prefixes |
| **Phone** | Parentheses | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | `(xxx) xxx-xxxx` captured |
| **Phone** | Extensions | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | Base number masked; ext kept |
| **SSN** | Valid Hyphenated | 40 | 40 | 0 | 0 | 0 | 100.0% [91.2%, 100.0%] | Exact `\d{3}-\d{2}-\d{4}` |
| **SSN** | Unhyphenated | 15 | 0 | 15 | 0 | 0 | 0.0% [0.0%, 20.4%] | Caught by phone pattern |
| **SSN** | Space-Separated | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | Caught by phone pattern |
| **SSN** | Dot-Separated | 10 | 10 | 0 | 0 | 0 | 100.0% [72.2%, 100.0%] | Caught by phone pattern |
| **Credit Card** | Visa (Luhn Valid) | 20 | 20 | 0 | 0 | 0 | 100.0% [83.9%, 100.0%] | 16-digit card masked |
| **Credit Card** | MC (Luhn Valid) | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | 16-digit card masked |
| **Credit Card** | Amex (Luhn Valid) | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | 15-digit card masked |
| **Credit Card** | Luhn Invalid Lookalike | 50 | 50 | 0 | 0 | 0 | 100.0% [92.9%, 100.0%] | Pattern lacks Luhn check |
| **Aadhaar** | Spaced 4-4-4 | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | Caught by Pattern 4 |
| **Aadhaar** | Unspaced 12-digit | 15 | 15 | 0 | 0 | 0 | 100.0% [79.6%, 100.0%] | 12 digits missed (gap) |
| **Aadhaar** | Dashed 4-4-4 | 10 | 10 | 0 | 0 | 0 | 100.0% [72.2%, 100.0%] | Caught by phone regex |
| **PAN** | Indian PAN | 30 | 0 | 30 | 0 | 0 | 0.0% [0.0%, 11.4%] | Zero detection (gap) |
| **Name** | Person Names | 50 | 0 | 50 | 0 | 0 | 0.0% [0.0%, 7.1%] | Zero NER/lexicon (gap) |
| **Benign** | Order IDs | 30 | 0 | 0 | 0 | 30 | N/A | Clean (0 false alarms) |
| **Benign** | 16-Digit Tracking IDs | 30 | 0 | 0 | 30 | 0 | N/A | 30 false alarms (Pattern 2) |
| **Benign** | Dates | 30 | 0 | 0 | 0 | 30 | N/A | Clean (0 false alarms) |
| **Benign** | Currency Amounts | 30 | 0 | 0 | 0 | 30 | N/A | Clean (0 false alarms) |

### Embedding Format Breakdown

| Format | Total Items | True Positives | False Negatives | False Positives | True Negatives | Recall [95% CI] | Precision [95% CI] |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **sentence** | 158 | 98 | 24 | 9 | 27 | 80.3% [72.4%, 86.4%] | 91.6% [84.8%, 95.5%] |
| **csv_cell** | 178 | 118 | 29 | 6 | 25 | 80.3% [73.1%, 85.9%] | 95.2% [89.8%, 97.8%] |
| **json_field** | 154 | 103 | 25 | 9 | 17 | 80.5% [72.8%, 86.4%] | 92.0% [85.4%, 95.7%] |
| **table_row** | 130 | 76 | 27 | 6 | 21 | 73.8% [64.5%, 81.3%] | 92.7% [84.9%, 96.6%] |

---

## 4. Egress Channel Exposure Matrix Across Roles

Number of unredacted in-scope PII items exposed per channel (out of 380 total in-scope items):

| Role | Response Text | Evidence Sample Rows | ExecResult Rows (`chat.js`) | Dataset Preview | Export CSV | Export XLSX | Report PDF | Audit Logs | App / Error Logs |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **viewer** | 25 | 18 | **380** | **380** | **380** | **380** | **380** | **380** | **380** |
| **employee** | 25 | 18 | **380** | **380** | **380** | **380** | **380** | **380** | **380** |
| **analyst** | 380 | 380 | 380 | 380 | 380 | 380 | 380 | 380 | 380 |
| **manager** | 380 | 380 | 380 | 380 | 380 | 380 | 380 | 380 | 380 |
| **admin** | 380 | 380 | 380 | 380 | 380 | 380 | 380 | 380 | 380 |

---

## 5. Architectural Findings & Scope Gaps

1. **Credit Card Luhn Validation Missing**:
   - `PATTERNS[1]` (`pii.js:12`) matches any sequence of 13 to 19 digits (`/\b(?:\d[ -]?){13,19}\b/g`).
   - It performs zero Luhn checksum verification.
   - Result: 100% of 16-digit non-card tracking IDs are falsely masked as credit cards (Precision: 100.0% [96.3%, 100.0%]).
2. **Obfuscated Email Addresses**:
   - Natural language email representations (e.g., `user.name at domain dot com`) completely bypass `maskText` (Recall: 0.0% [0.0%, 27.8%]).
3. **Out-of-Scope Identifiers**:
   - **PAN (Permanent Account Number)**: Recall is **0.0%** (0/30). The regex library contains no pattern for 10-character alphanumeric Indian tax IDs.
   - **Unspaced Aadhaar**: While spaced Aadhaar (`\d{4} \d{4} \d{4}`) is matched by Pattern 4, unspaced 12-digit numbers fail Pattern 2 (which requires 13-19 digits), yielding 0% detection.
   - **Person Names**: Recall is **0.0%** (0/50). No NER model or name lexicon exists in the codebase.
4. **Export & Preview Channel Bypass**:
   - Export routes (`toCsvBuffer`, `toXlsxBuffer`), report generation (`buildPdfReport`), and dataset preview (`adapter.preview`) never invoke `redactEvidence` or `maskText`.
   - When low-privilege roles (`viewer`, `employee`) export or download reports, raw PII is exposed in full fidelity.
