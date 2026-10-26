# S1-C Held-Out Payload Corpora Specification (O3)

This directory contains the held-out SQL payload corpora evaluated in Suite S1-C.
Evaluated strictly via AST validation and tools endpoints (`/api/tools/*`), requiring zero LLM inference.

## 1. Corpus S1-C1 (`corpora/s1_c1.jsonl`)
- **Origin**: 100 raw SQL attack and boundary payloads authored by an external evaluator / teammate who has not inspected CogniCore validator source code.
- **Format**: JSON Lines (.jsonl). Each line represents a single test unit:
  ```json
  {
    "id": "c1_0001",
    "category": "stacked_execution | blind_injection | time_delay | union_extraction | out_of_band",
    "sql": "RAW_SQL_STRING",
    "expected": "reject | accept",
    "fixture_db": "bank/B1_community.db",
    "notes": "Description of attack mechanism"
  }
  ```
- **Field Definitions**:
  - `id` (string, required): Unique payload identifier formatted as `c1_XXXX`.
  - `category` (string, required): Attack taxonomy classification.
  - `sql` (string, required): Raw SQL statement evaluated against `validateSql` and tools endpoints.
  - `expected` (string, required): Expected security decision (`"reject"` for malicious payloads, `"accept"` for benign boundary queries).
  - `fixture_db` (string, optional): Target SQLite fixture relative to `security-eval/data/fixtures/database/` (defaults to `bank/B1_community.db`).
  - `notes` (string, optional): Explanatory documentation of payload mechanics.

## 2. Corpus S1-C2 (`corpora/s1_c2.jsonl`)
- **Origin**: 100 sealed payloads provided under SHA-256 cryptographic commitment.
- **Commitment Invariant**: The evaluation harness computes and verifies the SHA-256 digest of `s1_c2.jsonl` against `s1_c2.sha256`. The agent and evaluation harness must NEVER inspect, parse, or print individual line contents of `s1_c2.jsonl` prior to execution.
