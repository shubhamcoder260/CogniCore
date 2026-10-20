const fs = require('node:fs');
const path = require('node:path');
const Database = require('C:/cognicore/CogniCore/server/node_modules/better-sqlite3');

const root = process.cwd();
const candidatesPath = path.join(root, 'validation/data/spider/candidates.jsonl');
const databaseRoot = path.join(root, 'spider_databases');
const outputPath = path.join(root, 'validation/raw/spider_eligibility.jsonl');
const rowCap = 1000;

if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite ${outputPath}`);

const candidates = fs.readFileSync(candidatesPath, 'utf8')
  .split(/\r?\n/).filter(Boolean).map((line, i) => {
    try { return { ...JSON.parse(line), candidate_position: i + 1 }; }
    catch (e) { throw new Error(`Invalid candidate JSON at line ${i + 1}: ${e.message}`); }
  });

const output = [];
const counts = { total: candidates.length, eligible: 0, excluded: 0 };
const seenIds = new Set();

for (const c of candidates) {
  const record = {
    candidate_position: c.candidate_position,
    id: c.id,
    db_id: c.db_id,
    status: 'excluded',
    reason: null,
    gold_row_count: null,
    gold_columns: null
  };

  if (!c.id || !c.db_id || !c.question || !c.gold_sql) {
    record.reason = 'missing_required_field';
  } else if (seenIds.has(c.id)) {
    record.reason = 'duplicate_candidate_id';
  } else {
    seenIds.add(c.id);
    const dbPath = path.join(databaseRoot, c.db_id, `${c.db_id}.sqlite`);
    if (!fs.existsSync(dbPath)) {
      record.reason = 'database_file_missing';
    } else {
      let db;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        db.pragma('query_only = ON');
        const sql = c.gold_sql.trim().replace(/;\s*$/, '');
        if (!/^SELECT\b/i.test(sql) && !/^(WITH|VALUES)\b/i.test(sql)) {
          throw new Error('gold_sql_not_read_query');
        }

        // LIMIT is applied outside the reference query to avoid altering its meaning.
        const wrapped = `SELECT * FROM (${sql}) AS __spider_gold LIMIT ${rowCap + 1}`;
        const stmt = db.prepare(wrapped);
        const rows = stmt.all();
        const columns = stmt.columns().map(col => col.name);
        record.gold_row_count = rows.length;
        record.gold_columns = columns;

        if (rows.length >= rowCap) {
          record.reason = 'gold_result_at_or_above_1000_rows';
        } else {
          record.status = 'eligible';
          record.reason = null;
        }
      } catch (e) {
        record.reason = `gold_sql_error: ${String(e.message || e).replace(/\s+/g, ' ').slice(0, 400)}`;
      } finally {
        if (db) db.close();
      }
    }
  }

  if (record.status === 'eligible') counts.eligible++;
  else counts.excluded++;

  output.push(JSON.stringify(record));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const fd = fs.openSync(outputPath, 'wx');
try {
  fs.writeSync(fd, output.join('\n') + '\n');
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}

console.log(JSON.stringify({ ...counts, outputPath }, null, 2));
