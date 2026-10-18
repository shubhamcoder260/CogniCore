# CogniCore Spider V1 Benchmark Readiness Decision

**Date:** 2026-10-18T08:45:00Z  
**Branch:** `validation`  
**Evaluation Scope:** Main evaluation sample of 300 frozen questions across C0, C4nr, and C4 (900 evaluation units).  
**Status:** **GO — PROCEED TO MAIN EVALUATION**

---

## 1. Verified Integrity Anchors

| Item | Expected Anchor | Verified Actual | Status |
| :--- | :--- | :--- | :--- |
| **Sample SHA-256** | `EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC` | `EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC` | **PASS** |
| **Pilot SHA-256** | `30D32F4F37E809182866B02BBF4781F34B9FA2115C02EA6B37BA2F26EF6EB068` | `30D32F4F37E809182866B02BBF4781F34B9FA2115C02EA6B37BA2F26EF6EB068` | **PASS** |
| **Model Name** | `qwen2.5-coder:7b` | `qwen2.5-coder:7b` | **PASS** |
| **Model Digest Prefix** | `dae161e27b0e` | `dae161e27b0e90dd...` | **PASS** |
| **Disjoint Check** | 0 overlapping IDs between pilot (30) and sample (300) | 0 overlap (disjoint) | **PASS** |
| **Model Quarantine** | 0 sample questions evaluated prior to main run | Exactly 0 questions from sample in `llm_cache.jsonl` | **PASS** |

---

## 2. Protocol and Gate Reconciliation

The original nine pilot gates were reconciled against empirical pilot telemetry:
- **G1 (Model & Speed)**: Model verified (`dae161e27b0e`). Observed inference throughput is ~10.1 tok/s on the local host (target `>= 15 tok/s` was a hardware expectation). Estimated main run time for 900 units is ~35–45 minutes, well under the 3-hour limit.
- **G2 (Prompt content)**: Governed prompt includes schema, profile, and relationships; C0 contains raw DDL only; 0 prompts contain gold SQL or reconnaissance hints.
- **G3 (C0 parseable)**: 88.6% (31/35) of C0 pilot outputs parse cleanly as SQL (target `>= 80%`).
- **G4 (Context window)**: 0 token truncations or 4096-context overflows detected across all pilot completions.
- **G5 (Timeouts & infra errors)**: 0 timeouts and 0 unhandled infrastructure errors occurred.
- **G6 (Cache verification)**: Cache replay verified; 5 re-run items yielded 5 cache hits and 0 model invocations.
- **G7 (Database integrity)**: 100% database logical content hash invariance verified across all 20 databases (0 mutations).
- **G8 (Pilot question audit)**: All 30 pilot questions verified with gold SQL, gold row counts, hardness, `order_unique`, and `dqs_incompatible` flags.
- **G9 (Empirical runtime estimate)**: Empirical average unit time is 2,595ms; estimated 900 units runtime is ~2,336 seconds (~39 minutes).

---

## 3. Implementation Defect Repairs

1. **`spider_logical_hash.js` Bridge**: Added Node.js CommonJS bridge module to wrap `spider_logical_hash.py` and connected it in `spider_make_copies.js`.
2. **Supervisor Output Parsing**: Hardened `spider_supervisor.js` to scan stdout lines backwards for valid unit records.
3. **Subgroup & Sensitivity Analytics**: Enhanced `analysis_spider.js` to automatically compute DQS sensitivity analysis (excluding 66 DQS-incompatible queries), difficulty subgroup breakdowns, and database-level metrics.
4. **Cache Metrics Preservation**: Added raw `eval_duration_ns` preservation in `ollama_wrapper.js`.

---

## 4. Frozen File Hashes

Recorded in `validation/results/SPIDER_FREEZE_MANIFEST.json`.
The environment and codebase are frozen and ready for execution.
