# Script Inventory & Execution Protocol v3

**CogniCore Baseline Commit:** `9cde26cc712cd805d48c2ede925393742ec1b68d` ([F-001](11_FACTS_REGISTRY.md#f-001))  
**Facts Registry Reference:** Cites [F-001](11_FACTS_REGISTRY.md#f-001) through [F-050](11_FACTS_REGISTRY.md#f-050)

---

## 1. Modular Harness Architecture

The security evaluation harness is implemented as focused Node.js (v20+ native test runner `node:test`) and POSIX shell scripts:

```
security-eval/harness/
├── setup/
│   ├── 01_verify_checksums.js        # Validates SHA-256 of all fixtures & corpora
│   ├── 02_seed_canaries.js           # Injects canaries into isolated canary clones
│   ├── 03_provision_http.js          # Registers admin, test users, and shares datasets
│   └── 04_verify_heldout_freeze.js   # Cryptographically verifies S1-C2 remains sealed
├── oracles/
│   ├── logical_hash_oracle.js        # Computes sqlite3 .dump SHA-256 & pragma versions
│   ├── directory_snapshot_oracle.js  # Scans sandbox files without timestamp bias
│   ├── canary_scanner.js             # High-speed string & numeric canary token scanner
│   ├── purged_clone_oracle.js        # Canonical row-sorting multiset comparison oracle
│   └── oracle_selftest.js            # Pre-flight unit tests for all 4 oracles
├── runners/
│   ├── run_s1_a_gates.js             # Standalone gate runner (validateSql)
│   ├── run_s1_b_p2sql.js             # HTTP chat runner for P2SQL RQ1 & RQ3 prompts
│   ├── run_s1_c_heldout.js           # S1-C1 and S1-C2 held-out runner
│   ├── run_s1_d_tools.js             # HTTP direct raw-SQL tool runner (/api/tools/*)
│   ├── run_s2_a_rcr_tier1.js         # Standalone policy rewriter runner (enforcePolicy)
│   ├── run_s2_a_rcr_tier2.js         # HTTP chat runner for RCR natural language
│   ├── run_s2_b_row_mutations.js     # Standalone mutation runner vs purged clone
│   └── run_s2_c_utility.js           # Offline execution accuracy analyzer
└── orchestrator.js                   # Master harness orchestrator with checkpoint/resume
```

---

## 2. Reconciled Test Execution Budget & Arithmetic

### 2.1 Complete Execution Accounting Table

| Suite Component | Target Item Count ($N$) | Expansions / Multipliers | Reps ($k$) | Live HTTP Invocations | In-Process Standalone Calls | Offline Evaluations |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pre-Flight Calibration** | 20 prompts | 1 user | 1 | 20 | 0 | 0 |
| **S1-A Gate Component** | 250 payloads | 1 dialect | 1 | 0 | 250 | 0 |
| **S1-B Primary (RQ1)** | 45 prompts | 1 user | 3 | 135 | 0 | 0 |
| **S1-B Scale-Up (RQ3)** | 50 prompts | 1 user | 3 | 150 | 0 | 0 |
| **S1-C1 Baseline Held-Out** | 100 payloads | 1 user | 1 | 100 | 0 | 0 |
| **S1-C2 Post-Fix Held-Out** | 100 payloads | 1 user | 1 | 100 | 0 | 0 |
| **S1-D Direct Tool Routes** | 250 payloads | 1 role (`analyst`) | 1 | 250 | 0 | 0 |
| **Benign Calibration** | 100 queries | 1 schema | 1 | 0 | 100 | 0 |
| **S2-A Tier 1 (Enforce)** | 800 gold SQL | 4 roles | 1 | 0 | 3,200 | 0 |
| **S2-A Tier 1 Parity Check** | 25 gold SQL | 2 DBs $\times$ 2 roles | 1 | 100 | 0 | 0 |
| **S2-A Tier 2 (NL Chat)** | 50 questions | 4 roles | 1 | 200 | 0 | 0 |
| **S2-B Row-Level Mutations**| 48 queries | 2 tenants | 1 | 0 | 96 | 0 |
| **S2-C Utility Benchmark** | 800 queries | 4 roles | Offline | 0 | 0 | 800 |
| **S2-C Scaling Benchmark** | 10 queries | 5 policy levels | 1 | 0 | 50 | 0 |
| **Targeted Security Probes**| 5 probes | 3 roles | 1 | 15 | 0 | 0 |
| **SUBTOTALS** | **2,478 unique items** | - | - | **1,070 HTTP** | **3,696 In-Process** | **800 Offline** |
| **TOTAL INVOCATIONS** | **4,766 Total Live Executions** (1,070 HTTP requests + 3,696 In-Process Standalone Calls) | | | | | |

---

### 2.2 Execution Budget Formulas

Total evaluation execution duration is modeled as a parametric function of per-layer latencies:

$$\text{Total Duration} = T_{\text{standalone}} + T_{\text{tool}} + T_{\text{chat}} + T_{\text{offline}}$$

Where:
- $T_{\text{standalone}} = N_{\text{standalone}} \times t_{\text{standalone}}$
  - With $N_{\text{standalone}} = 3,696$ calls and estimated $t_{\text{standalone}} \approx 0.02\text{ s/call}$, $T_{\text{standalone}} \approx 74\text{ seconds}$.
- $T_{\text{tool}} = N_{\text{tool}} \times t_{\text{tool}}$
  - With $N_{\text{tool}} = 250$ calls and estimated $t_{\text{tool}} \approx 0.08\text{ s/call}$, $T_{\text{tool}} \approx 20\text{ seconds}$.
- $T_{\text{chat}} = N_{\text{chat}} \times (t_{\text{infer}} + t_{\text{cooldown}})$
  - With $N_{\text{chat}} = 820$ live LLM generation requests (RQ1: 135, RQ3: 150, S1-C1: 100, S1-C2: 100, Tier 1 Parity: 100, Tier 2: 200, Pre-flight/Probes: 35), the duration depends on the empirically measured per-token inference latency $t_{\text{infer}}$ and thermal cooldown pause $t_{\text{cooldown}}$ on the host CPU.
- $T_{\text{offline}} = N_{\text{offline}} \times t_{\text{eval}}$
  - With $N_{\text{offline}} = 800$ queries and estimated $t_{\text{eval}} \approx 0.005\text{ s/eval}$, $T_{\text{offline}} \approx 4\text{ seconds}$.

---

## 3. Checkpoint & Resume Specification (`orchestrator.js`)

Because CPU inference over 820 natural language requests spans an extended multi-hour execution window, `orchestrator.js` implements atomic checkpointing:
- **State Store**: `security-eval/results/checkpoint.json`
- **Logged Record**: `{ testId, attemptIndex, status, firstStopCode, latencyMs, timestamp }`
- **Resume Protocol**: On startup, the runner reads `checkpoint.json` and skips completed `(testId, attemptIndex)` pairs. If an OS signal (`SIGINT`, `SIGTERM`) or timeout occurs, execution halts safely and resumes from the exact boundary on subsequent invocation.
