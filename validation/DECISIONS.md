# CogniCore Validation Architectural & Methodological Decisions

This document records all methodological decisions, architectural invariants, and defaults established for the CogniCore scientific validation harness.

---

## Mandated Decisions

### Decision 1: Dialects Claimed
- **Decision**: SQLite only. Postgres and MySQL test evaluations are marked as `NOT RUN` unless an external live server instance is explicitly provisioned and configured.
- **Rationale**: CogniCore ships with 15 SQLite database fixtures preloaded under `database/`. Testing against Postgres/MySQL without real database instances produces synthetic parser mocks rather than genuine execution ground truth. The paper claims SQLite performance; external dialects remain out of scope unless verifiable against a live database container.

### Decision 2: Column Denial Definition
- **Decision**: ANY reference to a denied column in generated or intermediate SQL counts as a security leak/violation. This includes appearances in `SELECT`, `WHERE`, `ORDER BY`, `GROUP BY`, `HAVING`, `JOIN ... ON`, subqueries, and wildcard expansion (`SELECT *`).
- **Rationale**: In zero-trust data governance, column denial is not merely an egress filter on final result sets. Referencing a restricted column in a `WHERE` clause allows boolean inference side-channels (e.g. `WHERE salary > 100000`), and referencing it in `ORDER BY` leaks statistical rank information. Therefore, any syntactic or semantic mention of a denied column constitutes a complete gate failure.

### Decision 3: Independence of Datasets and Test Sets
- **Decision**: The adversarial attack set and the RBAC expected allow/deny matrix must be authored by someone other than the filter and engine authors. In `PREREGISTRATION.md`, both are explicitly designated as `PENDING EXTERNAL AUTHOR`.
- **Rationale**: Handcrafted test suites written by the filter author inherently suffer from circularity (regexes written to match the specific test examples). True zero-trust claims require test inputs to originate from independent security corpora (e.g., PayloadsAllTheThings, Lakera Gandalf, HackAPrompt) or an unblinded external evaluator.

---

## Implementation Defaults Adopted (Step 1)

1. **CommonJS Module Architecture**:
   - The validation harness adheres strictly to CommonJS (`require` / `module.exports`) to match `server/package.json` (`"type": "commonjs"`).

2. **Zero External Dependencies**:
   - All statistical routines (`wilson`, `mcnemarExact`, `holm`, `cohensKappa`, `clusterBootstrap`, `mulberry32`), file parsers, and hashing utilities are implemented using pure JavaScript and Node built-in modules (`node:test`, `node:assert/strict`, `crypto`, `fs`, `path`, `os`, `child_process`). This guarantees deterministic reproducibility without reliance on npm network access or third-party package churn.

3. **Deterministic Pseudo-Random Number Generation (Mulberry32)**:
   - For statistical bootstrapping (resampling database clusters and questions), the harness uses a deterministic 32-bit Mulberry32 PRNG seeded by `MASTER_SEED = 20261015`. This ensures that bootstrap confidence intervals are bit-for-bit identical across repeated evaluations on identical hardware.

4. **Append-Only Immutability Invariant for Raw Logs**:
   - `validation/lib/jsonl.js` enforces strict append-only logging using `fs.openSync(..., 'a')` and `fs.fsyncSync(fd)` after every write. Overwriting or truncating existing `.jsonl` files in `validation/raw/` is prohibited at the API boundary, and path traversal outside `validation/raw/` throws fatal exceptions.

5. **Directory Runner Compatibility (`validation/tests/index.js`)**:
   - In Node 24 on Windows, executing `node --test validation/tests` without an index file fails with `MODULE_NOT_FOUND` as Node expects a module entry point. `validation/tests/index.js` was created to aggregate test suites so that running `node --test validation/tests` executes all unit tests seamlessly.

6. **Missing Probe Value Conventions**:
   - As mandated by the zero-fabrication invariant, any hardware, model, or configuration metric that cannot be directly queried is recorded as `{ value: null, reason: "<concrete explanation>" }` rather than an assumed or placeholder string.

---

## Phase B Decisions (Step 2: V4 SQL Safety Gate)

1. **Dual Driver Architecture for Oracles**:
   - To prevent test coupling, `better-sqlite3@12.11.1` is installed into `validation/package.json` specifically for the oracle verification harness, while the server's existing module instance (`server/node_modules/better-sqlite3`) is probed for runtime compatibility.

2. **Preregistration Immutability & Amendments**:
   - `validation/PREREGISTRATION.md` is strictly frozen at git tag `prereg-v1`. All clarifications, operational definitions, item classifications, and hypothesis criteria refinements are committed to `validation/PREREG_AMENDMENTS.md`.

3. **Item Class Stratification (A, B, C, D)**:
   - Tests are partitioned into Class A (spec-mandated rejections), Class B (unspecified/SELECT-callable probes), Class C (benign valid queries), and Class D (complexity boundary limits). This ensures clear separation between explicit contract violations and dialect edge-case behaviors.

---

## Phase G Decisions (Step 2: V4 Analysis & Reporting)

1. **Bypass Denominator Standardization**:
   - The denominator for the bypass rate is defined strictly as the count of queries *accepted by the gate* ($n_{accepted}$) within that stratum, rather than the total corpus count. This accurately reflects conditional gate failure: given that the gate permitted execution, what proportion resulted in a driver non-read-only state or filesystem/database mutation?

2. **Classification of False Rejections on Class C**:
   - Rejections on Class C are categorized into literal syntax smuggling controls (queries where legitimate punctuation like `;`, `--`, `/*` was present inside string constants) vs. AST parser errors. This ensures precision in identifying that the 9.09% false rejection rate stems directly from regex string-level screening over-reaching into literal data content.

3. **Multi-Oracle Consensus**:
   - Any query accepted by the gate that triggers non-readonly in Oracle 1 (`statement.readonly === false`), or filesystem/data changes in Oracle 2 (`mutationOracle`), or executor mutation in Oracle 3 (`defenseInDepthOracle`) is recorded as a security bypass.

