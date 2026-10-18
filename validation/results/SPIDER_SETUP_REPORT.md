# Spider V1 Benchmark Setup and Pilot Verification Report

**Date:** 2026-10-18  
**Run ID:** `spider-pilot-1792302870395`  
**Protocol:** SPIDER-A1, SPIDER-A2, SPIDER-A3  
**Status:** **READY FOR MAIN RUN** (All 9 Pilot Gates Passed)  
**Sample File:** `validation/data/spider/frozen_sample_300.jsonl` (SHA-256: `EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC`)  
**Pilot File:** `validation/data/spider/pilot.jsonl` (SHA-256: `30D32F4F37E809182866B02BBF4781F34B9FA2115C02EA6B37BA2F26EF6EB068`)

---

## 1. System and Environment Specifications

| Component | Verified Version / Digest | Notes |
|---|---|---|
| **Node.js** | `v24.13.1` | Native test runner (`node:test`, `node:assert/strict`) |
| **npm** | `11.8.0` | Package manager |
| **Python** | `3.11.9` (`tags/v3.11.9:de54cf5`) | Used for reference gold execution and logical hashing |
| **Python SQLite** | `3.45.1` | Double-quoted strings (DQS) enabled |
| **better-sqlite3** | `3.53.2` | Engine SQLite version; DQS disabled |
| **Ollama Host** | `http://127.0.0.1:11434` | Running locally |
| **Model** | `qwen2.5-coder:7b` | Digest: `dae161e27b0e` (Size: 4.7 GB) |
| **Inference Params** | `temperature: 0` (0.2 on recovery), `seed: 20261015`, `num_ctx: 4096`, `num_predict: 500` | Harness-controlled via `ollama_wrapper.js` |

---

## 2. Pre-Run Gold SQL Audit (330 Queries)

Every reference gold query across `frozen_sample_300.jsonl` (300 items) and `pilot.jsonl` (30 items) was executed twice in Python SQLite (`?mode=ro`, `PRAGMA query_only=ON`) and cross-checked against Node `better-sqlite3` (`DQS off`).

| Metric | Overall (330) | Main Sample (300) | Pilot Sample (30) |
|---|---|---|---|
| **Determinism Rate** | **100.0%** (330/330) | **100.0%** (300/300) | **100.0%** (30/30) |
| **DQS Incompatible (`dqs_incompatible`)** | 74 (22.4%) | 66 (22.0%) | 8 (26.7%) |
| **LIMIT without ORDER BY** | 0 (0.0%) | 0 (0.0%) | 0 (0.0%) |
| **Order Unique (`order_unique == 1`)** | 14 (4.2%) | 13 (4.3%) | 1 (3.3%) |
| **Hardness: Easy** | 146 (44.2%) | 131 (43.7%) | 15 (50.0%) |
| **Hardness: Medium** | 126 (38.2%) | 117 (39.0%) | 9 (30.0%) |
| **Hardness: Hard** | 58 (17.6%) | 52 (17.3%) | 6 (20.0%) |

- **Row Cap Compliance:** 300/300 items in `frozen_sample_300.jsonl` return < 1,000 rows. The single pilot query with 1,860 rows (`spider-dev-813`) was scored as capped/inconclusive per protocol.
- **Reference Output Artifacts:**
  - `validation/data/spider/gold_results.jsonl` (SHA-256: `46B1FE164ED6E256ED725138BF04D18E2B7F198A15D539023DB6F5035B3E44ED`)
  - `validation/data/spider/gold_checks.jsonl` (SHA-256: `D72E7DE41DFE93C62D740EE6CCBA186681985E0C0811553833DFA6EF4487A5D5`)
  - `validation/data/spider/gold_checks_summary.json` (SHA-256: `BE69E1635581C14DF416A665CD98F4F738E36A7C5A5333CFC5E75D12B92031D4`)

---

## 3. Pilot Execution Results (30 Questions, 90 Units)

Executed against real `qwen2.5-coder:7b` via Ollama with the supervisor enforcing a 60-second process tree timeout.

### 3.1 Accuracy and Primary Endpoints

| Configuration | Total Units | Correct | Accuracy (%) | 95% Wilson CI (%) |
|---|---|---|---|---|
| **C0 (Baseline Raw Engine)** | 30 | 15 | **50.0%** | [33.1, 66.9]% |
| **C4nr (Governed, No Error Recovery)** | 30 | 17 | **56.7%** | [39.2, 72.6]% |
| **C4 (Full Governed Pipeline)** | 30 | 18 | **60.0%** | [42.3, 75.4]% |

### 3.2 Paired Statistical Tests

| Comparison | Paired N | Config A Wins | Config B Wins | Ties | Discordant Pairs | Exact McNemar p-value | Difference (%) |
|---|---|---|---|---|---|---|---|
| **C4 vs C0** (Primary) | 30 | 4 | 1 | 25 (14 corr, 11 wrong) | 5 | **p = 0.3750** | +10.0% |
| **C4nr vs C0** (Secondary) | 30 | 3 | 1 | 26 (14 corr, 12 wrong) | 4 | **p = 0.6250** | +6.7% |
| **C4 vs C4nr** (Secondary) | 30 | 1 | 0 | 29 (17 corr, 12 wrong) | 1 | **p = 1.0000** | +3.3% |

- **Cluster Bootstrap (10,000 Replicates, Seed 20261015, Clustered on `db_id`):**
  - Mean paired difference (C4 - C0): **+9.7%**
  - Standard Error: `0.0982`
  - 95% Cluster-Bootstrap CI: `[-8.8%, +30.0%]`

---

## 4. Governed Recovery and Latency Analysis

### 4.1 Governed Recovery Engine Performance
- **Recovery Trigger Rate:** 2 / 30 questions (6.7%) in C4 encountered initial recoverable errors and triggered the multi-turn recovery loop.
- **Recovery Success Rate:** 1 / 2 (50.0%).
  - **Ground-Truth Repair Example (`spider-dev-353`):** C0 failed with error; C4nr failed with error; C4 detected the syntax/schema failure, prompted the model with hints, and returned the correct answer on attempt 1 (`CORRECT`, 5,964 ms).
  - Matches `maxRecovery: 2` constraints without hanging or infinite loops.

### 4.2 Latency Distributions

| Configuration | Mean (ms) | Median / p50 (ms) | p90 (ms) | p95 (ms) | Min (ms) | Max (ms) |
|---|---|---|---|---|---|---|
| **C0** | 3,118 | 2,698 | 4,243 | 6,767 | 1,259 | 7,430 |
| **C4nr** | 4,463 | 4,110 | 7,654 | 8,767 | 2,222 | 9,265 |
| **C4** | 413 | 27 | 33 | 5,715 | 23 | 5,964 |

*(Note: C4 benefits from cache hits on identical candidate SQL generated during C4nr, with dynamic multi-turn recovery triggering 5,600–6,000 ms on recoverable items).*

---

## 5. Database Integrity and Invariance Audit

- **Copy Protocol:** Fresh disposable copies created under `cognicore_spider/runs/spider-pilot-1792302870395/` (`ro/` for C0/gold, `gov/` for C4/C4nr).
- **Logical Content Hashes:** Computed via `con.iterdump()` normalized SHA-256 for all 20 source databases.
- **Pre-Run vs Post-Run Audit:**
  - Total databases evaluated: **20 / 20**
  - Databases modified during run: **0 / 20** (100% byte-logical invariance)
  - Post-run log: `validation/raw/spider/spider-pilot-1792302870395_post_hashes.json`

---

## 6. Pilot Gate Verification Checklist (G1–G9)

| Gate | Criterion | Target | Actual | Verdict |
|---|---|---|---|---|
| **G1** | Zero unhandled exceptions or supervisor crashes | 0 crashes | 0 crashes | **PASS** |
| **G2** | Database logical hash invariance before and after run | 0 modified | 0 modified | **PASS** |
| **G3** | Zero undetected truncations | 0 undetected | 0 undetected | **PASS** |
| **G4** | All units completed (no missing items) | 90 / 90 | 90 / 90 completed | **PASS** |
| **G5** | LLM completion cache reproducibility (5 re-runs) | 5 hits, 0 misses | 5 hits, 0 misses | **PASS** |
| **G6** | Baseline C0 accuracy within sensible sanity band | [20.0%, 85.0%] | 50.0% (15/30) | **PASS** |
| **G7** | Governed recovery triggers and obeys `maxRecovery` | >= 1 trigger | 2 triggers, 1 resolved | **PASS** |
| **G8** | Cross-engine gold agreement on pilot | 100% | 100% | **PASS** |
| **G9** | Timeout supervisor verified to terminate hung children | Tree-kill verified | Verified in test suite | **PASS** |

**Overall Gate Verdict: ALL 9 GATES PASSED (GO FOR MAIN EVALUATION)**

---

## 7. Main Run Execution Cost and Time Estimation

For the 300-question sample (`frozen_sample_300.jsonl`, 900 units total):
- C0: 300 units × ~2.7s median ≈ 810 seconds
- C4nr: 300 units × ~4.1s median ≈ 1,230 seconds
- C4: 300 units (cache hits + recoveries) ≈ 350 seconds
- Ingestion & pre/post hashing for 20 databases: ~90 seconds
- **Total Projected Wall-Clock Time:** **~41 minutes** (single sequential worker).

---

## 8. Operator Launch Command

To execute the frozen 300-question benchmark:

```powershell
powershell -ExecutionPolicy Bypass -File .\validation\run_spider_main.ps1
```
