# Data Acquisition & Environment Plan v2

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d`  
**P2SQL External Repository Commit:** `ff5a0226b6c63407ae19ba5567ae251b51d4f98e`  
**RCR External Repository Commit:** `9179b2ec6d84df56803cbbeb2650cd86b7c1b56f`

---

## 1. Hardware & Execution Environment Constraints

### 1.1 Local Reference Hardware
- **Host System**: Fedora Linux (x86_64).
- **Processor**: AMD Ryzen 5 5500U (6 cores / 12 threads, up to 4.0 GHz, no dedicated GPU).
- **Memory**: ~10 GB usable RAM.
- **Inference Server**: Local Ollama server (`http://localhost:11434`).
- **Primary LLM**: `gemma3:4b` (quantized 4-bit, ~3.3 GB memory footprint).
- **Secondary Evaluation Models (Optional / Stronger Hardware)**:
  - `qwen2.5:14b` (Requires $\ge 16$ GB RAM / discrete GPU; tested only if external hardware is provisioned).
  - `qwen2.5:7b` (Intermediate fallback).

### 1.2 Portability & Tooling Invariants
In accordance with production rules and cross-platform portability:
- **No Distro-Specific Dependencies**: All automation, harnesses, and evaluators must be written in **standard Node.js (v20+ native test runner / scripts)** and **POSIX-compliant shell (`/bin/sh`)**.
- **No Background Services**: No unmanaged daemons or external database servers (PostgreSQL / MySQL) are required for baseline evaluation.
- **Dialect Focus**: Evaluation strictly targets **SQLite 3** (`better-sqlite3`). Postgres and MySQL tests are formally de-scoped from primary automated gates unless an external container is explicitly activated.

---

## 2. External Dataset Acquisition Protocol

### 2.1 P2SQL Assets (ICSE 2025)
- **Local Path**: `~/scratch/P2SQL` (@ `ff5a0226b6c63407ae19ba5567ae251b51d4f98e`).
- **Extracted Assets**:
  - Attack prompt templates: `RQ1/prompts/{U1,U2,U3,RD1,RD1_failed_attempt,RD2,RD2_failed_attempt,RI1,RI2}.md`.
  - Schema fixture: `RQ1/code/job_postings.sql`.
  - Scaled red-team corpus: `RQ3/red-team/prompts.csv` (17,099 prompts).
- **Acquisition Action**: Read directly from the existing local clone. No network download required.

### 2.2 RCR Policy & Label Assets (Findings of EACL 2026)
- **Local Path**: `~/scratch/RCR` (@ `9179b2ec6d84df56803cbbeb2650cd86b7c1b56f`).
- **Extracted Assets**:
  - `data/spider/spider-access-control.zip` (Contains `spider-access-control.jsonl`, 19,624 query instances with gold `PERMIT`/`DENY` labels across `User_1`..`User_4`).
  - `scripts/spider/users_permissions.py` (Deterministic role generator).
- **Critical Finding**: As verified in `09_EXTERNAL_REPOS_INSPECTION.md`, the RCR repository **does NOT contain SQLite database files** (`.sqlite` files). The repo contains only permissions, question JSONL, and a Postgres Docker setup.

### 2.3 Yale Spider SQLite Databases Acquisition
To provide the underlying SQLite databases for RCR:
- **Official Source**: Yale LILY Lab Spider Dataset (`https://yale-lily.github.io/spider`).
- **Distribution Archive**: `spider.zip` (~98 MB).
- **Extraction Target**: Extract only the `spider/database/` directory (containing 166 SQLite database folders).
- **Integrity Verification**: Compute and record SHA-256 hashes of all acquired `.sqlite` databases before any test execution.

---

## 3. Database Stratification & Canary Partitioning

### 3.1 Stratified Spider Database Sampling (16 Databases)
To balance domain diversity and structural complexity, 16 databases are sampled across three complexity tiers:

| Tier | Table Count | Selected Databases | Domain / Schema Characteristics |
| :--- | :--- | :--- | :--- |
| **Small** | 1 - 3 tables | `department_store`, `pets_1`, `voter_1`, `car_1` | Simple schemas, single primary-foreign key relationships. |
| **Medium** | 4 - 8 tables | `flight_2`, `academic`, `world_1`, `cre_Doc_Control_Systems`, `network_1`, `orchestra`, `poker_player`, `singer` | Normalized business logic, composite keys, junction tables. |
| **Large** | 9+ tables | `store_1`, `baseball_1`, `college_2`, `soccer_1` | Complex schemas, deep join hierarchies, dense foreign key graphs. |

### 3.2 Dual Database Partitioning (Leak vs. Utility)
To ensure that canary injection does not pollute natural-language accuracy or benchmark results, tests operate on two strictly isolated physical database directories:
1. **Directory A: Clean Golden Databases (`data/golden/`)**:
   - Contains pristine copies of the 16 Spider SQLite databases.
   - Used exclusively for **Utility & Execution Accuracy** benchmarking (`S2-C`) and benign control tests.
2. **Directory B: Canary-Seeded Databases (`data/canary/`)**:
   - Contains modified copies of the 16 databases.
   - For every table with denied columns under `User_2`, `User_3`, or `User_4`, canary tokens (`CANARY_<TABLE>_<COL>_<HEX>`) are appended or injected into string columns.
   - Used exclusively for **Leak Detection & Egress Probing** (`S2-A`, `S2-B`).

---

## 4. LLM & Ollama Configuration

### 4.1 Modelfile & Context Window Specification
Local testing uses `gemma3:4b` running under Ollama. To prevent silent prompt truncation during multi-step analyses, a dedicated custom model definition is registered:
```dockerfile
# security-eval/models/Modelfile.gemma3-eval
FROM gemma3:4b
PARAMETER num_ctx 8192
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|end_of_turn|>"
```
Registration Command (to be executed in later test session):
```bash
ollama create gemma3:4b-eval -f security-eval/models/Modelfile.gemma3-eval
```

### 4.2 Pipeline Temperature & Parameter Inventory
CogniCore's LLM parameters across codebase stages (Commit `9cde26c`):
- **Intent Classifier**: `intent.engine.js:31` $\to$ Configurable via `config.ollama.model`, temperature defaults to `0.1`.
- **Planner**: `planner.js:33` $\to$ Configurable model, hardcoded `temperature: 0.1`.
- **SQL Generator**: `structured.engine.js:35` $\to$ Configurable model, hardcoded `temperature: 0.1`.
- **Repair Engine**: `sql.repair.js:34` $\to$ Configurable model, hardcoded `temperature: 0.1`.
- **Answer Composer**: `answer.composer.js:28` $\to$ Configurable model, hardcoded `temperature: 0.2`.
- **Analysis Engine**: `analysis.engine.js:46` $\to$ Configurable model, hardcoded `temperature: 0.2`.

*Evaluation Note*: Temperature is hardcoded in most stage engines. Because temperature is non-zero ($0.1 - 0.2$), $k = 5$ repetitions per prompt are mandatory in S1-B and Tier 2 S2-A to capture distribution variance.

---

## 5. Artifact Directory & Verification Checksums

All test datasets, seeds, and templates must reside in a dedicated test fixture directory:
```
security-eval/
├── data/
│   ├── golden/               # Clean Spider SQLite databases
│   ├── canary/               # Canary-seeded Spider SQLite databases
│   ├── fixtures/
│   │   ├── job_postings.sqlite
│   │   └── tenant_projects.sqlite
│   └── manifests/
│       ├── spider_hashes.sha256
│       └── fixture_hashes.sha256
├── corpora/
│   ├── s1_a_gates.json
│   ├── s1_b_prompts.json
│   ├── s1_c1_heldout.json
│   ├── s1_c2_heldout.enc     # Encrypted / sealed post-fix set
│   └── s1_benign_sqlite.json
```

Prior to any test execution, a checksum verification script must validate that all `.sqlite` and `.json` files match their recorded SHA-256 digests.
EOF
