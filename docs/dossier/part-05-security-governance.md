# PART 5 — SECURITY, GOVERNANCE & SAFETY

This chapter specifies the deterministic security architecture, input and SQL validation guardrails, access control policies, credential protections, and threat mitigations implemented in CogniCore.

---

## 1. Input Guardrail Regexes

Input screening is executed in plain JavaScript prior to model invocation (`server/src/guardrails/input.guard.js:30`).

### Prompt Injection Detection (`INJECTION`)
Verbatim definition from `server/src/guardrails/input.guard.js:9-20`:

```javascript
const INJECTION = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|rules?|prompts?|messages?)/i,
  /disregard\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|your|these)?\s*(instructions?|rules?|guidelines|constraints)/i,
  /forget\s+(everything|all|your)\s+(above|previous|prior|instructions?|rules?)/i,
  /(reveal|show|print|display|repeat|output|leak)\s+(me\s+)?(your|the)\s+(hidden\s+|secret\s+|initial\s+)?(system\s+prompt|instructions|prompt|rules)/i,
  /you\s+are\s+now\s+(in\s+)?(dan|developer\s+mode|an?\s+unrestricted|jailbroken|no\s+longer)/i,
  /\b(jailbreak|do\s+anything\s+now)\b/i,
  /(bypass|override|disable|circumvent|turn\s+off)\s+(the\s+|all\s+|any\s+)?(security|permissions?|access\s+(control|rules?)|rbac|policy|policies|validation|safety|guardrails?|restrictions?|filters?)/i,
  /pretend\s+(that\s+)?(you\s+)?(have\s+no|are\s+not|don'?t\s+have)\s+(restrictions?|rules?|limits?)/i,
  /(act|respond)\s+as\s+(if\s+)?(i\s+am|i'm|an?)\s+(the\s+)?(admin(istrator)?|root|superuser)/i,
  /<\s*\/?\s*(system|assistant)\s*>|\[\s*(system|inst)\s*\]|###\s*system/i,
];
```

### SQL Injection Flagging (`SQLI_LIKE`)
Verbatim definition from `server/src/guardrails/input.guard.js:22-28`:

```javascript
const SQLI_LIKE = [
  /;\s*(drop|delete|truncate|alter|update|insert)\s/i,
  /\b(drop|truncate)\s+table\b/i,
  /\bunion\s+select\b/i,
  /('|")\s*or\s+('|")?1('|")?\s*=\s*('|")?1/i,
  /--\s*$/,
];
```

### Theoretical Bypasses & Limitations
1. **Semantic / Paraphrase Evasion**: Regex matching relies on literal phrase structures. Adversarial prompts using non-English languages (e.g., French, Russian, Base64 encoding), multi-step role-playing without keywords ("Imagine you are a novelist writing a character who has unrestricted access"), or typos ("pleez ignoer all rulz") bypass these string filters.
2. **Execution Safety Decoupling**: CogniCore explicitly acknowledges this limitation in code comments (`server/src/guardrails/input.guard.js:5-7`): input guardrails are an early filter; **execution safety is enforced downstream unconditionally by AST parsing and read-only database connections**.

---

## 2. SQL AST Validator & Safety Gates

Candidate SQL is parsed using `node-sql-parser` into an Abstract Syntax Tree (AST) before database dispatch (`server/src/structured/sql.validator.js:66`).

### Statement Whitelist
Verbatim from `server/src/structured/sql.validator.js:20`:
```javascript
const ALLOWED_STATEMENT_TYPES = new Set(['select']);
```

### Blocked Keyword Gate
Verbatim from `server/src/structured/sql.validator.js:21-25`:
```javascript
const BLOCKED_KEYWORDS = [
  'DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'ATTACH',
  'DETACH', 'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE', 'PRAGMA', 'VACUUM',
  'EXEC', 'EXECUTE', 'CALL',
];
```

### Defense-in-Depth Checks
1. **Keyword Screening (`lines 74-80`)**: Rejects queries containing any blocked keyword matching word boundaries `\b<KEYWORD>\b`.
2. **Statement Chaining Gate (`lines 83-85`)**: Rejects statements containing `;` unless it is the final character.
3. **Comment Smuggling Gate (`lines 86-88`)**: Rejects any occurrence of `--` or `/*`.
4. **AST Cardinality Gate (`lines 97-100`)**: Enforces `statements.length === 1`.
5. **AST Statement Type Gate (`lines 102-105`)**: Enforces `stmt.type === 'select'`.
6. **Schema Validation Gate (`lines 108-127`)**: Extracts all referenced tables via `parser.tableList()` and rejects queries referencing unknown tables or zero known tables. Names defined in CTEs (`WITH name AS ...`) are tracked and tolerated (`lines 115-117`).

---

## 3. SQL Complexity Limits

Complexity analysis is performed by `analyzeComplexity()` (`server/src/structured/sql.complexity.js:26`) and asserted inside `validateSql` (`server/src/structured/sql.validator.js:130-133`).

### Constants and Environment Overrides
Verbatim from `server/src/structured/sql.complexity.js:13-18`:

```javascript
const LIMITS = {
  maxLength: parseInt(process.env.SQL_MAX_LENGTH || '4000', 10),
  maxJoins: parseInt(process.env.SQL_MAX_JOINS || '6', 10),
  maxDepth: parseInt(process.env.SQL_MAX_SUBQUERY_DEPTH || '4', 10),
  maxEstimatedRows: parseFloat(process.env.SQL_MAX_ESTIMATED_ROWS || '5e9'),
};
```

### Evaluated Dimensions
1. **Query Length**: Rejects queries exceeding `LIMITS.maxLength` (4,000 characters).
2. **Join Count**: Tokenizes words and counts occurrences of `JOIN` plus comma-separated table joins (`LIMITS.maxJoins = 6`).
3. **Subquery Depth**: Tracks parentheses nesting immediately followed by `SELECT` (`LIMITS.maxDepth = 4`).
4. **Cartesian Product Detection**: Detects explicit `CROSS JOIN` or comma joins (`FROM tableA, tableB`) lacking a correlating `WHERE`, `ON`, or `USING` clause (`server/src/structured/sql.complexity.js:42-58`).
5. **Estimated Fan-out Rows**: Multiplies row counts of unkeyed joined tables, rejecting if estimated intermediate rows exceed `LIMITS.maxEstimatedRows` ($5 \times 10^9$).

---

## 4. Data-Level Security & CTE Shadowing

Data policies enforce fine-grained column-level redaction and row-level filtering per role (`server/src/security/data.policy.js:1-133`).

### Policy Kinds
1. `deny_column`: Denies query execution if the restricted column is referenced directly or via `SELECT *` (`assertColumnAccess`, `server/src/security/data.policy.js:69-93`).
2. `row_filter`: Restricts visibility to rows satisfying `<column> <op> <value>` (`applyRowFilters`, `server/src/security/data.policy.js:98-124`).

### Mechanics of CTE Shadowing
Rather than attempting complex AST `WHERE` clause injection, CogniCore shadows physical tables by prepending a Common Table Expression (CTE) with the exact same name as the base table. Because SQL scoping resolves CTE names before base tables, all user references and joins automatically resolve to the filtered view.

#### Concrete Rewriting Example
- **Base Table**: `patients` in SQLite database.
- **Policy**: `role: 'doctor'`, `column: 'department_id'`, `op: '='`, `value: 'dep_cardiology'`.
- **Original User Query**:
  ```sql
  SELECT name, diagnosis FROM patients WHERE admission_date > '2026-01-01'
  ```
- **Rewritten Executable SQL (`server/src/security/data.policy.js:117-124`)**:
  ```sql
  WITH "patients" AS (SELECT * FROM main."patients" WHERE "department_id" = 'dep_cardiology')
  SELECT name, diagnosis FROM patients WHERE admission_date > '2026-01-01'
  ```
For SQLite-backed datasets, `main."<table_name>"` is referenced inside the CTE body to break recursion (`server/src/security/data.policy.js:117`).

### MySQL Limitation (Hard Denial)
MySQL does not allow CTE definitions to reference base tables of the same name without qualification syntax conflicts. Rather than risking filter bypass or leaking data, CogniCore **fails closed**:

```javascript
// server/src/security/data.policy.js:108
if (datasetType === 'mysql') throw new PolicyError('Row-level restrictions are not supported on MySQL connections; access denied to protect restricted rows.');
```

---

## 5. Role-Based Access Control (RBAC)

RBAC is enforced deterministically by middleware before pipeline execution (`server/src/security/rbac.js:1-140`).

### Role Hierarchy & Capability Matrix
Verbatim capabilities from `server/src/security/rbac.js:55-62`:

| Role | Upload/Connect | Query | Chart | Export | Report | Python | Propose Action | Approve Action | Knowledge/Policy Manage | User Manage |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`admin`** | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) | Yes (`*`) |
| **`manager`** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** | **Yes** | No |
| **`analyst`** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No | No |
| **`user`** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | No | No |
| **`employee`**| No | Yes | Yes | Yes | No | No | No | No | No | No |
| **`viewer`** | No | Yes | Yes | No | No | No | No | No | No | No |

### Dataset Ownership vs Shared Access
- **Ownership**: `dataset.owner_id === user.user_id` grants full `manage` permission (`server/src/security/rbac.js:102`).
- **Administrative Override**: `user.role === 'admin'` grants unconditional `manage` permission on all datasets (`line 101`).
- **Sharing**: Additional access is managed via explicit grants in the `dataset_permissions` table (`read` or `manage`, line 103). Non-permitted users receive HTTP 403 (`line 132`).

---

## 6. PII Masking & Sensitive Data Exposure

PII masking scrubs personal information from API responses for low-privilege roles (`server/src/guardrails/pii.js:1-59`).

### Masked Roles
Configured via `PII_MASK_ROLES` environment variable, defaulting to:
```javascript
const MASK_ROLES = new Set((process.env.PII_MASK_ROLES || 'viewer,employee').split(','));
```

### Detection Regexes & Masking Rules
Verbatim from `server/src/guardrails/pii.js:10-16`:
1. **Email Addresses**:
   - Regex: `/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g`
   - Mask: Keeps first character and domain suffix: `j***@example.com`.
2. **Credit Card / National IDs (13–19 digits)**:
   - Regex: `/\b(?:\d[ -]?){13,19}\b/g`
   - Mask: `**** **** **** <last 4 digits>`.
3. **Social Security Numbers (SSN)**:
   - Regex: `/\b\d{3}-\d{2}-\d{4}\b/g`
   - Mask: `***-**-****`.
4. **12-digit Identification Numbers**:
   - Regex: `/\b\d{4}\s\d{4}\s\d{4}\b/g`
   - Mask: `**** **** <last 4 digits>`.
5. **Phone Numbers**:
   - Regex: `/(?<!\d)\+?\d[\d\s\-().]{8,16}\d(?!\d)/g`
   - Mask: Masks all but trailing 3 digits: `*******123`.

### Dual-Layer Application
1. **Evidence Redaction (`redactEvidence`, line 32)**: Columns tagged with `pii: true` in the semantic profile or matching regexes in sample rows have their field values masked.
2. **Answer Text Masking (`maskText`, line 20)**: For `viewer` and `employee` roles, the natural-language synthesized answer text is passed through `maskText()` before leaving the API (`server/src/core/core.engine.js:169`).

---

## 7. Upload & Network Ingestion Security

File upload and network ingestion are protected by multi-layered defensive gates.

### Upload Gates (`server/src/security/file.validator.js:12-81`)
1. **File Size Limit**: Configured by `MAX_FILE_SIZE_MB = 100` (`server/src/config/env.js:38`). Multer rejects larger payloads.
2. **Magic Bytes Content Verification**:
   - Executable signatures (`MZ` Windows, `\x7fELF` Linux, `#!` scripts, `\xcafe\xbabe` Java class files, `<?php`, `<script`) are unconditionally rejected (`lines 14-21, 48-51`).
   - `.pdf`: Enforces `%PDF-` signature in the first 1024 bytes (`line 54`).
   - `.db` / `.sqlite`: Enforces exact header string `'SQLite format 3\0'` in first 16 bytes (`line 58`).
   - Office formats (`.xlsx`, `.docx`, `.pptx`): Validates ZIP header (`0x04034b50`) and verifies interior directory signatures (`xl/`, `word/`, `ppt/`) (`lines 61-66`).
3. **Path Traversal Sanitization**: Filenames are sanitized via `sanitizeFilename` (`line 35`), stripping control characters, directory separators (`/`, `\`), and leading dots.

### SSRF Protection for API Ingestion (`server/src/ingestion/api.connector.js:24-52`)
1. **Protocol Restriction**: Only `http:` and `https:` URLs allowed (`line 43`). Embedded credentials (`http://user:pass@host`) rejected (`line 44`).
2. **DNS Resolution & Private IP Blacklist**: Hostnames are resolved via `dns.lookup({ all: true })`. Every resolved address must pass `isPrivateIp()`:
   - Loopback: `127.0.0.0/8`, `::1`.
   - Private RFC1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
   - Link-local & cloud metadata: `169.254.0.0/16` (AWS/GCP metadata endpoint `169.254.169.254`).
   - Carrier-grade NAT: `100.64.0.0/10`.
   - Multicast: `>= 224.0.0.0`.
   - IPv6 Unique Local (`fc00::/7`) and Link-Local (`fe80::/10`).
3. **Host Allowlist**: Optional strict host whitelisting via `API_CONNECTOR_ALLOWED_HOSTS` (`line 45`).

---

## 8. Agent Action Approval & Self-Approval Gate

To prevent autonomous agent actions from making unreviewed external mutations, action requests follow a strict proposal and approval workflow (`server/src/actions/action.executor.js:66-72`).

### Self-Approval Prevention Gate
Verbatim from `server/src/actions/action.executor.js:69-71`:

```javascript
// server/src/actions/action.executor.js:69-71
if (action.requested_by === decider.user_id && decider.role !== 'admin' && !selfApproval()) {
  throw Object.assign(new Error('Actions must be approved by someone other than the requester.'), { status: 403 });
}
```

- **Enforcement Rule**: A user proposing an action cannot approve it, even if they possess the `action.approve` capability (e.g., managers).
- **Exceptions**: Admins can approve their own actions. Non-admin self-approval is blocked unless explicitly enabled via environment variable `ACTION_ALLOW_SELF_APPROVAL === 'true'` (`line 64`).

---

## 9. Rate Limiting

Rate limiting is enforced at HTTP entry via `server/src/guardrails/rate.limit.js:7-22`.

- **Algorithm**: Sliding window bucket in JavaScript memory.
- **Window**: 60,000 ms (1 minute).
- **Capacity**: Default 30 requests per minute, overridden via `CHAT_RATE_LIMIT_PER_MIN` (`server/src/config/env.js:43`).
- **Key Strategy**: Keyed by authenticated `req.user.user_id`, falling back to `req.ip` for unauthenticated endpoints (`line 7`).
- **Store**: In-memory `Map`. Resets on process restart. Does not synchronize across multi-node clusters.
- **Violation Response**: Returns HTTP status 429 (`Too Many Requests`) with `Retry-After: <seconds>` response header (`lines 14-15`).

---

## 10. Threat Model Coverage Matrix

| Threat / Attack Vector | Mitigation Location | Defense Mechanism | Failure Mode |
| :--- | :--- | :--- | :--- |
| **Direct Prompt Injection** | `server/src/guardrails/input.guard.js:30` | 10 regex pattern rules scanning input text | Fail-closed: terminates request immediately with HTTP 200 `routeType: 'BLOCKED'`. |
| **Indirect Prompt Injection** | `server/src/guardrails/input.guard.js:48` & `server/src/response/answer.composer.js:38` | Data tagged in `<untrusted_data>` boundaries; instruction-like lines neutralized | Model may follow subtle instructions if boundary tags are ignored. |
| **SQL Injection (Mutating)** | `server/src/structured/sql.validator.js:20, 21` | AST whitelist: `SELECT` only; blocked mutation keyword blacklist; semicolon/comment block | Fail-closed: throws `SQLValidationError`; query aborted. |
| **SQL Data Theft (`SELECT *`)** | `server/src/security/data.policy.js:82` | `assertColumnAccess` checks AST and tokens; blocks `SELECT *` if table has denied columns | Fail-closed: throws `PolicyError` (HTTP 403). |
| **Unauthorized Row Access** | `server/src/security/data.policy.js:98` | CTE shadowing overwrites base table with row-filtered CTE view | Fail-closed: MySQL connections throw `PolicyError` (403) due to unsupported syntax. |
| **Query Complexity / DoS** | `server/src/structured/sql.complexity.js:26` | Caps length (4000), joins (6), depth (4), and fan-out intermediate rows ($5 \times 10^9$) | Fail-closed: throws `SQLValidationError`. |
| **LLM Numeric Hallucination** | `server/src/guardrails/answer.grounding.js:41` | Tokenizes numbers in response; verifies trace to evidence rows/aggregates | Fail-safe: replaces text with `buildDeterministicAnswer()` table summary. |
| **Unapproved Action Mutation** | `server/src/actions/action.executor.js:69` | Two-party human approval required; self-approval prohibited | Fail-closed: throws HTTP 403 if requester attempts approval. |
| **Server-Side Request Forgery**| `server/src/ingestion/api.connector.js:40` | DNS resolution; blocks loopback, RFC1918, link-local, and cloud metadata IPs | Fail-closed: throws error before issuing HTTP fetch. |
| **Malicious File Upload** | `server/src/security/file.validator.js:40` | Magic bytes check; blocks executables (`MZ`, `ELF`, scripts); checks internal ZIP structure | Fail-closed: rejects upload with HTTP 400; deletes uploaded file from disk. |
| **PII Data Leakage** | `server/src/guardrails/pii.js:32` | Regex scrubbing of email, phone, cards, SSN on API response for `viewer`/`employee` | Unrecognized PII formats outside regex set pass through unredacted. |
