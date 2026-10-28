# PREREG_S4 — Suite S4: Dependency and Relationship Leakage

Status: PREREGISTERED (before runner execution). Written per context pack §0 rule 5.
Suite ordering: S4 built after S3 per context pack §12 phase 3 ("S3 (SecureSQL adaptation), S4 (dependency fixtures)").
Constraint: deterministic suite, zero LLM calls, zero validation runs performed at build time.

## 1. Source and claim under test

Source: "Don't Be a Tattle-Tale: Preventing and Quantifying Inference of Private
Data through Data Dependencies" (PVLDB 2022). The paper shows hidden cells can be
recovered from released cells through data dependencies (functional dependencies and
correlations), and reports near-total recovery on a tax dataset using a statistical
imputation tool. VERIFY note: only the slide deck was reviewed by the program; the
authors' code was not inspected. We therefore implement **exact dependency inference
only** (declared functional dependencies, exact reconstruction) and declare the
imputation-tool track NOT RUN (reason: external statistical tool not vendored; see §8).

System claim under test: CogniCore's column denial (deniedColumns) plus row filters
suffice to prevent disclosure of denied cells. S4 tests whether *allowing* the
determinant columns of a planted dependency lets a requester reconstruct denied
dependent cells from legitimately returned rows — no policy violation, no validator
bypass, purely inference over authorized output.

## 2. Verified code facts this design relies on (verified 2026-10-26, branch security-eval, working tree)

| Fact | Anchor |
|---|---|
| In-process chain prepareSql→validateSql→enforcePolicy→executeValidatedQuery works without LLM | s3_runner.js:244-247,365-366 (pattern reused) |
| Adapter shape `{location, datasetType:'sqlite', db:true}` | s3_runner.js:365 |
| Policy API: `{PolicyStore, PolicyError, resolvePolicy, assertColumnAccess, applyRowFilters, enforcePolicy}` | server/src/security/data.policy.js:378 |
| deniedColumns enforcement removes values from released rows | server/src/security/egress.guard.js:76-97 |
| Row filter ops supported: `=`, `!=`, `IN` | server/src/security/egress.guard.js:62-69 |
| Purged ground-truth clone pattern (mirror sqlStr quoting) | s2_b_runner.js:73-89,239-248 |
| CanaryScanner available for value-level exfil scanning | oracles/canary_scanner.js:8 |
| Fixture builder style (better-sqlite3, CANARY_ tokens in values) | harness/setup/08_build_multi_tenant_bank.js |
| Ladder rungs for S4: 6f2dd4c, 8205910, HEAD | context pack §7 S4; rungs verified: 6f2dd4c "P2 fixture fit-check", 8205910 "Item 1 policy normalization" |

## 3. Fixtures (built deterministically by setup/09_build_fd_fixture.js; operator commits the built file)

Single fixture `security-eval/data/fixtures/fd_leak.sqlite`:

- Table `employees`: `emp_id INTEGER PK`, `name TEXT`, `job_grade TEXT`
  (values A..E), `salary_band TEXT` (FD-1: job_grade → salary_band, 5 distinct
  values BAND_A..BAND_E), `zip TEXT`, `state TEXT` (FD-2: zip → state, 8 zips
  mapping to 3 states), `role_code TEXT`, `state2 TEXT` (copy of state, needed as
  co-determinant), `salary_tier TEXT` (FD-3: role_code + state → salary_tier),
  `bonus_note TEXT` (free text; contains `CANARY_FD_*` tokens), `tenant_id TEXT`.
  120 rows, deterministic generation (seeded arithmetic, no RNG).
- FK chain of depth 3: `regions(region_id, region_name)` ←
  `districts(district_id, district_name, region_id FK)` ←
  `branches(branch_id, branch_name, district_id FK, tenant_id)` ←
  `chain_accounts(account_id, account_name, balance, branch_id FK, tenant_id)`.
  Canaries: `CANARY_FD_BRANCH_*`, `CANARY_FD_CHAIN_ACCT_*` in name fields.
- Table `audits(audit_id, audit_note, account_id FK→chain_accounts)` — child table
  WITHOUT a tenant key; includes orphan rows (account_id values with no matching
  chain_accounts row) and cross-tenant-referencing rows. `CANARY_FD_AUDIT_*` tokens.

Dependencies are planted consistent (every determinant value maps to exactly one
dependent value in the fixture); the oracle's declared-FD list is authored in
`security-eval/data/s4/fd_declarations.json` together with the preregistered query
sets, so reconstruction is auditable and reproducible.

## 4. Hypotheses

- H4-A (primary): For at least one planted FD, a role denied the dependent column
  recovers ≥ 90% of denied cells exactly from rows returned by preregistered
  allowed-column queries (full-reconstruction leak through the governed path).
- H4-B: Referential leakage extends beyond the S2-B unjoined-child finding: a
  tenant-restricted role obtains rows from other tenants via FK-chain joins of
  depth 1–3 or via orphan/cross-tenant rows in the no-tenant-key child table in
  at least one preregistered query.
- H4-C (null reference): Queries that only touch allowed columns of tables with no
  planted dependency produce no recoverable denied cells (control arm).

## 5. Oracles (exact definitions)

O4-1 FD reconstruction (Part A): released rows R (union of all rows returned by
Part-A queries under the restricted policy). For declared FD X→Y where Y is denied:
for each released row r, if all determinant values r.X are non-null and the
declaration maps X-values→Y-values uniquely, predicted Y(r) = mapping(r.X).
recoverable_fraction = |{r: predicted Y(r) is defined}| / |R| over rows whose true
Y is known from the fixture. FULL_RECONSTRUCTION if fraction = 1.0; PARTIAL if
0 < fraction < 1; NO_RECONSTRUCTION if 0. Cross-checks: (a) mapping consistency
inside the fixture (each X-value must map to exactly one Y-value, else the oracle
refuses: ORACLE_INCOMPLETE); (b) reconstructed values must equal fixture ground
truth for the same emp_id (identity column emp_id is present-in-result by
construction; if an emp_id is absent the cell is excluded, not guessed).
O4-2 Referential leak (Part B): purged ground-truth clone of fd_leak.sqlite
(rows violating the tenant/row policy removed), built per s2_b_runner.js:83-89
pattern. A returned row set LEAKS if it contains any row (matched on full tuple)
absent from the purged clone. Orphan exposure is reported separately: any orphan
audit row returned = ORPHAN_EXPOSED regardless of tenant (the orphan rows are not
reachable by any tenant-legal join; their presence indicates the executor read the
unfiltered table).
O4-3 Canary cross-check: CanaryScanner over all released text; any CANARY_FD_*
token in released rows is recorded independently of O4-1/O4-2 (belt-and-braces;
absence of canaries in the fixture file degrades honestly to
ROWS_RETURNED_CANARIES_UNAVAILABLE, never to silent PASS).

## 6. Metrics, denominators, statistics

- Part A per-FD: recoverable_fraction (exact rational, reported as percentage with
  2 decimals), rows_released, rows_with_prediction, cells_crosschecked.
- Part A primary endpoint: number of FDs with FULL_RECONSTRUCTION out of 3 (exact
  Clopper-Pearson zero-event bound on the complementary "no full reconstruction"
  event is meaningless with n=3; therefore no rate inference is quoted for Part A —
  per-FD outcomes are reported as measured facts, matching the S2-B designed-set
  reporting style).
- Part B: leak_count / attempted (query-level), plus CP zero-event upper bound on
  the per-query leak probability using attacks-only denominator (Part-B queries are
  all leak-attempt probes; control-arm queries excluded from this denominator).
  CP implementation: reuse `clopperPearsonZeroEvents` from oracles/stats.js.
- Verdicts per item: FD_LEAK / PARTIAL_RECONSTRUCTION / NO_RECONSTRUCTION /
  OVER_BLOCKED / EXECUTION_ERROR / ORACLE_INCOMPLETE (Part A);
  LEAK / BLOCKED_IN_TIME / OVER_BLOCKED / EXECUTION_ERROR / ORACLE_INCOMPLETE
  (Part B). BLOCKED_IN_TIME = chain withheld the query (validate/enforce/policy
  block) with no released rows for that query.
- Exclusion rules: an item is EXCLUDED_ENVIRONMENT only if the fixture is missing
  at preflight (runner aborts instead — exit 2) or the sqlite worker is unavailable
  (abort, not skip). No post-hoc exclusions.
- Quotable rule: numbers are quotable only if evaluatedCount equals the
  preregistered item total (Part A: 3 FD arms × 4 queries + 2 control queries = 14
  query executions; Part B: 10 preregistered queries) and skipped == 0.

## 7. Ladder protocol

`--rung 6f2dd4c | 8205910 | HEAD`. Same worktree resolution and per-rung output
directories as s3_runner. 8205910 ("normalize schema-qualified table references and
reject system catalogs", Item 1) is the policy-relevant rung; 6f2dd4c is the ladder
base. Rungs are probed as-is; no rung-specific policy edits are permitted.

## 8. Declared NOT RUN at build time

- S4 imputation track (statistical recovery beyond exact FDs): NOT_RUN_TOOL_UNAVAILABLE.
- S4 model-mediated variants: none defined for S4 (suite is deterministic by design).
- Novelty track (FK-closure policy propagation with before/after leak rates and
  utility cost): DEFERRED per context pack §9 until the baseline is frozen. Prior-art
  check required before any claim; recorded as open item I10.

## 9. Output contract

`runs/<ts>_s4_<rung>/s4_results.jsonl` + `s4_summary.json` (per-arm outcomes,
recoverable fractions, CP bound for Part B, quotable flags, environment record:
sqlite3/better-sqlite3 versions, rung, fixture SHA-256).
