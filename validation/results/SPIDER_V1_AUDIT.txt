# CogniCore Spider V1 Benchmark: Post-Run Audit Report

**Audit Date:** 2026-10-18  
**Audit Scope:** Comprehensive post-run audit of Spider V1 main evaluation run (`spider-main-v1`) on Sample A ($N=300$) with **zero model calls**, independent held-out Sample B freezing, layer replay, prompt proofs, and empirical correction of reported statements.  
**Git Branch / Commit:** `validation` / `29fac05` (Tagged: `spider-sample-b-frozen`)  
**Workspace:** `C:\cognicore\validation_workspace`

---

## 1. Executive Summary & Audit Anchors

This audit provides an independent, programmatic verification of the CogniCore Spider V1 benchmark evaluation. All metrics and tables in this report were generated directly from append-only raw evaluation logs (`validation/raw/spider/spider-main-v1_units.jsonl`), pre-run gold checks (`validation/data/spider/gold_checks.jsonl`), and prompt cache records (`validation/raw/spider/llm_cache.jsonl`) without calling any language model.

### Key Audit Findings
1. **Held-Out Sample B Frozen Prior to Item Inspection:** In accordance with audit protocol, a secondary held-out sample of 300 questions (`frozen_sample_300_B.jsonl`) was drawn from unused indices of the pre-committed deterministic pool (`pool_order.json`), verified against all preregistered eligibility rules, and frozen under Amendment SPIDER-B1 (tag: `spider-sample-b-frozen`) prior to inspecting any item-level discordances or outcomes from Sample A. Overlap with Pilot, Candidates, and Sample A is strictly zero.
2. **Three-Way Outcome Taxonomy & Selective Accuracy:**
   - **C0 (Raw DDL Baseline):** 191 Correct (63.7%), 94 Wrong-Executed (31.3%), 15 Abstained (5.0%). Selective accuracy: **67.0%** (191 / 285).
   - **C4nr (Governed, No DB Recovery):** 180 Correct (60.0%), 112 Wrong-Executed (37.3%), 8 Abstained (2.7%). Selective accuracy: **61.6%** (180 / 292).
   - **C4 (Full Governed Pipeline):** 180 Correct (60.0%), 114 Wrong-Executed (38.0%), 6 Abstained (2.0%). Selective accuracy: **61.2%** (180 / 294).
3. **Primary Endpoint Verdict (Preregistered):** Paired exact two-sided McNemar test yielded 33 discordant pairs (11 C4 wins vs. 22 C0 wins), **$p = 0.0801$** (difference: **$-3.7\%$**), with a 10,000-replicate cluster-bootstrap 95% CI of **$[-11.3\%, +2.4\%]$**. The null hypothesis cannot be rejected.
4. **Correction of Unsupported Statements in Final Report:** Four specific claims in `SPIDER_V1_FINAL_REPORT.md` were found to be unsupported or mathematically inaccurate:
   - *Claim 1:* "+1 in 18 of 19 databases" was an arithmetic sign error ($169 - 172$ is $-3$, not $+1$).
   - *Claim 2:* "Zero schema hallucinations" is contradicted by raw logs showing C4 generated non-existent columns in `course_teach`, `student_transcripts_tracking`, `car_1`, and `concert_singer`.
   - *Claim 3:* "54% fewer exceptions" conflated caught query execution errors with unhandled crashes (both C0 and C4 had zero unhandled crashes).
   - *Claim 4:* "232 ms latency" was an artifact of in-memory LLM cache reuse from C4nr; true uncached latency is ~4.4–7.0 seconds.

---

## 2. Held-Out Sample B Freezing Verification (Part A)

Sample B was generated and frozen from unused positions in `validation/data/spider/pool_order.json` strictly before inspecting any item-level data from Sample A:

| Property | Specification / Value | Audit Status |
| :--- | :--- | :--- |
| **Source Permutation** | `validation/data/spider/pool_order.json` (PREREG-A1 seed: `20261015`) | Verified |
| **Unused Index Pool** | Positions 401 through 1034 (634 remaining questions) | Verified |
| **Eligibility Verification** | Gold executed twice identically in Python SQLite read-only mode (`PRAGMA query_only=ON`), $< 1,000$ rows, no `LIMIT` without `ORDER BY`, database file exists | 627 eligible, 7 excluded |
| **Sample B Size** | First 300 eligible unused questions (pool positions 401..704) | 300 questions |
| **Sample B File** | `validation/data/spider/frozen_sample_300_B.jsonl` | SHA-256: `D1A35A18559C06393C1A36046674E619AB0B6604428E96BFAF5DBA80940D3B09` |
| **Manifest B File** | `validation/data/spider/frozen_sample_300_B_manifest.json` | SHA-256: `5CE0C368DDDE958634DAD694112D89CB2AE367AA2C3316CF8F9E581F8C759CB2` |
| **Overlap with Pilot (30)** | Exactly 0 items | **PASS (0 overlap)** |
| **Overlap with Candidates (370)** | Exactly 0 items | **PASS (0 overlap)** |
| **Overlap with Sample A (300)** | Exactly 0 items | **PASS (0 overlap)** |
| **Model Invariance** | Exactly 0 model calls performed | **PASS (0 calls)** |
| **Git Tag** | `spider-sample-b-frozen` (Commit: `29fac05`) | Verified |

---

## 3. Quantitative Tables Derived from Raw Logs (Part B)

### Table 1: Three-Way Evaluation Outcomes & Selective Accuracy

| Configuration | Total | Correct | Wrong-Executed | Abstained (Total) | Selective Accuracy (Correct / Answered) | Raw Accuracy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **C0 (Raw Baseline)** | 300 | 191 | 94 | 15 (5.0%) | **67.0%** (191 / 285) | **63.7%** (191 / 300) |
| **C4nr (Governed, No Rec.)** | 300 | 180 | 112 | 8 (2.7%) | **61.6%** (180 / 292) | **60.0%** (180 / 300) |
| **C4 (Full Governed)** | 300 | 180 | 114 | 6 (2.0%) | **61.2%** (180 / 294) | **60.0%** (180 / 300) |

### Table 2: Detailed Abstained Causes Breakdown

| Specific Cause of Abstention | C0 Units | C4nr Units | C4 Units | Operational Context |
| :--- | :---: | :---: | :---: | :--- |
| **Model Abstention (`NO_QUERY_POSSIBLE`)** | 2 | 0 | 0 | Model explicitly gave up on answerable question |
| **Validator Rejection: Parse Error** | 0 | 2 | 2 | Query syntax rejected by AST parser (`sql.validator.js`) |
| **Validator Rejection: Column Schema Error** | 0 | 0 | 4 | Multi-turn recovery exhausted without valid column resolution |
| **Runtime Error: Schema Column Missing** | 10 | 6 | 0 | SQLite threw `no such column` on unvalidated query |
| **Runtime Error: Ambiguous Column Name** | 2 | 0 | 0 | SQLite threw `ambiguous column name` |
| **Runtime Error: DQS Literal Failure** | 0 | 0 | 0 | Double-quoted string failed in engine |
| **Supervisor Timeout (> 60s)** | 0 | 0 | 0 | Zero units timed out |
| **Infrastructure Crash / Process Exit != 0** | 0 | 0 | 0 | Zero unhandled process crashes |
| **Total Abstained Units** | **15** | **8** | **6** | Governance reduced abstentions from 15 to 6 |

### Table 3: Per-Database Accuracy & Net Deltas ($N = 300$)

| Database Schema | Questions ($n$) | C0 Correct (%) | C4nr Correct (%) | C4 Correct (%) | Net Delta $(C4 - C0)$ |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `world_1` | 38 | 7 (18.4%) | 10 (26.3%) | 10 (26.3%) | **+3** |
| `car_1` | 28 | 13 (46.4%) | 15 (53.6%) | 15 (53.6%) | **+2** |
| `wta_1` | 12 | 8 (66.7%) | 9 (75.0%) | 9 (75.0%) | **+1** |
| `poker_player` | 11 | 10 (90.9%) | 10 (90.9%) | 10 (90.9%) | 0 |
| `pets_1` | 10 | 8 (80.0%) | 8 (80.0%) | 8 (80.0%) | 0 |
| `battle_death` | 9 | 7 (77.8%) | 7 (77.8%) | 7 (77.8%) | 0 |
| `singer` | 8 | 7 (87.5%) | 7 (87.5%) | 7 (87.5%) | 0 |
| `course_teach` | 7 | 6 (85.7%) | 6 (85.7%) | 6 (85.7%) | 0 |
| `voter_1` | 4 | 4 (100.0%) | 4 (100.0%) | 4 (100.0%) | 0 |
| `museum_visit` | 2 | 2 (100.0%) | 2 (100.0%) | 2 (100.0%) | 0 |
| `cre_Doc_Template_Mgt` | 19 | 11 (57.9%) | 11 (57.9%) | 11 (57.9%) | 0 |
| `dog_kennels` | 29 | 17 (58.6%) | 16 (55.2%) | 16 (55.2%) | -1 |
| `tvshow` | 25 | 15 (60.0%) | 14 (56.0%) | 14 (56.0%) | -1 |
| `concert_singer` | 14 | 13 (92.9%) | 12 (85.7%) | 12 (85.7%) | -1 |
| `employee_hire_evaluation` | 14 | 11 (78.6%) | 10 (71.4%) | 10 (71.4%) | -1 |
| `network_1` | 13 | 9 (69.2%) | 8 (61.5%) | 8 (61.5%) | -1 |
| `student_transcripts_tracking` | 22 | 17 (77.3%) | 15 (68.2%) | 15 (68.2%) | -2 |
| `orchestra` | 8 | 7 (87.5%) | 5 (62.5%) | 5 (62.5%) | -2 |
| `flight_2` | 27 | 19 (70.4%) | 11 (40.7%) | 11 (40.7%) | **-8** |
| **Total** | **300** | **191 (63.7%)** | **180 (60.0%)** | **180 (60.0%)** | **-11 (-3.7%)** |

### Table 4: Mechanical Hardness Stratification

| Hardness Tier | Questions ($n$) | C0 Correct (%) | C4nr Correct (%) | C4 Correct (%) | Delta $(C4 - C0)$ |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Easy** | 131 | 98 (**74.8%**) | 92 (**70.2%**) | 92 (**70.2%**) | $-4.6\%$ |
| **Medium** | 117 | 64 (**54.7%**) | 60 (**51.3%**) | 60 (**51.3%**) | $-3.4\%$ |
| **Hard** | 52 | 29 (**55.8%**) | 28 (**53.8%**) | 28 (**53.8%**) | $-2.0\%$ |

### Table 5: DQS-Gold Sensitivity Comparison

| Population Stratum | Questions ($n$) | C0 Correct (%) | C4 Correct (%) | Discordant Pairs | McNemar Exact 2-Sided $p$ | Net Delta |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Clean (DQS-Compatible)** | 234 | 175 (**74.8%**) | 170 (**72.6%**) | 17 (6 C4 vs. 11 C0) | $p = 0.3323$ | $-2.1\%$ |
| **DQS-Incompatible Gold** | 66 | 16 (**24.2%**) | 10 (**15.2%**) | 16 (5 C4 vs. 11 C0) | $p = 0.2101$ | $-9.1\%$ |
| **Overall Primary Sample** | **300** | **191 (63.7%)** | **180 (60.0%)** | **33 (11 C4 vs. 22 C0)** | **$p = 0.0801$** | **$-3.7\%$** |

### Table 6: Governed Multi-Turn Error Recovery Performance ($N = 300$)

| Metric | Count | Rate (%) | Operational Notes |
| :--- | :---: | :---: | :--- |
| **C4 Units with Recovery Triggered** | 6 | 2.0% | Initial generated SQL produced SQLite error |
| **Runtime Errors Fixed (Status: `success`)** | 2 | 33.3% | `spider-dev-940` (dog_kennels), `spider-dev-532` (transcripts) |
| **Recovery Exhausted (Status: `error`)** | 4 | 66.7% | Cleanly caught after 2 correction attempts |
| **Exact Gold Matches Converted** | **0** | **0.0%** | Zero units converted from wrong to exact gold tuple match |

---

## 4. Item-Level Discordance & Value Normalization Audit (Part C)

### Table 7: Discordant Cause Categorization (33 items)

| Assigned Cause | C0 Wins (C4 Wrong) | C4 Wins (C0 Wrong) | Total | Primary Mechanism |
| :--- | :---: | :---: | :---: | :--- |
| **Value-Normalization (`LOWER/TRIM`)** | 7 | 0 | 7 | `empty_result_diagnosis` rewrote text filter with `LOWER(TRIM(...))` |
| **Different Join or Aggregate from Prompt** | 6 | 4 | 10 | Semantic profile altered join path (e.g. `car_1` win vs. `concert_singer` loss) |
| **Runtime Execution Error** | 0 | 2 | 2 | C0 threw unvalidated SQL error (`no such column: T1.MakeId`) |
| **Repair Changed Meaning** | 2 | 0 | 2 | Deterministic repair re-cased column or grouping incorrectly |
| **Other (Filter / Projection / Subquery)** | 7 | 5 | 12 | Standard LLM sampling divergence on complex predicates |
| **Total Discordant Units** | **22** | **11** | **33** | $p = 0.0801$ |

### Table 8: Complete Item-Level Discordance Audit Ledger (33 Items)

| QID | DB ID | Question Text | C0 SQL / Status | C4 SQL / Status | C0 / C4 Rows | Assigned Cause |
| :--- | :--- | :--- | :--- | :--- | :---: | :--- |
| `spider-dev-37` | concert_singer | List all singer names in concerts in year 2014. | 3-table join (`singer_in_concert`) / `success` | 2-table direct join / `success` | 6 / 0 | Different join from prompt |
| `spider-dev-96` | car_1 | What is the model of car with smallest horsepower? | Subquery using `MakeId` / `success` | Subquery using `Id` / `success` | 1 / 1 | Different join from prompt (C4 win) |
| `spider-dev-133` | car_1 | Which model saves the most gasoline? | `ON T1.MakeId = T2.MakeId` / `error` | `ON T1.Id = T2.MakeId` / `success` | 0 / 1 | Runtime error in C0 (C4 win) |
| `spider-dev-151` | car_1 | Distinct models produced by General Motors or >3500? | Incorrect maker subquery / `success` | Full 4-table join / `success` | 0 / 13 | Different join from prompt (C4 win) |
| `spider-dev-167` | car_1 | Maker producing cars between 1970 and 1979? | Group-by join on Maker / `success` | `T1.Horsepower` hallucinated / `error` | 1 / 0 | Validator rejection / recovery exhausted |
| `spider-dev-201` | flight_2 | Number of flights from airport AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(SourceAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-202` | flight_2 | Number of flights to airport AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(DestAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-234` | flight_2 | Airlines with flight from source airport AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(SourceAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-236` | flight_2 | Airlines with flight to destination airport AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(DestAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-238` | flight_2 | Source airports that have flights to AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(DestAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-239` | flight_2 | Dest airports with flights from AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(SourceAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-240` | flight_2 | Flight numbers with source airport AHD? | Direct filter `= 'AHD'` / `success` | `LOWER(TRIM(SourceAirport))` / `success` | 1 / 0 | Value-normalization (`LOWER/TRIM`) |
| `spider-dev-246` | flight_2 | Flight numbers corresponding to United Airlines? | Joins on `T1.uid = T2.Airline` / `success` | `WHERE Airline = 'United Airlines'` / `success` | 0 / 1 | Different join from prompt (C4 win) |
| `spider-dev-269` | employee_hire_eval | Shop with least number of employees? | Order by count limit 1 / `success` | `no such column: T2.Manager_name` / `error` | 1 / 0 | Validator rejection / recovery exhausted |
| `spider-dev-402` | course_teach | List different course IDs of classes taught? | Distinct join on Course_ID / `success` | `no such column: T2.Course_ID` / `error` | 3 / 0 | Validator rejection / recovery exhausted |
| `spider-dev-529` | student_transcripts | Courses in spring 2003 but not fall 2003? | Except query on semester / `success` | `no such column: semester_name` / `error` | 2 / 0 | Validator rejection / recovery exhausted |
| `spider-dev-552` | student_transcripts | Date and id of transcript with at least 2 courses? | Group by transcript_id / `success` | Added `LIMIT 1` / `success` | 2 / 1 | Other (Extra LIMIT clause) |
| `spider-dev-787` | world_1 | Official Chinese cities in Asia? | Filter `IsOfficial = 'T'` / `success` | Filter `IsOfficial = 'Yes'` / `success` | 0 / 1 | Value literal mapping (C4 win) |
| `spider-dev-886` | network_1 | High schooler with greatest number of friends? | Group by ID order count / `success` | Group by name order count / `success` | 1 / 1 | Other (Tie-breaking ID vs Name) |
| `spider-dev-940` | dog_kennels | Total charge of all treatments? | Sum on `Charges.charge_amount` / `success` | Repaired to `cost_of_treatment` / `success` | 1 / 1 | Repair changed meaning |

*(Note: Complete 33-item ledger with full raw SQL queries is preserved in `validation/raw/spider/audit_discordant.json`).*

### Value-Normalization Frequency & Source Mapping
- **C0 Occurrences of `LOWER(TRIM(`:** Exactly **0** (0% accuracy).
- **C4 Occurrences of `LOWER(TRIM(`:** Exactly **7** (0% accuracy against Spider gold).
- **Code Origin:**
  - **File:** [`server/src/structured/result.checks.js`](file:///C:/cognicore/validation_workspace/server/src/structured/result.checks.js#L74-L81) (Lines 74–81, `empty_result_diagnosis`):
    ```javascript
    const ci = toNum((await adapter.executeQuery(`SELECT COUNT(*) AS n FROM ${tq} WHERE LOWER(TRIM(${cq})) = LOWER(TRIM('${lit}'))`)).rows[0]?.n) ?? 0;
    if (ci > 0) {
      edits.push({ s: start, e: tokens[i + 2].e, to: `LOWER(TRIM(${sql.slice(start, tk.e)})) = LOWER(TRIM('${lit}'))` });
    }
    ```
  - **File:** [`server/src/structured/sql.values.repair.js`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.values.repair.js#L27-L34) (Lines 27–34, `repairValueLiterals`).

---

## 5. Layer Replay Audit (Exploratory, Part D)

To isolate the marginal impact of prompt construction, deterministic repair, and AST validation, each cached initial governed-prompt completion was re-executed read-only through the pipeline layers:

### Table 9: Step-by-Step Governance Pipeline Layer Replay ($N = 300$)

| Stage / Layer | Description | Correct Predictions | Accuracy | Marginal Flips (Gains / Losses / Net) |
| :--- | :--- | :---: | :---: | :---: |
| **C0** | Raw DDL Baseline | 191 | **63.7%** | Baseline |
| **S1** | Governed Prompt + `cleanSqlOutput` | 187 | **62.3%** | +10 gains / -14 losses (Net: **-4**) |
| **S2** | After `prepareSql` (Deterministic Repairs) | 187 | **62.3%** | +1 gain / -1 loss (Net: **0**) |
| **S3** | After `validateSql` (AST Validation / Safety) | 186 | **62.0%** | +0 gains / -1 loss (Net: **-1**) |
| **C4nr** | Full Governed Pipeline Logged | 180 | **60.0%** | S3 agreement: **97.3%** (292 / 300) |

### Layer Decomposition Insights
1. **Prompt Effect (C0 $\rightarrow$ S1):** Switching from raw DDL to the governed prompt (with semantic descriptions, column values, and relationship paths) is the primary driver of performance divergence, contributing 10 improvements and 14 regressions (net: $-4$ items).
2. **Deterministic Repair Effect (S1 $\rightarrow$ S2):** `prepareSql` repaired 2 items, netting zero accuracy change (1 win on casing, 1 loss on over-eager alias substitution).
3. **Validator Effect (S2 $\rightarrow$ S3):** `validateSql` rejected 1 query that would have executed, acting as a strict safety gate.
4. **Reproducibility with C4nr (97.3%):** S3 matched logged C4nr on 292 out of 300 units. All 8 mismatches were located in `flight_2`, where `empty_result_diagnosis` executed in C4nr, rewriting 0-row results into executed queries that returned rows, which subsequently failed against Spider's DQS-incompatible empty gold results.

---

## 6. Settings and Consistency Audit (Part E)

### Git History Diffs (Pilot Commit `c17b870` $\rightarrow$ Freeze Commit `620fcad`)
1. **`validation/lib/ollama_wrapper.js`:**
   - **Diff:** Added `eval_duration_ns: result.eval_duration || 0`, `prompt_eval_duration_ns`, and `total_duration_ns` to the cache entry dictionary.
   - **Rationale:** Preserves raw Ollama execution nanoseconds directly in cache entries to enable audit of inference throughput without modifying model behavior.
2. **`validation/analysis_spider.js`:**
   - **Diff:** Added automated calculations for `dqsSensitivity` (clean subset $N=234$), `hardnessResults` (Easy, Medium, Hard), and `dbResults` into the exported JSON structure.
   - **Rationale:** Implements pre-planned subgroup reporting directly in the primary analysis script.

### Request Metadata Audit across Main Units
Inspection of raw request parameters in `validation/raw/spider/llm_cache.jsonl` confirmed 100% parameter compliance across all units:
- **Model:** `qwen2.5-coder:7b` (digest prefix: `dae161e27b0e`)
- **Temperature:** `0` on standard baseline calls; `0.1` on governed initial calls; `0.2` on recovery calls.
- **Seed:** `20261015`
- **Context Window (`num_ctx`):** `4096`
- **Predict Tokens (`num_predict`):** `500`
- **Pilot Cache Isolation:** Exactly **0** prompt-hash overlap between pilot cache entries (63) and main evaluation calls (611).

---

## 7. Prompt Proof (Part F)

For question `spider-dev-927` (*"Find the first names that are used for professionals or owners but are not used as dog names."*, database: `dog_kennels`):

### C0 Prompt (Raw DDL Baseline)
```
You are a SQL generation engine for SQLite. You have NO knowledge of what domain this data represents - only use the schema given below.

SCHEMA:
CREATE TABLE `Breeds` (
`breed_code` VARCHAR(10) PRIMARY KEY ,
`breed_name` VARCHAR(80)
);

CREATE TABLE `Charges` (
`charge_id` INTEGER PRIMARY KEY ,
`charge_type` VARCHAR(10),
`charge_amount` DECIMAL(19,4)
);

CREATE TABLE `Sizes` (
`size_code` VARCHAR(10) PRIMARY KEY ,
`size_description` VARCHAR(80)
);

CREATE TABLE `Treatment_Types` (
`treatment_type_code` VARCHAR(10) PRIMARY KEY ,
`treatment_type_description` VARCHAR(80)
);

CREATE TABLE `Owners` (
`owner_id` INTEGER PRIMARY KEY ,
`first_name` VARCHAR(50),
`last_name` VARCHAR(50),
`street` VARCHAR(50),
`city` VARCHAR(50),
`state` VARCHAR(20),
`zip_code` VARCHAR(20),
`email_address` VARCHAR(50),
`home_phone` VARCHAR(20),
`cell_number` VARCHAR(20)
);

CREATE TABLE `Dogs` (
`dog_id` INTEGER PRIMARY KEY ,
`owner_id` INTEGER NOT NULL,
`abandoned_yn` VARCHAR(1),
`breed_code` VARCHAR(10) NOT NULL,
`size_code` VARCHAR(10) NOT NULL,
`name` VARCHAR(50),
`age` VARCHAR(20),
`date_of_birth` DATETIME,
`gender` VARCHAR(1),
`weight` VARCHAR(20),
`date_arrived` DATETIME,
`date_adopted` DATETIME,
`date_departed` DATETIME,
FOREIGN KEY (`breed_code` ) REFERENCES `Breeds`(`breed_code` ),
FOREIGN KEY (`size_code` ) REFERENCES `Sizes`(`size_code` ),
FOREIGN KEY (`owner_id` ) REFERENCES `Owners`(`owner_id` ),
FOREIGN KEY (`owner_id` ) REFERENCES `Owners`(`owner_id` )
);

CREATE TABLE `Professionals` (
`professional_id` INTEGER PRIMARY KEY ,
`role_code` VARCHAR(10) NOT NULL,
`first_name` VARCHAR(50),
`street` VARCHAR(50),
`city` VARCHAR(50),
`state` VARCHAR(20),
`zip_code` VARCHAR(20),
`last_name` VARCHAR(50),
`email_address` VARCHAR(50),
`home_phone` VARCHAR(20),
`cell_number` VARCHAR(20)
);

CREATE TABLE `Treatments` (
`treatment_id` INTEGER PRIMARY KEY ,
`dog_id` INTEGER NOT NULL,
`professional_id` INTEGER NOT NULL,
`treatment_type_code` VARCHAR(10) NOT NULL,
`date_of_treatment` DATETIME,
`cost_of_treatment` DECIMAL(19,4),
FOREIGN KEY (`treatment_type_code` ) REFERENCES `Treatment_Types`(`treatment_type_code` ),
FOREIGN KEY (`professional_id` ) REFERENCES `Professionals`(`professional_id` ),
FOREIGN KEY (`dog_id` ) REFERENCES `Dogs`(`dog_id` )
)

RULES:
- Output ONLY a single valid SQLite SELECT statement. No explanation, no markdown, no code fences.
- Only SELECT statements are allowed (a leading WITH ... SELECT is fine). Never write DROP, DELETE, UPDATE, INSERT, ALTER, CREATE, ATTACH, or PRAGMA.
- Use the table and column names exactly as shown in the schema above.
- Filter text columns using the exact spellings listed under possible values.
- When dividing counts or sums to compute a rate/percentage, the result should be a decimal, not an integer - write it in a way that avoids integer truncation (multiply by 100.0 first).
- Do not use semicolons or comments.
- If the question genuinely cannot be answered with the given schema (e.g. it asks about data that isn't present at all), output exactly: NO_QUERY_POSSIBLE
- Simple questions (counts, averages, sums, filters, sorting, filtering on multiple values) almost always CAN be answered directly against the schema above - attempt a query rather than giving up.

QUESTION: Find the first names that are used for professionals or owners but are not used as dog names.

SQL:
```

### Governed Prompt (Excerpts Showing Added Semantic & Relationship Blocks)
```
You are a SQL generation engine for SQLite. You have NO knowledge of what domain this data represents - only use the schema given below.

SCHEMA:
Table "Breeds" [3 rows]: breed_code (VARCHAR(10), PK), breed_name (VARCHAR(80))
Table "Charges" [3 rows]: charge_id (INTEGER, PK), charge_type (VARCHAR(10)), charge_amount (DECIMAL(19,4))
...
Table "Dogs" [15 rows]: dog_id (INTEGER, PK), owner_id (INTEGER), abandoned_yn (VARCHAR(1)), breed_code (VARCHAR(10)), size_code (VARCHAR(10)), name (VARCHAR(50)), ...
  Relationships: breed_code -> Breeds.breed_code; size_code -> Sizes.size_code; owner_id -> Owners.owner_id; owner_id -> Owners.owner_id
...

Valid table name(s), exactly as spelled above: "Breeds", "Charges", "Sizes", "Treatment_Types", "Owners", "Dogs", "Professionals", "Treatments"

SEMANTIC MODEL (what each column means, with real values found in the data - use these exact spellings in filters):
Table "Breeds" (3 rows):
  - breed_code: unique identifier
  - breed_name: category / label; possible values: Husky | Eskimo | Bulldog
...
Table "Dogs" (15 rows):
  - name: category / label; possible values: Troy | Narciso | Merritt | Mavis | Lyric | Kacey | Jesus | Jeffrey | Houston | Holden | Hipolito | George …
...

DETECTED RELATIONSHIPS:
Dogs.owner_id -> Owners.owner_id
Dogs.size_code -> Sizes.size_code
Dogs.breed_code -> Breeds.breed_code
Treatments.dog_id -> Dogs.dog_id
Treatments.professional_id -> Professionals.professional_id
Treatments.treatment_type_code -> Treatment_Types.treatment_type_code

JOIN PATHS (use exactly these conditions when combining tables):
To combine "Owners" with "Dogs": JOIN using "Dogs"."owner_id" = "Owners"."owner_id" (via Dogs -> Owners)
To combine "Owners" with "Professionals": JOIN using "Dogs"."owner_id" = "Owners"."owner_id" AND "Treatments"."dog_id" = "Dogs"."dog_id" AND "Treatments"."professional_id" = "Professionals"."professional_id" (via Dogs -> Owners -> Treatments -> Professionals)
...
[RULES, QUESTION, AND SQL SUFFIX IDENTICAL TO C0]
```
**Proof:** Confirmed C0 contains nothing beyond DDL and output-format instruction lines. Governed prompt injects row counts, semantic column roles, real sample values, detected foreign keys, and multi-hop join paths.

---

## 8. Corrected Statements Audit (Part G)

This section systematically reconciles every unsupported statement in [`validation/results/SPIDER_V1_FINAL_REPORT.md`](file:///C:/cognicore/validation_workspace/validation/results/SPIDER_V1_FINAL_REPORT.md). The original report remains untouched for archival integrity.

### Statement 1: Database Delta Direction
- **Original Statement in Report (§8):**
  > *"Outside of flight_2, $(C4 - C0)$ was $+1$ across the remaining 18 databases (169 vs. 172)."*
- **Audit Finding:** **UNSUPPORTED / ARITHMETIC SIGN ERROR.**
  C0 correct across the remaining 18 databases was 172. C4 correct across the remaining 18 databases was 169. The actual difference is $169 - 172 = \mathbf{-3}$, not $+1$.
- **Corrected Statement:**
  > *"Across the 18 databases outside of `flight_2`, C4 trailed C0 by $-3$ items (169 vs. 172). C4 achieved net positive deltas in only 3 databases (`world_1` +3, `car_1` +2, `wta_1` +1), matched C0 in 8 databases, and trailed C0 in 8 databases (`orchestra` -2, `student_transcripts_tracking` -2, `dog_kennels` -1, `tvshow` -1, `concert_singer` -1, `employee_hire_evaluation` -1, `network_1` -1, and `flight_2` -8)."*

### Statement 2: Schema Hallucinations
- **Original Statement in Report (§14):**
  > *"Zero schema hallucinations on foreign keys in complex schemas (car_1, world_1)."*
- **Audit Finding:** **UNSUPPORTED OVERSTATEMENT.**
  While C4 navigated foreign keys successfully on specific `car_1` and `world_1` queries where C0 failed, C4 generated multiple queries with non-existent columns and invalid joins elsewhere in the sample:
  - In `concert_singer` (`spider-dev-37`), C4 hallucinated a direct join between `concert` and `singer` on `concert_ID = Singer_ID`, omitting the `singer_in_concert` junction table.
  - In `course_teach` (`spider-dev-402`), C4 hallucinated `T2.Course_ID`.
  - In `student_transcripts_tracking` (`spider-dev-529`), C4 hallucinated `semester_name`.
  - In `car_1` (`spider-dev-167`), C4 hallucinated `T1.Horsepower`.
- **Corrected Statement:**
  > *"CogniCore's governance engine reduced foreign-key navigation errors on selected multi-table schemas (such as `car_makers -> model_list -> car_names` in `car_1`), but did not eliminate schema column or join hallucinations across the benchmark, producing unresolvable column reference errors on several queries."*

### Statement 3: Runtime Exceptions Reduction
- **Original Statement in Report (§14):**
  > *"54% reduction in unhandled runtime database exceptions (13 down to 6)."*
- **Audit Finding:** **IMPRECISE TERMINOLOGY.**
  Both C0 and C4 experienced **zero unhandled exceptions** (all errors were intercepted within application try/catch boundaries). The metric reflects SQL queries that threw execution errors reaching final output (13 in C0 down to 6 in C4, a 53.8% reduction). Crucially, this error reduction did not convert into higher benchmark accuracy because repaired queries frequently selected non-gold row sets.
- **Corrected Statement:**
  > *"The governance pipeline reduced SQL query execution errors that reached final output from 13 in C0 down to 6 in C4 (a 53.8% reduction), but this error suppression did not improve overall accuracy because queries modified by the recovery engine selected row tuples differing from gold."*

### Statement 4: C4 Execution Latency
- **Original Statement in Report (§4, §11):**
  > *"C4: Mean 232 ms (cached initial queries) | P50 38 ms | P95 114 ms"*
- **Audit Finding:** **MISLEADING LATENCY PRESENTATION.**
  Listing 232 ms as C4's execution latency creates the impression that the governed engine is an order of magnitude faster than C0 (3,871 ms). In reality, C4 executes strictly more code than C0 and C4nr. The 232 ms latency was purely an artifact of running C4 after C4nr with in-memory completion caching.
- **Corrected Statement:**
  > *"C4's true uncached execution latency is approximately 4,380 ms mean (comparable to or higher than C4nr), with multi-turn recovery adding ~2,400 ms per correction turn. The reported 232 ms mean was entirely an artifact of 98% in-memory cache-hit reuse from the preceding C4nr run."*

---

## 9. Primary vs. Post-Hoc Analysis Ledger

| Analysis Type | Endpoint / Stratum | Result | Pre-Registered Status | Scientific Weight |
| :--- | :--- | :---: | :---: | :--- |
| **PRIMARY** | C4 vs. C0 on Sample A ($N=300$) | $p = 0.0801$ (diff: $-3.7\%$) | PREREG-A1 / SPIDER-A3 | **Definitive test; null hypothesis stands** |
| **PRIMARY** | Cluster-Bootstrap 95% CI ($N=300$) | $[-11.3\%, +2.4\%]$ | SPIDER-A2 / SPIDER-A3 | **Definitive CI; spans zero** |
| **POST-HOC** | DQS-Clean Subset ($N=234$) | $p = 0.3323$ (diff: $-2.1\%$) | Exploratory Sensitivity | Exploratory; confirms no hidden advantage |
| **POST-HOC** | Mechanical Hardness Subgroups | Easy $-4.6\%$, Med $-3.4\%$, Hard $-2.0\%$ | Exploratory Subgroup | Exploratory descriptive finding |
| **POST-HOC** | Layer Replay (S1, S2, S3) | S1: 62.3%, S2: 62.3%, S3: 62.0% | Exploratory Decomposition | Exploratory; identifies prompt effect |
| **POST-HOC** | Value-Normalization Analysis | 7 / 7 `LOWER(TRIM(` failed | Exploratory Error Analysis | Exploratory; localizes `flight_2` defect |

---

## 10. Audit Verification and Verification Sentinel

- **Test Suite Pass Rate:** 36 / 36 tests passing in `validation/tests/` (100% pass rate).
- **Sample A Integrity:** `frozen_sample_300.jsonl` SHA-256 verified unchanged (`EDBFB9FFB0C32CB7501758156B0DDA06D0004916FB1BE95A7EAC064E499ACDAC`).
- **Pilot Integrity:** `pilot.jsonl` SHA-256 verified unchanged (`30D32F4F37E809182866B02BBF4781F34B9FA2115C02EA6B37BA2F26EF6EB068`).
- **Raw Telemetry Logs:** `spider-main-v1_units.jsonl` untouched and preserved.
- **Original Repositories:** `C:\cognicore\CogniCore` completely untouched.
- **Audit Raw Artifacts Staged:**
  - `validation/raw/spider/audit_tables.json`
  - `validation/raw/spider/audit_discordant.json`
  - `validation/raw/spider/audit_layer_replay.json`
  - `validation/raw/spider/audit_consistency.json`
  - `validation/raw/spider/audit_prompt_proof.json`
- **Post-Run Audit Report:** `validation/results/SPIDER_V1_AUDIT.md`.
