# Shared Test Harness Design v3

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d` ([F-001](11_FACTS_REGISTRY.md#f-001))  
**Facts Registry Reference:** Cites [F-001](11_FACTS_REGISTRY.md#f-001) through [F-047](11_FACTS_REGISTRY.md#f-047)

---

## 1. Unified Directory Layout

To eliminate redundant directory structures, the evaluation framework adopts a single canonical directory hierarchy:

```
security-eval/
├── data/
│   ├── golden/                      # Pristine Spider SQLite databases (Clean)
│   ├── canary/                      # Canary-seeded Spider SQLite databases (Leak Probes)
│   ├── fixtures/
│   │   ├── job_postings.sqlite      # P2SQL adapted SQLite database
│   │   ├── multi_tenant_bank.sqlite # S2-B Bank multi-tenant fixture
│   │   └── child_projects.sqlite    # S2-B Child-table isolation fixture
│   └── manifests/
│       ├── spider_manifest.json     # Expected SHA-256 digests (Placeholder)
│       └── fixture_manifest.json    # Fixture SHA-256 digests (Placeholder)
├── corpora/
│   ├── s1_a_gates.json              # 250 gate-level payloads with per-item schemas
│   ├── s1_b_prompts.json            # P2SQL RQ1 attack prompt templates
│   ├── s1_c1_heldout.json           # 100 baseline held-out payloads
│   ├── s1_c2_heldout.enc            # 100 post-fix held-out payloads (Sealed)
│   ├── s1_benign_sqlite.json        # 100 dialect-calibrated benign queries
│   └── s2_gold_queries.json         # RCR 800 sampled Spider gold SQL
├── sandboxes/
│   ├── hardened_worker/             # Production isolated throwaway sandbox
│   └── naive_driver/                # Ablation read-write throwaway sandbox
├── harness/
│   ├── setup/                       # Pre-flight provisioning & verification
│   ├── oracles/                     # Dual execution & egress detection oracles
│   └── runners/                     # Suite-specific execution orchestrators
└── results/
    ├── checkpoint.json              # Real-time execution resume state
    └── eval_results.jsonl           # Streamed evidence output ledger
```

---

## 2. Dual Sandbox Architecture & Ablation Matrix

To isolate software gate performance from underlying driver behavior, every accepted payload is evaluated across two isolated execution sandboxes:

```
                            [Query / Payload]
                                    |
              +---------------------+---------------------+
              |                                           |
              v                                           v
    [Hardened Worker Sandbox]                    [Naive Driver Sandbox]
  - Location: sandboxes/hardened_worker/       - Location: sandboxes/naive_driver/
  - Connection: readonly: true                 - Connection: readonly: false
  - Flags: PRAGMA query_only = ON              - Flags: PRAGMA query_only = OFF
  - Execution: sqlite.worker.js                - Execution: direct db.exec(sql)
  - Timeouts: 15,000 ms worker.terminate()     - Extensions: db.loadExtension allowed
              |                                           |
              v                                           v
    [Hardened Hash Oracle]                       [Naive Hash Oracle]
```

### Ablation Matrix Configuration

| Ablation Configuration | Input Guard | AST Validator | Policy Rewriter | SQLite Connection Mode | Evaluated Security Guarantee |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Config A: Production Baseline** | Enabled | Enabled | Enabled | `readonly: true`, `query_only=ON` | Full defense-in-depth security posture. |
| **Config B: No-Guard Bypass** | Disabled | Enabled | Enabled | `readonly: true`, `query_only=ON` | Evaluates validator resilience without guard. |
| **Config C: No-Validator Bypass** | Enabled | Disabled | Enabled | `readonly: true`, `query_only=ON` | Evaluates policy and driver resilience. |
| **Config D: No-Gates Driver Base**| Disabled | Disabled | Disabled | `readonly: false` (Naive R/W) | Proves attack exploitability if unmitigated. |

---

## 3. Independent Oracle Protocol

### 3.1 Logical Hash & SQLite State Oracle
- **Database Dump**: `sqlite3 <db_path> .dump | grep -v -E "sqlite_sequence" | sha256sum`.
- **Integrity Pragmas**: Evaluates `PRAGMA schema_version;` and `PRAGMA user_version;` before and after execution to detect metadata mutations.
- **Temporary Object Check**: Queries `SELECT count(*) FROM sqlite_temp_master;` to detect uncommitted temp tables or views.

### 3.2 Directory Snapshot Oracle (Filesystem Side-Effects)
- **Snapshot Scanner**: Reads file names and sizes in the throwaway sandbox:
  `find <sandbox_dir> -type f ! -name "*-wal" ! -name "*-shm" -exec sha256sum {} +`
- **Timestamp Immunity**: Filesystem timestamps (`mtime`, `atime`) are omitted to prevent false positive side-effect detections caused by file reads.
- **Side-Effect Capture**: Catches `ATTACH DATABASE`, `VACUUM INTO`, auxiliary file creation, or disk corruption.

### 3.3 Positive Control Probes (Oracle Self-Test)
Prior to running evaluation suites, the oracles must pass three positive validation checks:
1. **Control 1 (Uncommitted State Mutation)**: Issue `UPDATE users SET name = 'Mutated' WHERE user_id = 1` in naive sandbox; verify logical hash oracle fails with mismatch.
2. **Control 2 (Auxiliary File Creation)**: Issue `ATTACH DATABASE 'sandbox/injected.db' AS inj; CREATE TABLE inj.t (x);` in naive sandbox; verify directory snapshot oracle detects unexpected file creation.
3. **Control 3 (Canary Egress Detection)**: Seed `CANARY_COL_PASSWORD_X1Y2` in test payload; verify canary scanner identifies exact egress surface.

---

## 4. First-Stop Attribution Taxonomy

When a test payload is blocked, the harness attributes the interception to exactly one layer in the defense chain:

```
+---------------------------------------------------------------------------------------------------------+
| Attribution Code       | Intercepting Module                 | Identification Criteria                  |
+---------------------------------------------------------------------------------------------------------+
| INPUT_GUARD_BLOCKED    | server/src/security/input.guard.js  | Throws GuardError (prompt injection)    |
| PARSER_BLOCKED         | node-sql-parser in validator        | Throws SQLValidationError: failed parse  |
| VALIDATOR_BLOCKED      | server/src/structured/sql.validator | Throws SQLValidationError (AST rule)     |
| POLICY_BLOCKED         | server/src/security/data.policy.js  | Throws PolicyError (column or catalog)   |
| DRIVER_BLOCKED         | server/src/structured/sqlite.worker | SQLite driver throws SQLITE_READONLY     |
| TIMEOUT_ABORTED        | server/src/structured/sql.executor  | Worker terminated after 15,000 ms        |
| EGRESS_BLOCKED         | server/src/security/egress.guard.js | Sanitized / stripped from evidence rows  |
| EXECUTED               | Passed all gates                    | Result returned without exception        |
+---------------------------------------------------------------------------------------------------------+
```

---

## 5. Findings Register Template

Findings discovered during subsequent test execution must be logged in the following standardized schema:

```markdown
### Finding [ID]: [Short Title]
- **Severity**: Critical | High | Medium | Low
- **Category**: SQLi Bypass | Access Control Leak | Denial of Service | Information Disclosure
- **Target Suite**: S1-A | S1-B | S1-D | S2-A | S2-B
- **Payload / Query**: `[Exact SQL or Prompt string]`
- **First-Stop Attribution**: `[Attribution Code]`
- **Ablation Mode**: Config A | Config B | Config C | Config D
- **Expected Outcome**: BLOCKED | ALLOWED-EXACT
- **Observed Outcome**: LEAK | OVER-FILTERED | WRONG
- **Oracle Evidence**:
  - Logical Hash Pre: `[sha256]`
  - Logical Hash Post: `[sha256]`
  - Canary Tokens Detected: `[Token List on Egress Surface]`
```

---

## 6. Runtime Environment & Configuration Invariants

### 6.1 PII Masking Override (`PII_MASK_ROLES="none"`)
- In `server/src/guardrails/pii.js:8` ([F-033](11_FACTS_REGISTRY.md#f-033)), roles subjected to masking are initialized via:
  ```javascript
  const MASK_ROLES = new Set((process.env.PII_MASK_ROLES || 'viewer,employee').split(',').map((s) => s.trim()).filter(Boolean));
  ```
- Because empty strings `""` evaluate falsy in JavaScript, setting `PII_MASK_ROLES=""` triggers the logical OR fallback and defaults back to `'viewer,employee'`.
- The evaluation server must be launched with the non-empty string `PII_MASK_ROLES="none"`. Because `"none"` is not one of the six valid roles (`['admin', 'manager', 'analyst', 'employee', 'viewer', 'user']`, [F-007](11_FACTS_REGISTRY.md#f-007)), `shouldMask(role)` returns false for all benchmark users, preventing accidental corruption of result sets and canary tokens.

### 6.2 Model Environment Variable Mapping
The test runner explicitly defines task routing variables to prevent falling back to the codebase comparison default `qwen2.5:14b` ([F-035](11_FACTS_REGISTRY.md#f-035)):
```bash
export OLLAMA_MODEL="gemma3:4b"
export OLLAMA_MODEL_SQL="gemma3:4b"
export OLLAMA_MODEL_REASONING="gemma3:4b"
export OLLAMA_MODEL_REWRITE="gemma3:4b"
export OLLAMA_MODEL_PLANNER="gemma3:4b"
```

### 6.3 Git Worktree Commit Isolation
To test historical baseline commit `903c3c1` ([F-045](11_FACTS_REGISTRY.md#f-045)) without disturbing active workspace design files, evaluation scripts instantiate an external git worktree:
```bash
git worktree add ../cognicore-baseline-903c3c1 903c3c18e4a9f7521c4bbff26eece86fe7244b9f
```
All baseline ablation and gate executions run against `../cognicore-baseline-903c3c1/`, and the directory is cleanly pruned after evaluation.
