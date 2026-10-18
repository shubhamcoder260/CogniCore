import hashlib
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

root = Path(r"C:\cognicore\validation_workspace")
dev_path = Path(r"C:\cognicore\spider_data\spider_data\spider_data\dev.json")
pool_order_path = root / "validation" / "data" / "spider" / "pool_order.json"
pilot_path = root / "validation" / "data" / "spider" / "pilot.jsonl"
candidates_path = root / "validation" / "data" / "spider" / "candidates.jsonl"
sample_a_path = root / "validation" / "data" / "spider" / "frozen_sample_300.jsonl"
db_root = root / "spider_databases"

sample_b_path = root / "validation" / "data" / "spider" / "frozen_sample_300_B.jsonl"
manifest_b_path = root / "validation" / "data" / "spider" / "frozen_sample_300_B_manifest.json"

for path in (dev_path, pool_order_path, pilot_path, candidates_path, sample_a_path, db_root):
    if not path.exists():
        raise FileNotFoundError(f"Required path missing: {path}")

for path in (sample_b_path, manifest_b_path):
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite existing: {path}")

def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest().upper()

def read_jsonl(path):
    records = []
    with path.open("r", encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records

pilot_records = read_jsonl(pilot_path)
candidate_records = read_jsonl(candidates_path)
sample_a_records = read_jsonl(sample_a_path)

pilot_ids = {r["id"] for r in pilot_records}
candidate_ids = {r["id"] for r in candidate_records}
sample_a_ids = {r["id"] for r in sample_a_records}

with open(dev_path, "r", encoding="utf-8") as f:
    dev = json.load(f)
with open(pool_order_path, "r", encoding="utf-8") as f:
    pool_order = json.load(f)

if len(pool_order) != 1034:
    raise ValueError(f"Expected 1034 questions in pool_order, got {len(pool_order)}")

# Indices 0..29 are pilot, 30..399 are candidates. Unused start at position 400 (0-indexed).
unused_indices = pool_order[400:]
if len(unused_indices) != 634:
    raise ValueError(f"Expected 634 unused indices, got {len(unused_indices)}")

con_cache = {}
def get_con(db_id):
    if db_id not in con_cache:
        db_path = db_root / db_id / f"{db_id}.sqlite"
        uri = db_path.resolve().as_uri() + "?mode=ro"
        con = sqlite3.connect(uri, uri=True)
        con.execute("PRAGMA query_only=ON")
        con_cache[db_id] = con
    return con_cache[db_id]

eligible = []
excluded = []

for pos_offset, idx in enumerate(unused_indices, 1):
    pool_pos = 400 + pos_offset # 1-based position in pool_order
    item = dev[idx]
    qid = f"spider-dev-{idx}"
    db_id = item["db_id"]
    question = item["question"]
    sql = item["query"].strip().rstrip(";").strip()

    # Rule 1: No LIMIT without ORDER BY
    has_limit = bool(re.search(r"\bLIMIT\b", sql, re.IGNORECASE))
    has_order = bool(re.search(r"\bORDER\s+BY\b", sql, re.IGNORECASE))
    if has_limit and not has_order:
        excluded.append({"pool_position": pool_pos, "id": qid, "db_id": db_id, "reason": "limit_without_order_by"})
        continue

    # Rule 2: Database file exists
    db_file = db_root / db_id / f"{db_id}.sqlite"
    if not db_file.is_file():
        excluded.append({"pool_position": pool_pos, "id": qid, "db_id": db_id, "reason": "database_file_missing"})
        continue

    # Rule 3: Gold query executes twice identically in Python read-only, < 1,000 rows
    con = get_con(db_id)
    try:
        cur1 = con.cursor()
        cur1.execute(sql)
        rows1 = cur1.fetchall()
        cols = [d[0] for d in cur1.description] if cur1.description else []

        cur2 = con.cursor()
        cur2.execute(sql)
        rows2 = cur2.fetchall()

        if rows1 != rows2:
            excluded.append({"pool_position": pool_pos, "id": qid, "db_id": db_id, "reason": "non_deterministic"})
            continue

        if len(rows1) >= 1000:
            excluded.append({"pool_position": pool_pos, "id": qid, "db_id": db_id, "reason": "gold_result_at_or_above_1000_rows"})
            continue

        eligible.append({
            "id": qid,
            "db_id": db_id,
            "question": question,
            "gold_sql": item["query"],
            "pool_position": pool_pos,
            "eligibility_status": "eligible",
            "gold_row_count": len(rows1),
            "gold_columns": cols,
        })
    except Exception as exc:
        clean_err = " ".join(str(exc).split())[:400]
        excluded.append({"pool_position": pool_pos, "id": qid, "db_id": db_id, "reason": f"gold_sql_error: {clean_err}"})

print(f"Total evaluated from unused pool: {len(unused_indices)}")
print(f"Eligible count: {len(eligible)}, Excluded count: {len(excluded)}")

if len(eligible) < 300:
    raise RuntimeError(f"Fewer than 300 eligible items ({len(eligible)}); cannot freeze Sample B.")

selected = eligible[:300]
selected_ids = {r["id"] for r in selected}

# Overlap checks
overlap_pilot = selected_ids.intersection(pilot_ids)
overlap_candidates = selected_ids.intersection(candidate_ids)
overlap_sample_a = selected_ids.intersection(sample_a_ids)

if overlap_pilot:
    raise RuntimeError(f"Sample B overlaps with pilot: {overlap_pilot}")
if overlap_candidates:
    raise RuntimeError(f"Sample B overlaps with candidates: {overlap_candidates}")
if overlap_sample_a:
    raise RuntimeError(f"Sample B overlaps with Sample A: {overlap_sample_a}")

sample_b_bytes = (
    "".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n"
            for r in selected)
).encode("utf-8")

sample_b_sha256 = hashlib.sha256(sample_b_bytes).hexdigest().upper()

manifest_b = {
    "protocol": "SPIDER-B1",
    "status": "FROZEN_BEFORE_MODEL_EVALUATION",
    "purpose": "Held-out post-fix confirmation on questions never inspected; no model call; outcomes of sample A not consulted",
    "selection_rule": "First 300 eligible questions from unused indices (positions 401..1034 in pool_order.json)",
    "unused_pool_size": len(unused_indices),
    "eligible_pool_size": len(eligible),
    "excluded_pool_size": len(excluded),
    "selected_count": len(selected),
    "first_selected_pool_position": selected[0]["pool_position"],
    "last_selected_pool_position": selected[-1]["pool_position"],
    "selected_database_count": len({r["db_id"] for r in selected}),
    "selected_database_counts": dict(sorted(Counter(r["db_id"] for r in selected).items())),
    "excluded_records": excluded[:len(excluded)],
    "sample_file": sample_b_path.name,
    "sample_sha256": sample_b_sha256,
    "overlap_pilot_count": len(overlap_pilot),
    "overlap_candidates_count": len(overlap_candidates),
    "overlap_sample_a_count": len(overlap_sample_a),
    "model_calls_performed": 0
}

manifest_b_bytes = (
    json.dumps(manifest_b, indent=2, ensure_ascii=False) + "\n"
).encode("utf-8")

with sample_b_path.open("xb") as f:
    f.write(sample_b_bytes)
    f.flush()

with manifest_b_path.open("xb") as f:
    f.write(manifest_b_bytes)
    f.flush()

# Verification
if sha256(sample_b_path) != sample_b_sha256:
    raise RuntimeError("Persisted sample B hash mismatch.")
persisted = read_jsonl(sample_b_path)
if len(persisted) != 300:
    raise RuntimeError(f"Sample B does not contain exactly 300 records (got {len(persisted)}).")
if len({r["id"] for r in persisted}) != 300:
    raise RuntimeError("Sample B contains duplicate IDs.")

print(json.dumps({
    "status": "PASS_FROZEN_SAMPLE_B",
    "selected": len(persisted),
    "first_pool_pos": persisted[0]["pool_position"],
    "last_pool_pos": persisted[-1]["pool_position"],
    "sample_b_sha256": sha256(sample_b_path),
    "manifest_b_sha256": sha256(manifest_b_path),
    "sample_b_path": str(sample_b_path),
    "manifest_b_path": str(manifest_b_path),
    "overlap_pilot": len(overlap_pilot),
    "overlap_candidates": len(overlap_candidates),
    "overlap_sample_a": len(overlap_sample_a),
    "model_calls": 0
}, indent=2))
