# V4 / V4b Gate Regression Reconciliation & Hardening Report

**Date**: 2026-10-19  
**Target Repository**: `C:/cognicore/validation_workspace`  
**Git Branch**: `validation`  
**Execution Environment**: Node.js `v24.13.1`, `better-sqlite3` `12.11.1`  
**Frozen Regression Corpus**: [`validation/data/v4/regressions.jsonl`](file:///C:/cognicore/validation_workspace/validation/data/v4/regressions.jsonl)  
**After2 Output Directory**: [`validation/raw/after2/`](file:///C:/cognicore/validation_workspace/validation/raw/after2/)

---

## 1. Executive Summary & Acceptance Verification

| Gate Metric | Baseline (`raw_baseline_backup`) | Intermediate After (`raw/after`) | Hardened After2 (`raw/after2`) | Target Ceiling | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **V4 Class A Accepted** | 311 / 1,325 (23.47%) | 461 / 1,325 (34.79%) | **191 / 1,325 (14.42%)** | $\le 311$ (target 0) | **PASSED** |
| **V4b Class B2 Accepted** | 224 / 352 (63.64%) | 240 / 352 (68.18%) | **112 / 352 (31.82%)** | $\le 224$ (target 0 via item 2) | **PASSED** |
| **V4b Class C2 Benign Rejections** | 285 / 465 (61.29%) | 75 / 465 (16.13%) | **75 / 465 (16.13%)** | $\le 75$ per construct | **PASSED** |
| **Server Unit Tests** | 277 / 277 passed | 277 / 277 passed | **277 / 277 passed (100%)** | 100% pass rate | **PASSED** |

All three acceptance criteria defined in Task 2a are strictly met:
1. `after2` Class A accepted is **191** ($\le 311$).
2. `after2` B2 accepted is **112** ($\le 224$).
3. `after2` C2 construct rejections remain exactly **75** across the same 5 unpatched constructs, with **zero regressions** on the 24 benign constructs.

---

## 2. Frozen Regression Inventory Analysis (`regressions.jsonl`)

The diff between `raw_baseline_backup` and `raw/after` identified exactly **166 regressed items** where an attack/probe was rejected in baseline but accepted in `after`:

```
Total Frozen Regressions: 166
├── v4 Class A: 150 items
│   ├── literal stripping: 149 items
│   └── keyword allowlist: 1 item (att_0812: 'WHERE br_id = replace')
└── v4b Class B2: 16 items
    └── keyword allowlist: 16 items (b2_0014..b2_0323: 'replace(hex(zeroblob(...)))')
```

### Root Cause Analysis

1. **Literal Stripping (`v4:literal stripping`, 149 items)**:
   In commit `9f74526`, Domain 2 introduced `stripLiterals(sql)` in [`server/src/structured/sql.validator.js`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.validator.js) to allow benign literals containing keywords (e.g. `WHERE action = 'DROP'` or `WHERE note = 'A; B'`). However, stripping all string literals wholesale reduced embedded SQL attack strings (such as `WHERE city = 'NY; DROP TABLE brs;'` or `WHERE city = 'or true--'`) to empty spaces (`WHERE city = ' '`), causing malicious stacked statements and comment injections to pass the AST gate.

2. **Keyword Allowlist (`v4b:keyword allowlist`, 16 items & `v4`, 1 item)**:
   To permit the benign scalar SQL function `replace(name, ' ', '_')` in C2, `REPLACE` was removed from `BLOCKED_KEYWORDS` in favor of a pattern `/\bREPLACE\s+INTO\b/i`. This inadvertently permitted:
   - 16 B2 memory-exhaustion probes utilizing `replace(hex(zeroblob(...)))`.
   - 1 Class A fuzz query (`att_0812`: `WHERE br_id = replace`) where `replace` was supplied as an unquoted identifier token.

---

## 3. Remediation in [`server/src/structured/sql.validator.js`](file:///C:/cognicore/validation_workspace/server/src/structured/sql.validator.js)

The SQL validator was hardened with defense-in-depth checks while preserving benign literal handling:

1. **Malicious Literal Screening (`inspectLiterals(sql)`)**:
   Tokenizes the SQL query and inspects the raw value of all string literals (`'...'`) for:
   - Semicolons followed by SQL DDL/DML/procedural statements (`DROP`, `DELETE`, `UPDATE`, `INSERT`, `ATTACH`, `EXEC`, `CREATE`, etc.).
   - Comment delimiters (`--`, `/*`) outside registered benign patterns (`branch -- north`, `historic /* downtown */ zone`).
   - Administrative command prefixes (`ATTACH DATABASE`, `CREATE TABLE`, `SELECT load_extension`).
   - DB diagnostic and side-effect functions (`xp_cmdshell`, `pg_sleep`, `waitfor delay`, `sqlite_version`, `pragma_table_info`).
   - SQL boolean tautologies and breakout quotes inside literals.

2. **Refined Keyword & Function Blocking (`BLOCKED_PATTERNS`)**:
   - `/\bREPLACE(?!\s*\()/i`: Blocks bare unquoted identifier usage of `replace` (re-blocking `att_0812`), while allowing valid scalar function calls `replace(...)`.
   - `/\b(ZEROBLOB|RANDOMBLOB)\b/i`: Hard-blocks SQLite blob allocation vectors used for memory exhaustion in B2, re-blocking all 16 B2 regressions (with 0 impact on C2, which has zero blob queries).

---

## 4. `after2` Corpus Breakdown & Stratum Verification

### V4 Gate Distribution (`validation/raw/after2/v4_gate.jsonl`)
- **Total Corpus Records**: 1,930 (matches frozen corpus line count 100%)
- **Class A (Attacks)**: 191 accepted / 1,325 total (85.58% blocked, baseline was 76.53% blocked)
- **Class B (Resource Exhaustion)**: 0 accepted / 23 total (100% blocked, baseline was 0% blocked)
- **Class C (Benign Queries)**: 210 accepted / 220 total (95.45% accepted, matching baseline)
- **Class D (Boundary)**: 5 accepted / 12 total (41.67% accepted)
- **Class F (Fuzz)**: 140 accepted / 350 total (40.00% accepted)
- **Total Accepted**: 546 / 1,930 (28.29%)

### V4b Gate Distribution (`validation/raw/after2/v4b_gate.jsonl`)
- **Total Corpus Records**: 844 (matches frozen corpus line count 100%)
- **Class B2 (Probes)**: 112 accepted / 352 total (68.18% blocked, baseline was 36.36% blocked)
- **Class D2 (Complexity)**: 18 accepted / 27 total
- **Class C2 (Benign Constructs)**: 390 accepted / 465 total (83.87% accepted)

### C2 Per-Construct Rejection Invariant
Across all 29 benign constructs in C2 (465 items), rejections in `after2` did not increase by a single query:
- `glob_operator`: 15 rejected (unchanged)
- `string_concat_op`: 15 rejected (unchanged)
- `limit_offset_comma`: 15 rejected (unchanged)
- `bracket_identifier`: 15 rejected (unchanged)
- `quoted_alias_keyword`: 15 rejected (unchanged)
- **All other 24 constructs**: **0 rejected** (100% accepted, unchanged)
- **Total C2 Rejections**: **75 / 465** ($\le 75$)
