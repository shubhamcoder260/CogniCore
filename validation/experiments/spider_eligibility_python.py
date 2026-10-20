import json
import sqlite3
from pathlib import Path

root = Path(r"C:\cognicore\validation_workspace")
candidate_file = root / "validation" / "data" / "spider" / "candidates.jsonl"
database_root = root / "spider_databases"
output_file = root / "validation" / "raw" / "spider_eligibility_python.jsonl"
row_cap = 1000

if output_file.exists():
    raise FileExistsError(f"Refusing to overwrite {output_file}")

candidates = []
with candidate_file.open("r", encoding="utf-8-sig") as f:
    for line_number, line in enumerate(f, 1):
        if not line.strip():
            raise ValueError(f"Blank candidate line: {line_number}")
        record = json.loads(line)
        record["candidate_position"] = line_number
        candidates.append(record)

results = []
seen_ids = set()

for c in candidates:
    result = {
        "candidate_position": c["candidate_position"],
        "id": c.get("id"),
        "db_id": c.get("db_id"),
        "status": "excluded",
        "reason": None,
        "gold_row_count": None,
        "gold_columns": None,
    }

    if not all(c.get(k) for k in ("id", "db_id", "question", "gold_sql")):
        result["reason"] = "missing_required_field"
    elif c["id"] in seen_ids:
        result["reason"] = "duplicate_candidate_id"
    else:
        seen_ids.add(c["id"])
        db_path = database_root / c["db_id"] / f'{c["db_id"]}.sqlite'

        if not db_path.is_file():
            result["reason"] = "database_file_missing"
        else:
            con = None
            try:
                uri = db_path.resolve().as_uri() + "?mode=ro"
                con = sqlite3.connect(uri, uri=True)
                con.execute("PRAGMA query_only=ON")

                sql = c["gold_sql"].strip().rstrip(";").strip()
                if not sql.upper().startswith(("SELECT", "WITH", "VALUES")):
                    raise ValueError("gold_sql_not_read_query")

                # The outer LIMIT detects results at the preregistered threshold.
                rows = con.execute(
                    f"SELECT * FROM ({sql}) AS __spider_gold LIMIT {row_cap + 1}"
                ).fetchmany(row_cap + 1)

                result["gold_row_count"] = len(rows)
                result["gold_columns"] = [
                    item[0] for item in con.execute(
                        f"SELECT * FROM ({sql}) AS __spider_gold LIMIT 0"
                    ).description
                ]

                if len(rows) >= row_cap:
                    result["reason"] = "gold_result_at_or_above_1000_rows"
                else:
                    result["status"] = "eligible"
            except Exception as exc:
                result["reason"] = (
                    "gold_sql_error: " + " ".join(str(exc).split())[:400]
                )
            finally:
                if con is not None:
                    con.close()

    results.append(result)

output_file.parent.mkdir(parents=True, exist_ok=True)
with output_file.open("x", encoding="utf-8", newline="\n") as f:
    for result in results:
        f.write(json.dumps(result, ensure_ascii=False) + "\n")
    f.flush()

counts = {
    "total": len(results),
    "eligible": sum(r["status"] == "eligible" for r in results),
    "excluded": sum(r["status"] != "eligible" for r in results),
    "sqlite_version": sqlite3.sqlite_version,
    "output": str(output_file),
}
print(json.dumps(counts, indent=2))
