"""
Phase B: Pre-Run Gold SQL Checks for Spider V1 Evaluation
Runs 330 gold queries across frozen_sample_300.jsonl and pilot.jsonl in Python sqlite3
and correlates with better-sqlite3 cross-check results.
Outputs:
- validation/data/spider/gold_results.jsonl
- validation/data/spider/gold_checks.jsonl
- validation/data/spider/gold_checks_summary.json
"""
import json
import os
import re
import time
import hashlib
import sqlite3
from pathlib import Path

def get_sha256(path_or_bytes):
    h = hashlib.sha256()
    if isinstance(path_or_bytes, (str, Path)):
        with open(path_or_bytes, 'rb') as f:
            while chunk := f.read(65536):
                h.update(chunk)
    else:
        h.update(path_or_bytes)
    return h.hexdigest().upper()

def classify_hardness(sql):
    sql_upper = sql.upper()
    joins = len(re.findall(r'\bJOIN\b', sql_upper))
    aggs = len(re.findall(r'\b(COUNT|SUM|AVG|MIN|MAX)\s*\(', sql_upper))
    subqueries = len(re.findall(r'\(\s*SELECT\b', sql_upper))
    set_ops = len(re.findall(r'\b(UNION|INTERSECT|EXCEPT)\b', sql_upper))

    if joins >= 3 or subqueries > 0 or set_ops > 0:
        return 'hard'
    elif joins == 0 and aggs <= 1 and subqueries == 0 and set_ops == 0:
        return 'easy'
    else:
        return 'medium'

def check_order_unique(sql, rows, col_names):
    depth = 0
    masked = []
    for ch in sql:
        if ch == '(':
            depth += 1
            masked.append(' ')
        elif ch == ')':
            depth -= 1
            masked.append(' ')
        else:
            masked.append(' ' if depth > 0 else ch)
    masked_str = ''.join(masked)
    m = re.search(r'\bORDER\s+BY\b(.*?)(?:\bLIMIT\b|$)', masked_str, re.IGNORECASE)
    if not m:
        return 0
    
    order_part = sql[m.start(1):m.end(1)].strip()
    keys = []
    curr = []
    d = 0
    for ch in order_part:
        if ch == '(':
            d += 1
            curr.append(ch)
        elif ch == ')':
            d -= 1
            curr.append(ch)
        elif ch == ',' and d == 0:
            keys.append(''.join(curr).strip())
            curr = []
        else:
            curr.append(ch)
    if curr:
        keys.append(''.join(curr).strip())
    
    clean_keys = []
    for k in keys:
        k_clean = re.sub(r'\s+(ASC|DESC)\s*$', '', k, flags=re.IGNORECASE).strip()
        clean_keys.append(k_clean)

    def norm(s):
        s = s.strip().lower()
        if '.' in s and not ('(' in s):
            s = s.split('.')[-1]
        return re.sub(r'\s+', '', s)

    norm_cols = [norm(c) for c in col_names]
    indices = []
    for k in clean_keys:
        nk = norm(k)
        if nk in norm_cols:
            indices.append(norm_cols.index(nk))
        else:
            return 0  # sort key is not in output columns

    if len(rows) <= 1:
        return 1

    for i in range(len(rows) - 1):
        k1 = tuple(rows[i][idx] for idx in indices)
        k2 = tuple(rows[i+1][idx] for idx in indices)
        if k1 == k2:
            return 0  # tie found in adjacent keys

    return 1

def run_phase_b():
    workspace_root = Path(os.environ.get('DATA_DIR', Path.cwd()))
    # Use relative paths from workspace root
    db_root = Path(os.environ.get('SPIDER_DB_DIR', Path.cwd() / 'spider_databases'))
    sample_file = Path.cwd() / 'validation/data/spider/frozen_sample_300.jsonl'
    pilot_file = Path.cwd() / 'validation/data/spider/pilot.jsonl'
    node_crosscheck_file = Path.cwd() / 'validation/raw/spider_node_gold_crosscheck.json'

    # Load node crosscheck
    with open(node_crosscheck_file, 'r', encoding='utf-8') as f:
        node_crosscheck = {item['id']: item for item in json.load(f)}

    # Load datasets
    with open(sample_file, 'r', encoding='utf-8') as f:
        sample_items = [json.loads(line) for line in f if line.strip()]
        for item in sample_items:
            item['split'] = 'test'

    with open(pilot_file, 'r', encoding='utf-8') as f:
        pilot_items = [json.loads(line) for line in f if line.strip()]
        for item in pilot_items:
            item['split'] = 'pilot'

    all_items = sample_items + pilot_items
    assert len(all_items) == 330, f'Expected 330 items, got {len(all_items)}'

    gold_results = []
    gold_checks = []

    con_cache = {}
    def get_con(db_id):
        if db_id not in con_cache:
            db_path = db_root / db_id / f'{db_id}.sqlite'
            uri = db_path.resolve().as_uri() + '?mode=ro'
            con = sqlite3.connect(uri, uri=True)
            con.execute('PRAGMA query_only=ON')
            con_cache[db_id] = con
        return con_cache[db_id]

    for item in all_items:
        qid = item['id']
        split = item['split']
        db_id = item['db_id']
        sql = item['gold_sql'].strip().rstrip(';')

        con = get_con(db_id)
        
        # Run 1
        t0 = time.perf_counter()
        cur1 = con.cursor()
        cur1.execute(sql)
        rows1 = cur1.fetchall()
        t1 = time.perf_counter()
        exec_ms = round((t1 - t0) * 1000, 3)
        cols = [d[0] for d in cur1.description] if cur1.description else []

        # Run 2
        cur2 = con.cursor()
        cur2.execute(sql)
        rows2 = cur2.fetchall()

        # Check determinism: multiset and row order
        is_det = (rows1 == rows2)
        assert is_det, f'Query {qid} non-deterministic between run 1 and run 2!'
        if split == 'test':
            assert len(rows1) < 1000, f'Query {qid} exceeded 1000 row cap ({len(rows1)} rows)!'

        # Compute result sha256
        res_bytes = json.dumps(rows1, default=str, ensure_ascii=False).encode('utf-8')
        res_sha256 = hashlib.sha256(res_bytes).hexdigest()

        # Gold result record
        gold_result = {
            'id': qid,
            'split': split,
            'db_id': db_id,
            'gold_sql': item['gold_sql'],
            'row_count': len(rows1),
            'result_sha256': res_sha256,
            'column_names': cols,
            'execution_time_ms': exec_ms,
            'is_deterministic': is_det,
        }
        gold_results.append(gold_result)

        # Node check correlation
        node_res = node_crosscheck.get(qid, {})
        dqs_incompatible = 1 if (not node_res.get('node_ok', False)) else 0

        # Hardness
        hardness = classify_hardness(item['gold_sql'])

        # Limit without order by
        has_limit = bool(re.search(r'\bLIMIT\b', item['gold_sql'], re.IGNORECASE))
        has_order = bool(re.search(r'\bORDER\s+BY\b', item['gold_sql'], re.IGNORECASE))
        limit_without_order_by = 1 if (has_limit and not has_order) else 0

        # Order unique
        order_unique = check_order_unique(item['gold_sql'], rows1, cols)

        gold_check = {
            'id': qid,
            'split': split,
            'db_id': db_id,
            'hardness': hardness,
            'dqs_incompatible': dqs_incompatible,
            'limit_without_order_by': limit_without_order_by,
            'order_unique': order_unique,
            'row_count': len(rows1),
            'is_deterministic': is_det,
        }
        gold_checks.append(gold_check)

    # Close connections
    for con in con_cache.values():
        con.close()

    # Save gold_results.jsonl
    out_results_path = Path.cwd() / 'validation/data/spider/gold_results.jsonl'
    with open(out_results_path, 'w', encoding='utf-8', newline='\n') as f:
        for r in gold_results:
            f.write(json.dumps(r, ensure_ascii=False) + '\n')

    # Save gold_checks.jsonl
    out_checks_path = Path.cwd() / 'validation/data/spider/gold_checks.jsonl'
    with open(out_checks_path, 'w', encoding='utf-8', newline='\n') as f:
        for c in gold_checks:
            f.write(json.dumps(c, ensure_ascii=False) + '\n')

    # Compute summary
    def make_split_summary(split_items):
        n = len(split_items)
        return {
            'count': n,
            'deterministic_count': sum(1 for x in split_items if x['is_deterministic']),
            'dqs_incompatible_count': sum(1 for x in split_items if x['dqs_incompatible'] == 1),
            'dqs_incompatible_pct': round(sum(1 for x in split_items if x['dqs_incompatible'] == 1) / n * 100, 2),
            'limit_without_order_by_count': sum(1 for x in split_items if x['limit_without_order_by'] == 1),
            'order_unique_count': sum(1 for x in split_items if x['order_unique'] == 1),
            'order_unique_pct': round(sum(1 for x in split_items if x['order_unique'] == 1) / n * 100, 2),
            'hardness': {
                'easy': sum(1 for x in split_items if x['hardness'] == 'easy'),
                'medium': sum(1 for x in split_items if x['hardness'] == 'medium'),
                'hard': sum(1 for x in split_items if x['hardness'] == 'hard'),
            }
        }

    summary = {
        'protocol': 'SPIDER-A3 Phase B Pre-Run Gold Checks',
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'total_queries_evaluated': len(gold_checks),
        'sqlite_version_python': sqlite3.sqlite_version,
        'overall': make_split_summary(gold_checks),
        'test_300': make_split_summary([x for x in gold_checks if x['split'] == 'test']),
        'pilot_30': make_split_summary([x for x in gold_checks if x['split'] == 'pilot']),
        'file_hashes': {
            'gold_results_jsonl': get_sha256(out_results_path),
            'gold_checks_jsonl': get_sha256(out_checks_path),
        }
    }

    out_summary_path = Path.cwd() / 'validation/data/spider/gold_checks_summary.json'
    with open(out_summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))

if __name__ == '__main__':
    run_phase_b()
