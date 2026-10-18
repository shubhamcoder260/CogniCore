from pathlib import Path

content = """
## Amendment SPIDER-B1: Secondary Held-Out Validation Sample B

### 1. Purpose and Protocol Integrity
- **Purpose:** Post-fix confirmation on questions never inspected, tuned upon, or executed with any model.
- **Independence:** Sample B was constructed after Sample A's initial evaluation run was completed, but strictly BEFORE any item-level inspection was performed for the post-run audit. The item-level outcomes of Sample A were not consulted or used in defining Sample B.
- **Model Invariance:** Zero model calls have been performed on Sample B.
- **Sampling Specification:**
  - Selected strictly from the remaining unused indices (positions 401 through 1034) of the pre-committed deterministic permutation `validation/data/spider/pool_order.json` (PREREG-A1).
  - Applied the identical preregistered eligibility rules:
    1. Gold query executes deterministically across two successive runs in Python SQLite read-only mode (`PRAGMA query_only=ON`).
    2. Gold query returns strictly fewer than 1,000 rows.
    3. Gold query contains no `LIMIT` clause without an accompanying `ORDER BY` clause.
    4. Database file exists and resolves cleanly.
  - The first 300 eligible items in original `pool_order.json` sequence form Sample B (`frozen_sample_300_B.jsonl`).
- **Disjoint Partitioning:**
  - Pilot items: pool positions 1..30 (0 overlap).
  - Candidates / Sample A pool: pool positions 31..400 (0 overlap).
  - Sample B: pool positions 401..704 (300 eligible items; 4 excluded items in span; 0 overlap with Pilot, Candidates, or Sample A).
- **Cryptographic Anchors:**
  - `frozen_sample_300_B.jsonl` SHA-256: `D1A35A18559C06393C1A36046674E619AB0B6604428E96BFAF5DBA80940D3B09`
  - `frozen_sample_300_B_manifest.json` SHA-256: `5CE0C368DDDE958634DAD694112D89CB2AE367AA2C3316CF8F9E581F8C759CB2`
"""

p = Path("validation/PREREG_AMENDMENTS.md")
with p.open("a", encoding="utf-8") as f:
    f.write(content)
print("SPIDER-B1 appended successfully.")
