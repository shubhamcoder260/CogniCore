# CogniCore Security Evaluation — Phase 3 Evaluation Report
*Generated at: 2026-10-26T06:46:17.966Z*

## 1. Suite S1-A: In-Process Production Pipeline & Oracles
- **Evaluated Commit (Rung)**: `903c3c1`
- **Total Items Evaluated**: 100
- **Execution Duration**: 4.68s
- **Run Directory**: `/home/shubh/Documents/CogniCore/security-eval/runs/2026-10-26T06-44-19-116Z_s1_a_903c3c1`

### Outcome Distribution
| Outcome Category | Count | Proportion |
| :--- | :--- | :--- |
| **BLOCKED-SAFE** (Attacks thwarted before state mutation) | 100 | 100.00% |
| **ALLOWED-BENIGN** (Clean utility queries permitted) | 0 | 0.00% |
| **MUTATION-BYPASS** (State changed on production chain) | 0 | 0.00% |
| **CRASH-ERROR** (Unhandled errors or server crashes) | 0 | 0.00% |
| **95% One-Sided Upper Bound (Clopper-Pearson)** | **2.9513%** | — |

### First-Stop Attribution Breakdown
| First-Stop Attribution Code | Count | Share (%) | Originating Defense Layer |
| :--- | :--- | :--- | :--- |
| `VALIDATOR_BLOCKED` | 96 | 96.00% | Keyword/Pattern blacklist or structural literal check (sql.validator.js) |
| `PARSER_BLOCKED` | 4 | 4.00% | node-sql-parser syntax failure |
| `POLICY_BLOCKED` | 0 | 0.00% | data.policy.js column/system catalog denial |
| `DRIVER_BLOCKED` | 0 | 0.00% | sqlite.worker.js (readonly: true, query_only=ON) |
| `TIMEOUT_ABORTED` | 0 | 0.00% | sql.executor.js worker execution timeout |
| `EXECUTED_CLEAN` | 0 | 0.00% | Completed execution without error |
| `CRASH_ERROR` | 0 | 0.00% | Unhandled exception or crash |

## 2. Benign Construct Acceptance Evaluation
- **Total Benign Queries Evaluated**: 685
- **Total Accepted**: 610 (89.05%)
- **Total False-Positive Refusals**: 75 (10.95%)

### Top Constructs Performance
| Construct / Category | Total Items | Accepted | Rejected | Acceptance Rate ($EX$) |
| :--- | :--- | :--- | :--- | :--- |
| `single_table_select` | 15 | 15 | 0 | 100.0% |
| `aggregate_count` | 15 | 15 | 0 | 100.0% |
| `group_by_having` | 15 | 15 | 0 | 100.0% |
| `inner_join` | 15 | 15 | 0 | 100.0% |
| `left_join` | 15 | 15 | 0 | 100.0% |
| `three_table_join` | 15 | 15 | 0 | 100.0% |
| `nested_subquery_in` | 15 | 15 | 0 | 100.0% |
| `correlated_subquery` | 15 | 15 | 0 | 100.0% |
| `cte_basic` | 15 | 15 | 0 | 100.0% |
| `window_row_number` | 15 | 15 | 0 | 100.0% |
| `case_expression` | 15 | 15 | 0 | 100.0% |
| `distinct_like` | 15 | 15 | 0 | 100.0% |
| `literal_embedded_syntax` | 21 | 21 | 0 | 100.0% |
| `single_table_limit_order` | 19 | 19 | 0 | 100.0% |
| `strftime_date` | 30 | 30 | 0 | 100.0% |

## 3. Suite S1-C: Held-Out Corpora Status
- **S1-C1 (External Teammate Payloads)**: `PENDING_EXTERNAL_DELIVERY`
  *Note: Awaiting delivery of 100 raw SQL attack payloads from external teammate.*
- **S1-C2 (Cryptographic Commitment)**: `PENDING_SEALED_COMMITMENT`
  *Note: Awaiting placement of s1_c2.jsonl under sealed commitment.*
