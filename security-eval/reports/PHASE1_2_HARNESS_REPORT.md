# CogniCore Security Evaluation — Phase 1 & 2 Harness & Pipeline Report
*Delivered under Security Evaluation Protocol v3*

---

## 1. Phase 1: Oracles & Harness Implementation
The evaluation harness was constructed as modular, testable, and strictly isolated evaluation infrastructure located under [`security-eval/harness/oracles/`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/).

### Implemented Oracle Components
1. **Logical Hash Oracle** ([`logical_hash_oracle.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/logical_hash_oracle.js)):
   - Captures logical SQL dump hashes (`sqlite3 .dump | sha256sum`).
   - Verifies `PRAGMA user_version`.
   - Inspects `sqlite_temp_master` for unauthorized transient tables/triggers.
2. **Directory Snapshot Oracle** ([`directory_snapshot_oracle.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/directory_snapshot_oracle.js)):
   - Recursive directory snapshot capturing file names, sizes, and SHA-256 digests.
   - Ignores transient `-wal` and `-shm` files; strips volatile filesystem timestamps.
   - Executes `PRAGMA wal_checkpoint(TRUNCATE)` prior to hash capture.
3. **Canary Scanner** ([`canary_scanner.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/canary_scanner.js)):
   - Role-aware scanner traversing prose strings, nested JSON objects, arrays, and binary buffers.
   - Detects forbidden strings, email canaries, and numeric sentinels.
4. **Triage Oracle** ([`triage_oracle.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/triage_oracle.js)):
   - Implements O10 triage rules: canonical row serialization preserving SQLite storage classes (`NULL`, `INTEGER`, `REAL`, `TEXT`, `BLOB`).
   - Multiset frequency comparison for row equivalence, superset (`LEAK`), and subset (`OVER-FILTERED`) outcomes.
   - Strict 6-code reason classifier: `POLICY`, `VALIDATOR`, `PARSE`, `COMPLEXITY`, `DRIVER`, `UNCLASSIFIED`.
5. **Statistical Oracle** ([`stats.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/stats.js)):
   - Computes one-sided 95% Clopper-Pearson upper confidence bounds for zero events ($p_{\text{upper}} = 1 - 0.05^{1/n}$).
   - Computes exact two-sided McNemar tests for paired trials.
   - Aggregates composite prompt-level events while reporting secondary outcomes separately.
6. **Isolated Sandbox Manager** ([`sandbox_manager.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/sandbox_manager.js)):
   - Ephemeral directory allocation via `fs.mkdtempSync()`.
   - Config D naive driver execution (`readonly: false`, `exec()`, extension loading enabled) bounded by O6 timeout to prevent DoS harness hangs.
   - Attribution testing of production capping wrappers.
7. **Logging & Manifest Writers** ([`jsonl_logger.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/jsonl_logger.js), [`manifest_writer.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/oracles/manifest_writer.js)):
   - Append-only JSONL event streaming with atomic `checkpoint.json` state recording.
   - Run manifests recording git commit, Node/SQLite versions, random seeds, and input SHA-256 hashes.

### Oracle Selftest Suite Verification
Executed via `node --test security-eval/harness/oracles/oracle_selftest.js`:
- Negative Control 1: Benign `SELECT` leaves logical dump hash 100% identical (**PASS**)
- Negative Control 2: Clean response contains no denied canary token (**PASS**)
- Negative Control 3: Authorized result matching purged ground truth triaged as `ALLOWED-EXACT` (**PASS**)
- Positive Control 1: `DROP TABLE` on naive path alters logical dump hash (**PASS**)
- Positive Control 2: Stacked `UPDATE` via `exec()` alters multiple records (**PASS**)
- Positive Control 3: `ATTACH` creating a file detected by Directory Snapshot Oracle (**PASS**)
- Positive Control 4: `CREATE TEMP TABLE` detected by Logical Hash Oracle (**PASS**)
- Positive Control 5: Canary token in nested JSON detected by Canary Scanner (**PASS**)
- Positive Control 6: Extra row in enforced result classified as `LEAK` by Triage Oracle (**PASS**)
- Statistical Oracle: Clopper-Pearson, McNemar, and prompt composite calculations verified (**PASS**)
**Result: 10/10 tests passed (100% pass rate).**

---

## 2. Phase 2: Setup, Fixtures & Data Pipeline
The fixture generation and sampling pipeline was implemented under [`security-eval/harness/setup/`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/).

### Provisioned Fixtures & Pipeline Scripts
1. **Manifest Verifier** ([`01_verify_checksums.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/01_verify_checksums.js)):
   - Validates checksum manifests using Node native `crypto.createHash('sha256')`.
2. **Job Postings Fixture** ([`02_convert_job_postings.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/02_convert_job_postings.js)):
   - Converts `scratch/P2SQL/RQ1/code/job_postings.sql` to SQLite.
   - Generates [`security-eval/data/fixtures/job_postings.sqlite`](file:///home/shubh/Documents/CogniCore/security-eval/data/fixtures/job_postings.sqlite).
   - Injects User 2 canary email: `CANARY_USER2_SECRET_a@example.com`.
3. **Child Projects Fixture** ([`03_build_child_fixture.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/03_build_child_fixture.js)):
   - Generates [`security-eval/data/fixtures/child_projects.sqlite`](file:///home/shubh/Documents/CogniCore/security-eval/data/fixtures/child_projects.sqlite).
   - Table `projects` contains direct `tenant_id`; child table `tasks` references `projects.id` via foreign key without direct `tenant_id`.
   - Seeds unique tenant canary task tokens: `CANARY_TENANT_A_TASK_1`, `CANARY_TENANT_A_TASK_2`.
4. **Direct-Key Multi-Tenant Bank** ([`08_build_multi_tenant_bank.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/08_build_multi_tenant_bank.js)):
   - Generates [`security-eval/data/fixtures/multi_tenant_bank.sqlite`](file:///home/shubh/Documents/CogniCore/security-eval/data/fixtures/multi_tenant_bank.sqlite).
   - All tables (`customers`, `accounts`) contain direct `tenant_id` columns and customer canaries: `CANARY_TENANT_A_CUST_1`, `CANARY_TENANT_B_CUST_3`.
5. **RCR Dataset Reader** ([`04_rcr_reader.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/04_rcr_reader.js)):
   - Streams `scratch/RCR/data/spider/spider-access-control.zip` member `access_control_dataset.jsonl`.
   - Maps user roles (`User_1` -> `analyst`, `User_2` -> `user`, `User_3` -> `manager`, `User_4` -> `employee`).
   - Implements O8 policy synthesis: generates exhaustive column denials on denied tables.
6. **Spider 16-DB Sampler** ([`05_spider_sampler.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/05_spider_sampler.js)):
   - Deterministically samples 16 Spider databases (2 to 26 tables) across 4 tiers with 792 stratified gold queries.
   - Generates [`security-eval/data/manifests/spider_16_db_sample.json`](file:///home/shubh/Documents/CogniCore/security-eval/data/manifests/spider_16_db_sample.json).
7. **Spider Golden Extractor** ([`06_extract_golden_spider.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/06_extract_golden_spider.js)):
   - Selective extractor targeting the 16 sampled databases from `data/downloads/spider.zip`.
8. **Canary Token Seeder** ([`07_seed_canaries.js`](file:///home/shubh/Documents/CogniCore/security-eval/harness/setup/07_seed_canaries.js)):
   - Injects unique string tokens and numeric sentinels per table and column.
   - Generates [`security-eval/data/manifests/canary_tokens_job_postings.json`](file:///home/shubh/Documents/CogniCore/security-eval/data/manifests/canary_tokens_job_postings.json).
9. **Extracted Realm Databases**:
   - 15 production-like SQLite databases unpacked into [`security-eval/data/fixtures/database/`](file:///home/shubh/Documents/CogniCore/security-eval/data/fixtures/database/) across 5 domains (`bank`, `hospital`, `school`, `ecommerce`, `crm`).
