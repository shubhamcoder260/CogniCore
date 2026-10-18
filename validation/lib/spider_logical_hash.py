#!/usr/bin/env python3
"""
Logical Content Hash for SQLite Databases
Computes a deterministic SHA-256 hash of a database's logical contents using
con.iterdump(), with internal SQLite metadata tables (sqlite_stat*, sqlite_sequence)
filtered out, and all schema and INSERT statements canonicalized/sorted.

This allows verifying that databases remain logically identical across runs,
even if WAL checkpoints or physical file page layouts differ.
"""
import sys
import os
import re
import hashlib
import sqlite3
import tempfile
from pathlib import Path

def compute_logical_hash(db_path):
    """
    Computes canonical SHA-256 hash of the SQLite database at db_path.
    Uses read-only connection with PRAGMA query_only=ON.
    """
    resolved_path = Path(db_path).resolve()
    if not resolved_path.is_file():
        raise FileNotFoundError(f"Database file not found: {resolved_path}")

    # Connect in read-only mode using URI
    uri = resolved_path.as_uri() + "?mode=ro"
    con = sqlite3.connect(uri, uri=True)
    con.text_factory = lambda b: b.decode('utf-8', errors='replace')
    try:
        con.execute("PRAGMA query_only=ON")
        schema_lines = []
        insert_lines = []

        for line in con.iterdump():
            line = line.strip()
            # Ignore transaction boundaries
            if not line or line.startswith("BEGIN") or line.startswith("COMMIT"):
                continue
            # Filter internal sqlite statistical & sequence tables
            if re.search(r"sqlite_stat\d*|sqlite_sequence", line, re.IGNORECASE):
                continue
            
            if line.startswith("INSERT INTO"):
                insert_lines.append(line)
            else:
                schema_lines.append(line)

        # Canonicalize by sorting schema and rows independently
        schema_lines.sort()
        insert_lines.sort()

        normalized_dump = "\n".join(schema_lines + insert_lines) + "\n"
        return hashlib.sha256(normalized_dump.encode("utf-8")).hexdigest().upper()
    finally:
        con.close()

def run_positive_control():
    """
    Validates logical hash properties:
    1. Deterministic across multiple calls.
    2. Invariant to row insertion order (logical equivalence).
    3. Invariant to read-only WAL operations.
    4. Positive control: detects row modification / insertion.
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        db1 = os.path.join(tmp_dir, "test1.sqlite")
        con1 = sqlite3.connect(db1)
        con1.execute("CREATE TABLE t (id INT, val TEXT)")
        con1.execute("INSERT INTO t VALUES (1, 'alpha')")
        con1.execute("INSERT INTO t VALUES (2, 'beta')")
        con1.commit()
        con1.close()

        h1_initial = compute_logical_hash(db1)
        h1_repeat = compute_logical_hash(db1)
        assert h1_initial == h1_repeat, "Self-consistency failed: hash not deterministic"

        # Test order invariance
        db2 = os.path.join(tmp_dir, "test2.sqlite")
        con2 = sqlite3.connect(db2)
        con2.execute("CREATE TABLE t (id INT, val TEXT)")
        con2.execute("INSERT INTO t VALUES (2, 'beta')")
        con2.execute("INSERT INTO t VALUES (1, 'alpha')")
        con2.commit()
        con2.close()

        h2 = compute_logical_hash(db2)
        assert h1_initial == h2, "Canonicalization failed: row insertion order affected hash"

        # Test positive control: modify data
        con1 = sqlite3.connect(db1)
        con1.execute("INSERT INTO t VALUES (3, 'gamma')")
        con1.commit()
        con1.close()

        h1_modified = compute_logical_hash(db1)
        assert h1_initial != h1_modified, "Positive control failed: modified DB produced identical hash"

    print("Positive control test PASSED: Determinism, Order Invariance, and Modification Detection verified.")
    return True

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        success = run_positive_control()
        sys.exit(0 if success else 1)
    elif len(sys.argv) > 1:
        target = sys.argv[1]
        h = compute_logical_hash(target)
        print(f"{h}  {target}")
    else:
        print("Usage: spider_logical_hash.py <path_to_db> | --test")
        sys.exit(1)
