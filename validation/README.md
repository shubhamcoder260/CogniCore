# CogniCore Validation Harness

This directory contains the independent scientific evaluation harness for CogniCore (Node.js zero-trust natural language to SQL analytics system).

---

## 1. Quickstart & Verification Commands

### Recreate the Workspace from Git
To clone the repository, check out the validation branch, and initialize the verification environment:
```bash
git clone <repo-url> validation_workspace && cd validation_workspace && git checkout validation
```

### Run Unit Tests
To execute all statistical and verification infrastructure tests (runs Node native test runner with 0 external dependencies):
```bash
node --test validation/tests
```

### Regenerate Manifest
To probe the local hardware, OS, Node/NPM versions, Ollama models, and database/sample checksums:
```bash
node validation/manifest.js
```

### Verify Preregistration & Corpus Immutability
To guarantee that the preregistered evaluation protocol and frozen corpora have not been modified since tags `prereg-v1`, `v4-corpus-v1`, and `v4b-corpus-v1`:
```bash
git diff prereg-v1 -- validation/PREREGISTRATION.md
git diff v4-corpus-v1 -- validation/data/v4
git diff v4b-corpus-v1 -- validation/data/v4b
```
*(Expected output: empty / exit code 0)*

### Step 2 (V4 SQL Safety Gate) Execution Commands
1. **Generate Deterministic Corpus** (builds `attacks.jsonl`, `benign.jsonl`, `boundary.jsonl`, `fuzz.jsonl`):
   ```bash
   node validation/experiments/v4_build_corpus.js
   ```
2. **Execute AST Gate & Verification Oracles** (runs `validateSql`, `prepareSql`, and Oracles 1-3 with resume support):
   ```bash
   node validation/experiments/v4_run_gate.js
   ```
3. **Run Integer Division Property Tests** (evaluates float equivalence, idempotence, and literal preservation):
   ```bash
   node validation/experiments/v4_repair_props.js
   ```
4. **Generate Statistical Analysis & Results** (calculates Wilson CIs, Rule of Three, CSVs, and `V4_RESULTS.md`):
   ```bash
   node validation/analysis_v4.js
   ```

### Step 2b (V4 Evidence Gap Closure & Extended Evaluation) Commands
1. **Generate Deterministic V4b Corpus** (builds `b2_probes.jsonl`, `d2_boundary.jsonl`, `c2_benign.jsonl`, `e_benchmark_status.json`):
   ```bash
   node validation/experiments/v4b_build_corpus.js
   ```
2. **Execute Phase C Experiments** (runs gate C1, oracles C2, child resource runner C3, defense hardening C4):
   ```bash
   node validation/experiments/v4b_run_experiments.js
   ```
3. **Run Phase D Evidence Gap Audit** (Class A decomposition, fuzz breakdown, T21/T22 repair failure, provenance sampling, fixture hashes):
   ```bash
   node validation/experiments/v4_audit_gaps.js
   ```
4. **Generate Final Step 2b Analysis & Scorecard** (produces Tables 1-6 CSVs and `V4b_RESULTS.md`):
   ```bash
   node validation/analysis_v4b.js
   ```

### Step 3 (V3 Row-Level Security, Column Denial, and Non-SQL Leak Channels) Commands
1. **Generate Deterministic V3 Corpus** (builds `v3_queries.jsonl`, 510 items across 15 SQLite database fixtures):
   ```bash
   node validation/experiments/v3_build_corpus.js
   ```
2. **Execute V3 Evaluation Pipeline** (runs E1 End-to-End, E2 Policy Alone, E3 Non-SQL Leaks, E4 Dialect Guard):
   ```bash
   node validation/experiments/run_v3_evaluation.js
   ```
3. **Generate Final Step 3 Analysis & Scorecard** (produces Tables 1-5 CSVs and `V3_RESULTS.md`):
   ```bash
   node validation/analysis_v3.js
   ```

---

## 2. Directory & File Index

```
validation/
├── ORIGINAL_STATE.txt      # Git HEAD and working tree status of original repo before copying
├── PREREGISTRATION.md      # Frozen evaluation hypotheses (V0-V11), statistical protocols, Wilson CIs, McNemar tests (tag: prereg-v1)
├── PREREG_AMENDMENTS.md    # Log of any post-preregistration deviations or amendments (if any)
├── DECISIONS.md            # Log of architectural, statistical, and default protocol decisions
├── CODE_DELTAS.md          # Log of proposed code fixes identified during testing (strictly not applied in Step 1)
├── LIMITATIONS.md          # Structured registry of failed hypotheses, skipped experiments, and unverified paper claims
├── MANIFEST.json           # Environment snapshot: hardware, OS, node/npm, ollama models, file hashes, source citations
├── manifest.js             # Probing script that constructs MANIFEST.json
├── README.md               # This documentation file
│
├── lib/
│   ├── config.js           # Central configuration: master seed (20261015), paths, temperatures, model roster
│   ├── jsonl.js            # Append-only JSONL logger with fsyncSync, byte immutability, and resume key tracking
│   └── stats.js            # Pure-math stats: Wilson CI, rule-of-three, exact McNemar, Mulberry32 PRNG, cluster bootstrap, Holm, Cohen's kappa
│
├── tests/
│   ├── index.js            # Runner index to allow `node --test validation/tests` execution
│   ├── stats.test.js       # Unit tests verifying exact math against analytical solutions
│   └── jsonl.test.js       # Invariant tests for atomic append, immutability, directory sandboxing, and resume extraction
│
├── raw/                    # Append-only raw execution logs recorded in JSONL format (gitignored)
├── results/                # Aggregated metric tables, bootstrap confidence intervals, and summary CSV/JSON artifacts
└── experiments/            # Experiment runner scripts (V0 through V11)
```

---

## 3. Experiment Specifications (V0 – V11)

All experiment scripts below will write output to `validation/raw/<experiment_id>.jsonl` using `validation/lib/jsonl.js` and generate summaries in `validation/results/`.

### V0: Baseline Code Facts & Pre-Existing Tests
- **Script**: `validation/experiments/v0_baseline.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Run all pre-existing server integration/unit tests, audit line references cited in the dossier, and document existing pass/fail baselines.

### V1: Governed Pipeline (C4) vs Raw LLM (C0) Paired Accuracy
- **Script**: `validation/experiments/v1_accuracy.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Evaluate $\ge 150$ queries across $\ge 5$ SQLite database fixtures. Score three-way outcomes (answered-correct, answered-wrong, abstained) and calculate exact paired McNemar test ($p < 0.05$).

### V2: Full Ablation Ladder (C0 .. C4) & Leave-One-Out
- **Script**: `validation/experiments/v2_ablation.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Measure cumulative accuracy gains and component flips (wrong $\to$ right, right $\to$ wrong) across C0 (raw), C1 (schema prune), C2 (+ repair), C3 (+ complexity), and C4 (+ validation).

### V3: Zero-Leak Data Isolation & Non-SQL Channel Auditing
- **Script**: `validation/experiments/run_v3_evaluation.js` & `validation/analysis_v3.js`
- **Status**: COMPLETED (October 2026)
- **Scope**: Evaluated 510 systematic queries across 15 reference SQLite database fixtures for Row-Level Security (CTE shadowing), Column Denial (`assertColumnAccess`), and Non-SQL information disclosure surfaces (prompts, preview endpoint, tool export, empty-result diagnostic probes, PRAGMA introspection).
- **Outcome**: **FAIL on Row-Level Security** (15 / 15 fixtures leaked unauthorized rows via SQLite `main.t` schema-qualification bypass, leaking 524 rows). **PASS on Column Denial in End-to-End pipeline** (0 direct column leaks). Disclosed non-SQL leaks in prompt compilation (255 prompts), preview endpoint, tool exports, and empty result diagnostic probes.
- **Report**: [V3_RESULTS.md](file:///C:/cognicore/validation_workspace/validation/results/V3_RESULTS.md)

### V4: Destructive SQL & Injection Rejection
- **Script**: `validation/experiments/v4_sql_gate.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Test SQL parser defenses against DDL/DML mutation, stacked queries, comment smuggling, and dialect-specific escape attempts.

### V5: Complexity Gate & Resource Quotas
- **Script**: `validation/experiments/v5_complexity.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Measure rejection of high-complexity queries (excessive joins, Cartesian products, deep subqueries) and enforce bounded memory and execution time.

### V6: Ingestion & File Validator Fuzzing
- **Script**: `validation/experiments/v6_ingestion.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Test magic-byte validation, polyglots, zip bombs, and path traversal (`../`) on uploaded files.

### V7: Analytics Engine Oracle Verification
- **Script**: `validation/experiments/v7_analytics.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Validate statistics (mean, median, standard deviation, quartiles), trend analysis, and anomaly detection against deterministic analytical oracles.

### V8: Contextual Quality Warnings & Profiler Flags
- **Script**: `validation/experiments/v8_quality_profiler.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Measure accuracy and relevance of data quality flags (outliers, missing values, duplicates) surfacing only when queried columns are affected. (Pass criteria: `TBD-BEFORE-RUN`).

### V9: Foreign Key Relationship Inference
- **Script**: `validation/experiments/v9_relationships.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Compare inferred relationships against declared SQLite schema foreign keys across all 15 reference database fixtures.

### V10: Numeric Grounding & Hallucination Suppression
- **Script**: `validation/experiments/v10_grounding.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Assert that every numeric quantity in synthesized natural-language summaries corresponds directly to executed SQL result sets.

### V11: Multi-Model Evaluation across Ollama Roster
- **Script**: `validation/experiments/v11_models.js`
- **Status**: NOT YET WRITTEN
- **Scope**: Comparative evaluation across installed Ollama models (`qwen2.5:7b`, `qwen2.5-coder:7b`, `llama3.1:8b`, `gemma3:4b`) measuring accuracy, latency, and abstention behavior.
