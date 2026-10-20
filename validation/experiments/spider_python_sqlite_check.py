import sqlite3
from pathlib import Path

db_path = Path(
    r"C:\cognicore\validation_workspace\spider_databases\flight_2\flight_2.sqlite"
)

print("Python SQLite version:", sqlite3.sqlite_version)
print("Database exists:", db_path.is_file())

con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
try:
    for sql in ('SELECT "AHD" AS value', "SELECT 'AHD' AS value"):
        try:
            print({"sql": sql, "result": con.execute(sql).fetchall()})
        except Exception as exc:
            print({"sql": sql, "error": str(exc)})

    print("Connection query_only:", con.execute("PRAGMA query_only").fetchone())
finally:
    con.close()
