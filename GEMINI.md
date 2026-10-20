# CogniCore — Always-On Engineering Rules & Production Invariants

These rules are unconditionally active across all tasks, conversations, and code modifications in this workspace. Every tool call and response must conform to these constraints.

---

## 1. Production Architect Invariants (Zero Hardcoding & Isolation)
* **Zero Hardcoded Secrets**: NEVER hardcode API keys, passwords, bearer tokens, or database connection strings. All credentials must resolve via `process.env` or Secret Manager.
* **Dynamic Filesystem Paths Only**: NEVER hardcode drive letters (`C:\`, `D:\`) or absolute Unix root directories (`/tmp`, `/var`). All paths must resolve dynamically via `process.env.DATA_DIR`, `config.paths.*`, or `os.tmpdir()`.
* **Environment Isolation**: Runtime behavior must strictly respect `process.env.NODE_ENV` (`development`, `test`, `production`). In production mode, weak defaults (e.g. `'CHANGE_ME'`) must throw fatal configuration exceptions on startup.
* **Multi-Stage Containerization**: Container images must use multi-stage builds (builder vs unprivileged runner), running as a non-root user with healthchecks and trimmed dependencies.
* **Completion Refusal**: You must REFUSE to mark any task as complete if hardcoded paths, raw connection URIs, or secrets remain in source files.

---

## 2. Evaluation Gatekeeper Invariants (Mandatory Tests & Error Boundaries)
* **Error Boundaries**: Every API route, pipeline handler, external integration, and database query must be encapsulated in structured error boundaries (try-catch, async wrappers, or domain-specific typed errors). Unhandled rejections are strictly prohibited.
* **Mandatory Test Generation**: Every newly created or modified feature, route, or engine module MUST have an accompanying `.test.js` file under `tests/unit/` or `tests/integration/` utilizing Node's native test runner (`node:test`, `node:assert/strict`).
* **Golden Dataset Mocks**: Any component interacting with data, documents, or models must include a minimal, deterministic golden dataset mock (with verifiable ground truth) to prevent regression.
* **Zero Broken Tests**: The automated test suite must achieve 100% pass rates for any feature branch or pull request to be considered done.

---

## 3. Security Shield Invariants (Input Validation & Information Disclosure)
* **Strict Input Shape Validation**: Validate all incoming HTTP request bodies, queries, parameters, and file metadata before domain execution. Check types, allowable keys, and enforce string length limits (max 4,000 chars on queries).
* **Global Error Masking**: Raw database exceptions, stack traces, internal table names, SQL snippets, and system file paths must NEVER be leaked to HTTP clients. Mask all internal errors into clean, standardized 400/403/404/500 HTTP responses.
* **Prompt Injection & Fencing**: Screen incoming prompts for injection attempts (`input.guard.js`). All external and RAG-retrieved document text must be sanitized via `neutralizeInjection()` and bounded inside `<untrusted_data>` fences.
* **PII Egress Scrubbing**: Ensure personal identifiable information (emails, phone numbers, credit card patterns) is masked for low-privilege roles before leaving API responses.
