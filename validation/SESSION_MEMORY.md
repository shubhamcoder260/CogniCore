# CogniCore — Comprehensive Session Memory & Trajectory Log

**Generated**: 2026-10-15  
**Workspace**: `C:\cognicore`  
**Validation Workspace**: `C:\cognicore\validation_workspace`  
**Original Repository**: `C:\cognicore\CogniCore`  

---

## 1. Executive Summary & Trajectory

This session progressed through four major phases:
1. **Codebase Architecture & Validation Audit**: Deep inspection of CogniCore's zero-trust NL-to-SQL architecture, identifying critical validation flaws (circular corpora, thin planted flaws, lack of adaptive attacks, absence of oracles).
2. **Skill Architecture Setup**: Established three specialized autonomous engineering skills and persistent workspace rules (`production-architect`, `evaluation-gatekeeper`, `security-shield`) loaded via `.agent/skills/`, `.agent/rules/`, and `GEMINI.md`.
3. **Research Validation Plan Formulation**: Defined statistical protocols (Wilson score, exact McNemar, Mulberry32 cluster bootstrap, Holm correction, Rule of Three) and multi-layer validation hypotheses (V0 through V11).
4. **Step 1 Validation Harness Construction**: Built the complete, deterministic, zero-dependency validation harness scaffolding in an isolated workspace copy (`validation_workspace`), leaving the original repository pristine.

---

## 2. Invariant Engineering Rules Active

Configured in `GEMINI.md` and active at all times:
- **Production Architect**: Zero hardcoded secrets, dynamic filesystem paths only, environment isolation (`NODE_ENV`), multi-stage containerization.
- **Evaluation Gatekeeper**: Mandatory unit test generation (`node:test`, `node:assert/strict`), minimal golden dataset mocks, error boundaries around all external calls/queries, 100% test pass rates required.
- **Security Shield**: Strict input shape validation, global error masking (zero raw stack traces/SQL leaks), prompt injection fencing (`<untrusted_data>`), PII egress scrubbing.

---

## 3. Original Repository Baseline State

- **Path**: `C:\cognicore\CogniCore`
- **Head Commit**: `6f2dd4c004e555b83587c3e0c195f7882432ad9b`
- **Working Tree Status**:
  ```text
  ?? .agent/
  ?? GEMINI.md
  ?? docs/CODEBASE_DOSSIER.md
  ?? docs/dossier/
  ```
- **Rule Enforced**: The original repository was inspected, snapshotted in `validation/ORIGINAL_STATE.txt`, and never touched or modified during the harness setup.

---

## 4. Validation Harness Implementation (Step 1)

Located in `C:\cognicore\validation_workspace\validation\`:

### A. Preregistration Protocol (`PREREGISTRATION.md`)
- **Git Commit**: `20a21643d7fc31a3811abc6927b17296b9c8df0e`
- **Git Tag**: `prereg-v1`
- **Verification**: `git diff prereg-v1 -- validation/PREREGISTRATION.md` yields an empty diff.
- **Key Protocols**:
  - Wilson 95% Score Confidence Intervals for all rates.
  - Two-Sided Exact McNemar Test on discordant pairs for paired evaluations.
  - Exact upper bound $1 - 0.05^{1/n}$ and Rule of Three ($3/n$) for zero-event claims.
  - Mulberry32 PRNG-driven Cluster Bootstrap over databases ($B = 10,000$).
  - Holm-Bonferroni step-down correction for multiple comparisons.
  - Adversarial attack sets and RBAC matrices marked `PENDING EXTERNAL AUTHOR` for strict independence.
  - V0–V11 hypotheses defined (V8 intent routing pass criterion set to `TBD-BEFORE-RUN`).

### B. Statistical Library (`lib/stats.js`)
- Zero external dependencies (pure JavaScript Node built-in).
- Exports: `wilson(k, n, alpha)`, `exactUpperZeroEvents(n, alpha)`, `ruleOfThree(n)`, `mcnemarExact(b, c)`, `mulberry32(seed)`, `clusterBootstrap(...)`, `holm(pValues, alpha)`, `cohensKappa(rater1, rater2)`.
- Verified with analytical tests in `tests/stats.test.js` (tolerance $\le 10^{-4}$).

### C. Append-Only JSONL Logger (`lib/jsonl.js`)
- Enforces strict append-only file operations (`fs.openSync(..., 'a')` and `fs.fsyncSync`).
- Path-traversal sandboxing restricting file writes strictly within `validation/raw/`.
- Verifies SHA-256 byte immutability across reopenings.
- Extracts completed question/trial keys for deterministic resumption.
- Verified in `tests/jsonl.test.js`.

### D. Central Configuration (`lib/config.js`)
- Deterministic Master Seed: `20261015`.
- Primary temperature: $0.0$; secondary temperature: $0.2$.
- Model sweep roster: `qwen2.5:7b`, `qwen2.5-coder:7b`, `llama3.1:8b`, `gemma3:4b`.
- Dynamic path resolution matching the CommonJS module system.

### E. Environment & Hardware Prober (`manifest.js` & `MANIFEST.json`)
- Probes local runtime truthfully without guessing (records `null` + concrete reason if unavailable):
  - **Git Commits**: Copy HEAD (`8059dde`), Original HEAD (`6f2dd4c`), Prereg Commit (`20a2164`).
  - **Runtime**: Node `v24.13.1`, NPM `11.8.0`.
  - **Host OS**: Windows 11 (`win32 x64 release 10.0.26300`).
  - **CPU**: 13th Gen Intel Core i5-13420H (12 cores, 2611 MHz).
  - **RAM**: 16.87 GB (16,869,351,424 bytes).
  - **GPU**: NVIDIA GeForce RTX 2050 (Driver `560.94`, 4096 MB VRAM).
  - **Ollama**: Version `0.40.3`.
    - Locally installed models: `qwen2.5vl:3b`, `qwen2.5-coder:7b`, `qwen2.5:14b`.
    - Target model `qwen2.5-coder:7b` digest: `dae161e27b0e90dd1856c8bb3209201fd6736d8eb66298e75ed87571486f4364`.
    - Target models `qwen2.5:7b`, `llama3.1:8b`, `gemma3:4b`: recorded as `installed: false, digest: null, reason: "not installed"`.
  - **Checksums**: SHA-256 calculated for all 15 SQLite `.db` fixtures, all 5 sample `.csv` files, and `server/package-lock.json`.
  - **Source Citations**: Exact `file:line` references for hardcoded `temperature` and `maxTokens` in `server/src/`.

### F. Registry Skeletons & Documentation
- `DECISIONS.md`: Records SQLite-only dialect scope, strict column denial definition, independent dataset authorship, and implementation defaults.
- `LIMITATIONS.md`: Structured headings (`# Failed`, `# Skipped / NOT RUN`, `# Could not verify`).
- `CODE_DELTAS.md`: Designated for proposed source code changes (currently empty for Step 1).
- `README.md`: Step-by-step commands for reproducing the workspace, running unit tests, regenerating manifest, and verifying preregistration.

---

## 5. Verification Status

| Check | Expected Result | Actual Result | Status |
|---|---|---|---|
| Unit Test Suite (`node --test validation/tests`) | 9 tests passed, 0 failed | 9 passed, 0 failed (75.6ms) | **PASSED** |
| Preregistration Tag Diff | Zero diff against `prereg-v1` | 0 modifications | **PASSED** |
| Original Repo Status & HEAD | Untouched from initial state | Exactly identical | **PASSED** |
| Manifest JSON Integrity | Valid JSON with zero fabrications | Parse verified, exact hashes | **PASSED** |
| Step 1 Operational Boundaries | No LLM calls, no dataset downloads | Fully observed | **PASSED** |

---

## 6. Next Actions (When Resuming)
1. **Author External Datasets**: Compile independent adversarial attack sets and RBAC expected-outcome matrices (`PENDING EXTERNAL AUTHOR`).
2. **Implement Experiment Runners**: Write execution scripts under `validation/experiments/` (starting with `v0_baseline.js` and `v1_accuracy.js`).
3. **Execute Evaluations**: Run experiments against local Ollama models and record raw outputs to `validation/raw/*.jsonl`.
