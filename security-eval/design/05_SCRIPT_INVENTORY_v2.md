# Script Inventory & Execution Protocol v2

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d`

---

## 1. Modular Script Architecture

To adhere to the principle of single responsibility and prevent brittle, monolithic harnesses, the security evaluation suite is partitioned into focused, portable scripts written in standard Node.js (`node:test`, `node:assert/strict`) and POSIX shell.

```
security-eval/harness/
├── setup/
│   ├── 01_verify_checksums.js        # Validates SHA-256 of all fixtures & corpora
│   ├── 02_seed_canaries.js           # Injects canary tokens into isolated test DBs
│   ├── 03_provision_http.js          # Registers test users, roles, and datasets via API
│   └── 04_verify_heldout_freeze.js   # Verifies S1-C2 remains sealed & unread
├── oracles/
│   ├── logical_hash_oracle.js        # Computes sqlite3 .dump SHA-256 digests
│   ├── directory_snapshot_oracle.js  # File tree and hash scanner (excluding -wal/-shm)
│   ├── canary_scanner.js             # High-speed token scanner across all egress surfaces
│   └── oracle_selftest.js            # Pre-flight unit tests for all oracles
├── runners/
│   ├── run_s1_a_gates.js             # Standalone gate-level runner
│   ├── run_s1_b_p2sql.js             # HTTP-based P2SQL replication runner
│   ├── run_s1_d_tools.js             # Direct raw-SQL tool endpoint runner
│   ├── run_s2_a_rcr_tier1.js         # Deterministic policy rewriter runner
│   ├── run_s2_a_rcr_tier2.js         # End-to-end natural language RCR runner
│   └── run_s2_b_row_mutations.js     # Row-level AST mutation & purged clone runner
└── orchestrator.js                   # Master execution harness with checkpoint/resume
```

---

## 2. Script Specifications

### 2.1 Pre-Flight & Setup Scripts

#### `01_verify_checksums.js`
- **Purpose**: Verifies the integrity of all source fixtures, Spider SQLite databases, and payload corpora.
- **Inputs**: `security-eval/data/manifests/*.sha256`.
- **Outputs**: Exit code 0 on match; prints mismatched files and exits 1 on failure.

#### `02_seed_canaries.js`
- **Purpose**: Generates physical canary-seeded database clones in `data/canary/` without modifying `data/golden/`.
- **Behavior**: Reads table/column denial lists from RCR policy translations; appends `CANARY_<TABLE>_<COL>_<HEX>` tokens to string columns.

#### `03_provision_http.js`
- **Purpose**: Sets up authentication and dataset state via live HTTP endpoints.
- **Workflow**:
  1. `POST /api/auth/register` $\to$ Creates initial `admin` account (`auth.js:36`).
  2. `POST /api/auth/register` $\to$ Creates test accounts: `User_1`, `User_2`, `User_3`, `User_4`, `alpha_user`, `beta_user`.
  3. `POST /api/datasets` $\to$ Ingests the 16 Spider SQLite databases and test fixtures.
  4. Configures policy stores via internal API or direct database provisioning.

#### `04_verify_heldout_freeze.js`
- **Purpose**: Cryptographically verifies that `s1_c2_heldout.enc` has not been decrypted or accessed prior to post-fix evaluation.

---

### 2.2 Oracle Scripts

#### `logical_hash_oracle.js`
- **Signature**: `computeLogicalHash(sqliteDbPath) -> string (SHA-256)`
- **Implementation**: Runs `sqlite3 <db_path> .dump`, normalizes line endings, strips transient `sqlite_sequence` entries, and returns hex digest.

#### `directory_snapshot_oracle.js`
- **Signature**: `takeDirectorySnapshot(sandboxDirPath) -> Map<string, { size: number, hash: string }>`
- **Implementation**: Scans filesystem directory, ignores `-wal` and `-shm` temporary journal files, computes SHA-256 of all persistent files.

#### `canary_scanner.js`
- **Signature**: `scanEgressPayload(payload, canaryList) -> Array<{ surface: string, token: string }>`
- **Implementation**: Recursively inspects JSON response trees, strings, numbers, array rows, SQL strings, and error messages for registered canary tokens.

#### `oracle_selftest.js`
- **Purpose**: Self-tests the oracles against known synthetic mutations prior to running any evaluation suites.
  - Positive Test 1: Injects an uncommitted write into a dummy database; verifies `logical_hash_oracle` reports a mismatch.
  - Positive Test 2: Creates an auxiliary file in the sandbox; verifies `directory_snapshot_oracle` flags unexpected file creation.
  - Positive Test 3: Embeds a canary in a nested JSON response; verifies `canary_scanner` returns the exact surface and token.

---

### 2.3 Evaluation Runners & Master Orchestrator

#### `orchestrator.js` (Checkpoint / Resume Support)
- **Problem**: Full natural-language evaluation runs can take hours on CPU inference and may be interrupted by OS timeouts or crashes.
- **Behavior**:
  - Maintains `security-eval/results/checkpoint.json`.
  - Records each completed execution: `{ testId, attemptIndex, status, timestamp, metrics }`.
  - On restart, scans `checkpoint.json` and automatically resumes from the first unexecuted or incomplete test item.
  - Emits JSON Lines (`eval_results.jsonl`) for continuous real-time progress streaming.

---

## 3. Runtime Budget & Execution Formulas

### 3.1 Timing Dry Run Protocol (20 Requests)
Because inference time varies significantly across local CPUs, the evaluation pipeline begins with a mandatory **20-Request Calibration Dry Run**:
1. Run 10 benign questions and 10 adversarial questions against `POST /api/chat`.
2. Compute empirical mean latency per request:
   $$\bar{T}_{\text{req}} = \frac{1}{20} \sum_{i=1}^{20} t_i$$
3. Compute total runtime budget using the formulas below.

### 3.2 Runtime Budget Formulas

$$\text{Total Duration (Hours)} = \frac{N_{\text{gate}} \cdot \bar{T}_{\text{gate}} + N_{\text{tool}} \cdot \bar{T}_{\text{tool}} + \sum_{m} (N_{m} \cdot k_{m} \cdot (\bar{T}_{\text{req}} + T_{\text{pause}}))}{3600}$$

Where:
- $\bar{T}_{\text{gate}} \approx 0.05 \text{ s}$ (Standalone AST / gate execution)
- $\bar{T}_{\text{tool}} \approx 0.10 \text{ s}$ (HTTP raw SQL execution)
- $\bar{T}_{\text{req}}$: Measured seconds per natural-language chat request (Ollama `gemma3:4b` CPU inference)
- $T_{\text{pause}} = 2.0 \text{ s}$ (Thermal cooldown pause)

### 3.3 Evaluation Matrix Budget Table (with Placeholders)

Assuming an empirical benchmark of $\bar{T}_{\text{req}} \approx 12.0 \text{ s}$ on the Ryzen 5 5500U:

| Component | Target Queries ($N$) | Repetitions ($k$) | Total Calls | Unit Latency | Projected Duration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Calibration Dry Run** | 20 | 1 | 20 | 12.0 s | 4.0 min |
| **S1-A Gates** | 250 | 1 | 250 | 0.05 s | 12.5 s |
| **S1-B Primary (RQ1)** | 9 | 5 | 45 | 14.0 s (with pause) | 10.5 min |
| **S1-B Variants** | 2 | 5 | 10 | 14.0 s | 2.3 min |
| **S1-C1 Held-Out (NL)**| 50 | 3 | 150 | 14.0 s | 35.0 min |
| **S1-D Direct Tools** | 250 | 1 | 250 | 0.10 s | 25.0 s |
| **S2-A Tier 1 (Enforce)**| 3,200 | 1 | 3,200 | 0.02 s | 1.1 min |
| **S2-A Tier 1 HTTP Parity**| 50 | 1 | 50 | 0.15 s | 7.5 s |
| **S2-A Tier 2 (NL)** | 200 | 1 | 200 | 14.0 s | 46.7 min |
| **S2-B Row Mutations** | 96 | 1 | 96 | 0.05 s | 4.8 s |
| **S2-C Utility Benchmark**| 1,600 | 1 | 1,600 | 0.02 s | 32.0 s |
| **S2-C Scaling Benchmark**| 50 | 1 | 50 | 0.05 s | 2.5 s |
| **Total Projected Budget**| - | - | **7,871 calls** | - | **~1 hour 41 minutes** |

EOF
