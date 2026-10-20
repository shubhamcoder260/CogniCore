import hashlib
import json
import re
from collections import Counter
from pathlib import Path

root = Path(r"C:\cognicore\validation_workspace")
candidate_path = root / "validation/data/spider/candidates.jsonl"
eligibility_path = root / "validation/raw/spider_eligibility_python.jsonl"
protocol_path = root / "validation/PREREG_AMENDMENTS.md"
stats_path = root / "validation/lib/stats.js"
script_path = root / "validation/experiments/freeze_spider_sample.py"
sample_path = root / "validation/data/spider/frozen_sample_300.jsonl"
manifest_path = root / "validation/data/spider/frozen_sample_300_manifest.json"

for path in (candidate_path, eligibility_path, protocol_path, stats_path, script_path):
    if not path.is_file():
        raise FileNotFoundError(path)

for path in (sample_path, manifest_path):
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite: {path}")

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().upper()

def read_jsonl(path):
    records = []
    with path.open("r", encoding="utf-8-sig") as f:
        for n, line in enumerate(f, 1):
            if not line.strip():
                raise ValueError(f"Blank line in {path}, line {n}")
            records.append(json.loads(line))
    return records

protocol = protocol_path.read_text(encoding="utf-8-sig")
stats_hash = sha256(stats_path)
marker = "SPIDER-A2: Frozen Bootstrap Implementation"

if marker not in protocol:
    raise ValueError("Bootstrap amendment is missing from preregistration.")

hash_matches = re.findall(
    r"Implementation SHA-256 at freeze time:\s*([A-Fa-f0-9]{64})",
    protocol
)
if not hash_matches or hash_matches[-1].upper() != stats_hash:
    raise ValueError("Statistics helper hash does not match preregistration.")

candidates = read_jsonl(candidate_path)
eligibility = read_jsonl(eligibility_path)

if len(candidates) != 370 or len(eligibility) != 370:
    raise ValueError(
        f"Expected 370 candidates and eligibility records; "
        f"found {len(candidates)} and {len(eligibility)}."
    )

candidate_ids = [c.get("id") for c in candidates]
if len(set(candidate_ids)) != 370 or any(not x for x in candidate_ids):
    raise ValueError("Candidate IDs are missing or duplicated.")

if len({e.get("candidate_position") for e in eligibility}) != 370:
    raise ValueError("Eligibility positions are missing or duplicated.")

by_position = {e["candidate_position"]: e for e in eligibility}
joined = []

for position, candidate in enumerate(candidates, 1):
    e = by_position.get(position)
    if e is None:
        raise ValueError(f"Missing eligibility record at position {position}.")
    if e.get("id") != candidate.get("id") or e.get("db_id") != candidate.get("db_id"):
        raise ValueError(f"Candidate/eligibility mismatch at position {position}.")
    if not all(candidate.get(k) for k in ("id", "db_id", "question", "gold_sql")):
        raise ValueError(f"Required candidate field missing at position {position}.")
    joined.append((position, candidate, e))

eligible = [(p, c, e) for p, c, e in joined if e.get("status") == "eligible"]
excluded = [(p, c, e) for p, c, e in joined if e.get("status") != "eligible"]

if len(eligible) != 366 or len(excluded) != 4:
    raise ValueError(f"Unexpected eligibility totals: {len(eligible)} eligible, {len(excluded)} excluded.")

if any(e.get("reason") != "gold_result_at_or_above_1000_rows" for _, _, e in excluded):
    raise ValueError("Unexpected exclusion reason; do not freeze this sample.")

selected = eligible[:300]
if len(selected) != 300:
    raise ValueError("Fewer than 300 eligible candidates; refusing to freeze.")

sample_records = []
for position, candidate, e in selected:
    record = dict(candidate)
    record["candidate_position"] = position
    record["eligibility_status"] = e["status"]
    record["gold_row_count"] = e.get("gold_row_count")
    record["gold_columns"] = e.get("gold_columns")
    sample_records.append(record)

sample_bytes = (
    "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n"
            for r in sample_records)
).encode("utf-8")

manifest = {
    "protocol": "SPIDER-A1 / SPIDER-A2",
    "status": "FROZEN_BEFORE_MODEL_EVALUATION",
    "selection_rule": "First 300 eligible candidates in original candidates.jsonl order",
    "candidate_pool_size": len(candidates),
    "eligible_pool_size": len(eligible),
    "excluded_pool_size": len(excluded),
    "selected_count": len(sample_records),
    "first_selected_position": selected[0][0],
    "last_selected_position": selected[-1][0],
    "selected_database_count": len({c["db_id"] for _, c, _ in selected}),
    "selected_database_counts": dict(sorted(Counter(c["db_id"] for _, c, _ in selected).items())),
    "excluded_records": [
        {"candidate_position": p, "id": c["id"], "db_id": c["db_id"], "reason": e["reason"]}
        for p, c, e in excluded
    ],
    "bootstrap": {
        "implementation": "validation/lib/stats.js:clusterBootstrap",
        "replicates": 10000,
        "seed": 20261015,
        "stats_helper_sha256": stats_hash
    },
    "input_sha256": {
        "candidates.jsonl": sha256(candidate_path),
        "spider_eligibility_python.jsonl": sha256(eligibility_path),
        "PREREG_AMENDMENTS.md": sha256(protocol_path),
        "stats.js": stats_hash,
        "freeze_spider_sample.py": sha256(script_path)
    },
    "sample_file": sample_path.name,
    "sample_sha256": hashlib.sha256(sample_bytes).hexdigest().upper(),
    "model_calls_performed_by_freeze_script": 0
}

manifest_bytes = (
    json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
).encode("utf-8")

# Exclusive creation prevents overwriting. If either creation fails, stop and
# preserve any already-created artifact for inspection rather than retrying blindly.
with sample_path.open("xb") as f:
    f.write(sample_bytes)
    f.flush()

with manifest_path.open("xb") as f:
    f.write(manifest_bytes)
    f.flush()

# Re-read and verify the persisted artifacts.
if sha256(sample_path) != manifest["sample_sha256"]:
    raise RuntimeError("Persisted sample hash mismatch.")
persisted = read_jsonl(sample_path)
if len(persisted) != 300:
    raise RuntimeError("Persisted sample does not contain exactly 300 records.")
if [r["candidate_position"] for r in persisted] != [p for p, _, _ in selected]:
    raise RuntimeError("Persisted sample ordering mismatch.")
if len({r["id"] for r in persisted}) != 300:
    raise RuntimeError("Persisted sample contains duplicate IDs.")

print(json.dumps({
    "status": "PASS_FROZEN",
    "selected": len(persisted),
    "eligible_pool": len(eligible),
    "excluded": len(excluded),
    "first_position": persisted[0]["candidate_position"],
    "last_position": persisted[-1]["candidate_position"],
    "sample_sha256": sha256(sample_path),
    "manifest_sha256": sha256(manifest_path),
    "sample_path": str(sample_path),
    "manifest_path": str(manifest_path),
    "model_calls": 0
}, indent=2))
