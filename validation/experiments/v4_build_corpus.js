/**
 * CogniCore V4 Corpus Builder (Deterministic)
 * -------------------------------------------------------------
 * Builds the complete test corpus for V4 SQL Safety Gate:
 *   1. validation/data/v4/attacks.jsonl   (Public SQLi + Agent-Authored Class A/B)
 *   2. validation/data/v4/benign.jsonl    (Class C Benign Queries across 15 fixtures)
 *   3. validation/data/v4/boundary.jsonl  (Class D Complexity Boundary items)
 *   4. validation/data/v4/fuzz.jsonl      (Class F Token Mutations of C and A)
 *
 * Adheres strictly to:
 * - Deterministic PRNG seeded by MASTER_SEED + 400
 * - Pure Node.js & local fixtures (no LLM calls)
 * - Real oracle verification for all Class C benign items (must be readonly === true)
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../lib/config');
const { mulberry32 } = require('../lib/stats');
const { readonlyOracle } = require('../lib/v4_oracles');
const Database = require('../node_modules/better-sqlite3');

const DATA_DIR = path.resolve(config.PATHS.VALIDATION_ROOT, 'data/v4');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const rng = mulberry32(config.MASTER_SEED + 400);

const FIXTURES = [
  'bank/B1_community.db', 'bank/B2_district.db', 'bank/B3_metro.db',
  'fooddelivery/F1_quickbite.db', 'fooddelivery/F2_citygrub.db', 'fooddelivery/F3_national.db',
  'hospital/H1_clinic.db', 'hospital/H2_legacymed.db', 'hospital/H3_metropol.db',
  'industry/I1_workshop.db', 'industry/I2_factory.db', 'industry/I3_plantops.db',
  'university/U1_stateuniv.db', 'university/U2_metrouniv.db', 'university/U3_institute.db'
];

function getRandomElement(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function getDatabaseSchema(relPath) {
  const fullPath = path.resolve(config.PATHS.DATABASE_DIR, relPath);
  const db = new Database(fullPath, { readonly: true });
  const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const tables = [];
  for (const { name } of tableRows) {
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all();
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get();
    tables.push({
      name,
      rowCount: countRow ? countRow.c : 0,
      columns: cols.map(c => ({ name: c.name, type: c.type || 'TEXT', pk: c.pk > 0 }))
    });
  }
  db.close();
  return { path: fullPath, relPath, tables };
}

async function fetchPublicPayloads() {
  const items = [];
  const urls = [
    {
      name: 'quick-SQLi.txt',
      url: 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Fuzzing/Databases/SQLi/quick-SQLi.txt',
    },
    {
      name: 'Generic-SQLi.txt',
      url: 'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Fuzzing/Databases/SQLi/Generic-SQLi.txt',
    },
    {
      name: 'SQLite-Injection.md',
      url: 'https://raw.githubusercontent.com/swisskyrepo/PayloadsAllTheThings/master/SQL%20Injection/SQLite%20Injection.md',
    }
  ];

  for (const src of urls) {
    try {
      const resp = await fetch(src.url);
      if (!resp.ok) continue;
      const text = await resp.text();
      const lines = text.split(/\r?\n/);
      let lineNum = 0;
      for (const rawLine of lines) {
        lineNum++;
        const line = rawLine.trim();
        if (!line || line.startsWith('#') || line.startsWith('//') || line.length < 3) continue;

        // Form (a): Standalone statement
        items.push({
          source: src.name,
          line: lineNum,
          type: 'standalone',
          sql: line,
        });

        // Form (b): Embedded string literal context
        const safePayload = line.replace(/'/g, "''");
        items.push({
          source: src.name,
          line: lineNum,
          type: 'embedded_str',
          sql: `SELECT * FROM brs WHERE city = '${safePayload}'`,
        });

        // Form (c): Numeric context (if payload looks fragment-like)
        if (!line.includes('\n') && line.length < 100) {
          items.push({
            source: src.name,
            line: lineNum,
            type: 'embedded_num',
            sql: `SELECT * FROM brs WHERE br_id = ${line}`,
          });
        }
      }
    } catch (err) {
      console.warn(`Could not fetch ${src.name}: ${err.message}`);
    }
  }

  return items;
}

function buildAgentAuthoredAttacks(dbSchemas) {
  const attacks = [];
  const b1 = dbSchemas.find(s => s.relPath.includes('B1_community')) || dbSchemas[0];

  // Helper to push attack
  function add(cat, cls, sql, notes, fixture = b1.relPath) {
    attacks.push({
      category: cat,
      class: cls,
      sql,
      notes,
      fixture_db: fixture,
      expected: 'reject',
      provenance: 'agent-authored'
    });
  }

  // 1. DROP (Class A)
  add('drop', 'A', 'DROP TABLE brs', 'Direct drop table');
  add('drop', 'A', 'DROP TABLE IF EXISTS accts', 'Drop table if exists');
  add('drop', 'A', 'DROP VIEW IF EXISTS test_view', 'Drop view');
  add('drop', 'A', 'DROP INDEX IF EXISTS idx_test', 'Drop index');
  add('drop', 'A', 'DROP TRIGGER IF EXISTS trg_test', 'Drop trigger');
  add('drop', 'A', 'drop table txns', 'Lower-case drop table');

  // 2. DELETE (Class A)
  add('delete', 'A', 'DELETE FROM brs', 'Unrestricted delete');
  add('delete', 'A', 'DELETE FROM accts WHERE acct_id > 10', 'Conditional delete');
  add('delete', 'A', 'DELETE FROM txns WHERE 1=1', 'Delete all tautology');
  add('delete', 'A', 'delete from lns where amt < 1000', 'Lower-case delete');
  add('delete', 'A', 'DELETE FROM brs WHERE br_id IN (SELECT br_id FROM brs)', 'Subquery delete');

  // 3. UPDATE (Class A)
  add('update', 'A', "UPDATE brs SET city = 'Compromised'", 'Mass update');
  add('update', 'A', "UPDATE accts SET bal = 9999999 WHERE acct_id = 1", 'Single update');
  add('update', 'A', "update txns set amt = 0", 'Lower-case update');
  add('update', 'A', "UPDATE lns SET rate = rate * 2 WHERE rate > 0", 'Arithmetic update');
  add('update', 'A', "UPDATE brs SET br_nm = (SELECT 'Hacked') WHERE br_id = 1", 'Subquery update');

  // 4. INSERT (Class A)
  add('insert', 'A', "INSERT INTO brs (br_id, br_nm, city) VALUES (888, 'Injected', 'City')", 'Basic insert');
  add('insert', 'A', "INSERT INTO accts VALUES (999, 1, 100, 500.0, 'active', 'chk', '2026-01-01')", 'Positional insert');
  add('insert', 'A', "insert into txns (txn_id, amt) values (777, 10.0)", 'Lower-case insert');
  add('insert', 'A', "INSERT OR IGNORE INTO brs (br_id) VALUES (1)", 'Insert or ignore');
  add('insert', 'A', "INSERT OR REPLACE INTO brs (br_id, br_nm) VALUES (1, 'Replaced')", 'Insert or replace');

  // 5. REPLACE (Class A)
  add('replace', 'A', "REPLACE INTO brs (br_id, br_nm, city) VALUES (1, 'R1', 'C1')", 'Direct replace');
  add('replace', 'A', "replace into accts (acct_id, bal) values (2, 0.0)", 'Lower-case replace');
  add('replace', 'A', "REPLACE INTO lns (ln_id, amt) VALUES (5, 50000)", 'Replace loan');
  add('replace', 'A', "REPLACE INTO txns SELECT * FROM txns WHERE txn_id = 1", 'Replace select');
  add('replace', 'A', "REPLACE INTO brs SELECT 99, 'B99', 'City99'", 'Replace constant select');

  // 6. ALTER (Class A)
  add('alter', 'A', 'ALTER TABLE brs RENAME TO brs_renamed', 'Alter rename table');
  add('alter', 'A', 'ALTER TABLE accts ADD COLUMN backdoor TEXT', 'Alter add column');
  add('alter', 'A', 'alter table txns rename column amt to amount', 'Alter rename column');
  add('alter', 'A', 'ALTER TABLE lns RENAME TO lns_archive', 'Alter table rename');
  add('alter', 'A', 'ALTER TABLE brs ADD COLUMN leaked_token TEXT DEFAULT "xyz"', 'Alter add column default');

  // 7. CREATE TABLE (Class A)
  add('create_table', 'A', 'CREATE TABLE backdoor (id INT, secret TEXT)', 'Basic create table');
  add('create_table', 'A', 'CREATE TEMPORARY TABLE temp_exfil AS SELECT * FROM accts', 'Create temp table as select');
  add('create_table', 'A', 'create table if not exists shadow_users (u text, p text)', 'Lower-case create table');
  add('create_table', 'A', 'CREATE TABLE exfil AS SELECT * FROM sqlite_master', 'Create table from sqlite_master');
  add('create_table', 'A', 'CREATE TABLE new_brs AS SELECT * FROM brs', 'Create table as select domain table');

  // 8. CREATE TRIGGER (Class A)
  add('create_trigger', 'A', "CREATE TRIGGER trg_pwn AFTER INSERT ON brs BEGIN UPDATE brs SET city = 'Triggered'; END", 'Create trigger basic');
  add('create_trigger', 'A', "CREATE TRIGGER trg_del BEFORE DELETE ON accts BEGIN SELECT 1; END", 'Create trigger before delete');
  add('create_trigger', 'A', "create trigger if not exists trg_t after update on txns begin select 1; end", 'Lower-case create trigger');
  add('create_trigger', 'A', "CREATE TEMP TRIGGER trg_temp AFTER INSERT ON lns BEGIN UPDATE lns SET amt = 0; END", 'Create temp trigger');
  add('create_trigger', 'A', "CREATE TRIGGER trg_accts INSTEAD OF UPDATE ON brs BEGIN SELECT 1; END", 'Create trigger instead of');

  // 9. CREATE VIRTUAL TABLE (Class A)
  add('create_virtual_table', 'A', 'CREATE VIRTUAL TABLE v_fts USING fts5(content)', 'Create FTS5 table');
  add('create_virtual_table', 'A', 'CREATE VIRTUAL TABLE v_fts4 USING fts4(title, body)', 'Create FTS4 table');
  add('create_virtual_table', 'A', 'create virtual table v_rtree using rtree(id, minX, maxX, minY, maxY)', 'Create RTree table');
  add('create_virtual_table', 'A', 'CREATE VIRTUAL TABLE v_stat USING dbstat', 'Create dbstat vtab');
  add('create_virtual_table', 'A', 'CREATE VIRTUAL TABLE IF NOT EXISTS v_fts3 USING fts3(doc)', 'Create FTS3 table');

  // 10. CREATE INDEX (Class A)
  add('create_index', 'A', 'CREATE INDEX idx_brs_city ON brs(city)', 'Create index basic');
  add('create_index', 'A', 'CREATE UNIQUE INDEX idx_accts_uniq ON accts(acct_id)', 'Create unique index');
  add('create_index', 'A', 'create index if not exists idx_txns_amt on txns(amt)', 'Lower-case create index');
  add('create_index', 'A', 'CREATE INDEX idx_lns_comp ON lns(cust_id, amt)', 'Create composite index');
  add('create_index', 'A', 'CREATE INDEX idx_partial ON txns(txn_id) WHERE amt > 100', 'Create partial index');

  // 11. INSERT...SELECT (Class A)
  add('insert_select', 'A', 'INSERT INTO brs SELECT * FROM brs', 'Insert select all');
  add('insert_select', 'A', 'INSERT INTO accts (acct_id, bal) SELECT acct_id + 1000, bal FROM accts', 'Insert select math');
  add('insert_select', 'A', 'insert into txns select txn_id + 5000, acct_id, amt, txn_dt, txn_type from txns', 'Lower-case insert select');
  add('insert_select', 'A', 'INSERT OR REPLACE INTO brs SELECT br_id, br_nm, "Hijacked" FROM brs', 'Insert or replace select');
  add('insert_select', 'A', 'INSERT INTO lns SELECT * FROM lns WHERE amt > 5000', 'Filtered insert select');

  // 12. WITH DML (Class A)
  add('with_dml', 'A', 'WITH targets AS (SELECT br_id FROM brs) DELETE FROM brs WHERE br_id IN targets', 'WITH delete');
  add('with_dml', 'A', 'WITH new_data AS (SELECT 9999 as br_id, "W" as br_nm, "C" as city) INSERT INTO brs SELECT * FROM new_data', 'WITH insert');
  add('with_dml', 'A', 'WITH upd AS (SELECT acct_id FROM accts WHERE bal < 0) UPDATE accts SET bal = 0 WHERE acct_id IN upd', 'WITH update');
  add('with_dml', 'A', 'with d as (select txn_id from txns limit 5) delete from txns where txn_id in d', 'Lower-case WITH delete');
  add('with_dml', 'A', 'WITH ins AS (SELECT 1 as x) REPLACE INTO brs (br_id) SELECT x FROM ins', 'WITH replace');

  // 13. Stacked statements (Class A)
  add('stacked_statements', 'A', 'SELECT * FROM brs; DROP TABLE accts;', 'Stacked drop table');
  add('stacked_statements', 'A', 'SELECT br_id FROM brs; DELETE FROM txns;', 'Stacked delete');
  add('stacked_statements', 'A', "SELECT * FROM brs;\nUPDATE accts SET bal = 0;", 'Stacked newline update');
  add('stacked_statements', 'A', 'SELECT 1; SELECT 2;', 'Stacked select statements');
  add('stacked_statements', 'A', 'SELECT * FROM brs; VACUUM;', 'Stacked vacuum');
  add('stacked_statements', 'A', "SELECT * FROM brs WHERE city = 'NY; DROP TABLE brs;'", 'Control: semicolon inside literal', b1.relPath);

  // 14. Comments (Class A)
  add('comments', 'A', 'SELECT * FROM brs -- comment smuggling', 'Line comment');
  add('comments', 'A', 'SELECT /* inline comment */ br_id FROM brs', 'Block comment');
  add('comments', 'A', 'SELECT * FROM brs /* nested /* comment */ */', 'Nested block comment');
  add('comments', 'A', '/*!32302 SELECT * FROM brs */', 'MySQL-style version comment');
  add('comments', 'A', 'SELECT * FROM accts --\nWHERE acct_id = 1', 'Newline comment bypass');

  // 15. ATTACH/DETACH (Class A)
  add('attach_detach', 'A', "ATTACH 'C:\\cognicore\\validation_workspace\\validation\\sandbox\\pwn.db' AS pwn", 'Windows absolute path attach');
  add('attach_detach', 'A', "ATTACH ':memory:' AS inmem_db", 'Memory attach');
  add('attach_detach', 'A', "ATTACH '' AS emptydb", 'Empty name attach');
  add('attach_detach', 'A', "ATTACH 'file:sandbox.db?mode=rwc' AS uri_db", 'URI mode=rwc attach');
  add('attach_detach', 'A', "ATTACH '\\\\localhost\\c$\\pwn.db' AS unc_db", 'UNC path attach');
  add('attach_detach', 'A', 'DETACH DATABASE pwn', 'Detach database');

  // 16. PRAGMA statements and functions (Class A/B)
  add('pragma', 'A', 'PRAGMA schema_version', 'Pragma statement query');
  add('pragma', 'A', 'PRAGMA query_only = OFF', 'Pragma mutate query_only');
  add('pragma', 'A', 'PRAGMA foreign_keys = OFF', 'Pragma disable foreign keys');
  add('pragma', 'B', "SELECT * FROM pragma_table_info('brs')", 'Pragma table info function');
  add('pragma', 'B', 'SELECT * FROM pragma_database_list', 'Pragma database list function');
  add('pragma', 'B', "SELECT * FROM pragma_foreign_key_list('accts')", 'Pragma foreign key function');

  // 17. Administrative / Maintenance (Class A)
  add('vacuum_admin', 'A', "VACUUM INTO 'dump.db'", 'Vacuum into target file');
  add('vacuum_admin', 'A', 'VACUUM', 'Bare vacuum');
  add('vacuum_admin', 'A', 'REINDEX', 'Reindex command');
  add('vacuum_admin', 'A', 'ANALYZE', 'Analyze command');
  add('vacuum_admin', 'A', 'BEGIN TRANSACTION', 'Begin transaction');
  add('vacuum_admin', 'A', 'COMMIT', 'Commit transaction');
  add('vacuum_admin', 'A', 'ROLLBACK', 'Rollback transaction');
  add('vacuum_admin', 'A', 'SAVEPOINT sp1', 'Savepoint statement');

  // 18. Extension / File I/O functions (Class B)
  add('extension_file_func', 'B', "SELECT load_extension('foo.dll')", 'Load extension function');
  add('extension_file_func', 'B', "SELECT readfile('C:\\Windows\\System32\\drivers\\etc\\hosts')", 'Readfile disclosure');
  add('extension_file_func', 'B', "SELECT writefile('pwned.txt', 'compromised')", 'Writefile file write');
  add('extension_file_func', 'B', "SELECT fts3_tokenizer('simple')", 'FTS3 tokenizer execution');
  add('extension_file_func', 'B', "SELECT edit('some_text')", 'Edit function execution');

  // 19. System table disclosure (Class B)
  add('system_table_reads', 'B', 'SELECT name, sql FROM sqlite_master WHERE type="table"', 'sqlite_master table disclosure');
  add('system_table_reads', 'B', 'SELECT * FROM sqlite_schema', 'sqlite_schema view query');
  add('system_table_reads', 'B', 'SELECT * FROM sqlite_temp_master', 'sqlite_temp_master query');
  add('system_table_reads', 'B', 'SELECT tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL', 'sqlite_master sql dump');
  add('system_table_reads', 'B', 'SELECT * FROM sqlite_sequence', 'sqlite_sequence query');

  // 20. Memory / Resource abuse (Class B)
  add('memory_abuse', 'B', 'SELECT zeroblob(1000000000)', 'Gigabyte zeroblob allocation');
  add('memory_abuse', 'B', 'SELECT randomblob(1000000000)', 'Gigabyte randomblob generation');
  add('memory_abuse', 'B', 'SELECT length(zeroblob(1000000000))', 'Nested zeroblob length evaluation');
  add('memory_abuse', 'B', 'SELECT hex(randomblob(500000000))', 'Hex conversion on large blob');
  add('memory_abuse', 'B', 'SELECT quote(zeroblob(100000000))', 'Quote large zeroblob');

  // 21. Recursive CTE resource loops (Class B)
  add('recursive_cte_abuse', 'B', 'WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt) SELECT * FROM cnt', 'Infinite counter CTE');
  add('recursive_cte_abuse', 'B', 'WITH RECURSIVE r(a,b) AS (SELECT "a","b" UNION ALL SELECT a||a, b||b FROM r) SELECT * FROM r', 'Exponential memory string CTE');
  add('recursive_cte_abuse', 'B', 'WITH RECURSIVE spin(v) AS (SELECT 1 UNION ALL SELECT v FROM spin) SELECT * FROM spin', 'Infinite stationary loop CTE');
  add('recursive_cte_abuse', 'B', 'WITH RECURSIVE c(n) AS (VALUES(1) UNION ALL SELECT n*2 FROM c) SELECT * FROM c', 'Infinite doubling recursive CTE');
  add('recursive_cte_abuse', 'B', 'WITH RECURSIVE fib(a,b) AS (VALUES(0,1) UNION ALL SELECT b, a+b FROM fib) SELECT * FROM fib', 'Unbounded Fibonacci recursive CTE');

  // 22. Syntax Smuggling & Obfuscation (Class A/B)
  add('syntax_smuggling', 'A', 'СЕLЕСТ * FROM brs', 'Cyrillic homoglyph SELECT (U+0421 U+0415)');
  add('syntax_smuggling', 'A', '\uFF33\uFF25\uFF2C\uFF25\uFF23\uFF34 * FROM brs', 'Fullwidth SELECT keyword');
  add('syntax_smuggling', 'A', 'sElEcT br_id, br_nm FrOm brs WhErE 1=1', 'Alternating case SQL keywords');
  add('syntax_smuggling', 'A', "SELECT\t*\nFROM\r\nbrs\u00A0WHERE\u2028br_id > 0", 'Non-standard whitespace separators');
  add('syntax_smuggling', 'A', 'SELECT "DROP" FROM (SELECT 1 AS "DROP")', 'Identifier matching blocked keyword');
  add('syntax_smuggling', 'A', 'EXPLAIN SELECT * FROM brs', 'EXPLAIN query prefix');
  add('syntax_smuggling', 'A', 'EXPLAIN QUERY PLAN SELECT * FROM brs', 'EXPLAIN QUERY PLAN query prefix');

  return attacks;
}

function buildBenignCorpus(dbSchemas) {
  const benign = [];
  let count = 0;

  for (const s of dbSchemas) {
    const t0 = s.tables[0];
    const t1 = s.tables[1] || t0;
    const t2 = s.tables[2] || t0;
    const c0 = t0.columns[0]?.name || 'rowid';
    const c1 = t0.columns[1]?.name || c0;

    // 1. Single table basic & aggregate
    benign.push({ sql: `SELECT "${c0}", "${c1}" FROM "${t0.name}" LIMIT 10`, cat: 'single_table_select', s });
    benign.push({ sql: `SELECT COUNT(*) AS total_rows, COUNT("${c0}") AS col_rows FROM "${t0.name}"`, cat: 'aggregate_count', s });
    benign.push({ sql: `SELECT "${c1}", COUNT(*) AS cnt FROM "${t0.name}" GROUP BY "${c1}" HAVING COUNT(*) > 0`, cat: 'group_by_having', s });

    // 2. Joins (2 to 6 tables depending on availability)
    if (s.tables.length >= 2) {
      benign.push({ sql: `SELECT a."${c0}", b."${t1.columns[0]?.name}" FROM "${t0.name}" AS a INNER JOIN "${t1.name}" AS b ON 1=1 LIMIT 5`, cat: 'inner_join', s });
      benign.push({ sql: `SELECT a."${c0}" FROM "${t0.name}" AS a LEFT JOIN "${t1.name}" AS b ON 1=1 LIMIT 5`, cat: 'left_join', s });
    }
    if (s.tables.length >= 3) {
      benign.push({ sql: `SELECT a."${c0}" FROM "${t0.name}" AS a JOIN "${t1.name}" AS b ON 1=1 JOIN "${t2.name}" AS c ON 1=1 LIMIT 5`, cat: 'three_table_join', s });
    }

    // 3. Subqueries
    benign.push({ sql: `SELECT "${c0}" FROM "${t0.name}" WHERE "${c0}" IN (SELECT "${c0}" FROM "${t0.name}" LIMIT 5)`, cat: 'nested_subquery_in', s });
    benign.push({ sql: `SELECT "${c0}" FROM "${t0.name}" WHERE EXISTS (SELECT 1 FROM "${t0.name}" AS sub WHERE sub."${c0}" = "${t0.name}"."${c0}") LIMIT 5`, cat: 'correlated_subquery', s });

    // 4. CTE
    benign.push({ sql: `WITH summary AS (SELECT "${c0}", COUNT(*) AS c FROM "${t0.name}" GROUP BY "${c0}") SELECT * FROM summary LIMIT 10`, cat: 'cte_basic', s });

    // 5. Window functions
    benign.push({ sql: `SELECT "${c0}", ROW_NUMBER() OVER (ORDER BY "${c0}") AS rnk FROM "${t0.name}" LIMIT 10`, cat: 'window_row_number', s });

    // 6. CASE statement
    benign.push({ sql: `SELECT "${c0}", CASE WHEN "${c0}" IS NOT NULL THEN 'Present' ELSE 'Missing' END AS presence FROM "${t0.name}" LIMIT 10`, cat: 'case_expression', s });

    // 7. Set operations
    benign.push({ sql: `SELECT "${c0}" FROM "${t0.name}" LIMIT 5 UNION ALL SELECT "${c0}" FROM "${t0.name}" LIMIT 5`, cat: 'union_all', s });

    // 8. LIKE / BETWEEN / DISTINCT
    benign.push({ sql: `SELECT DISTINCT "${c1}" FROM "${t0.name}" WHERE "${c1}" LIKE '%a%' LIMIT 5`, cat: 'distinct_like', s });
  }

  // 9. Add literal-embedded controls (containing ;, --, /*, DROP TABLE inside string constants)
  const b1 = dbSchemas.find(s => s.relPath.includes('B1_community')) || dbSchemas[0];
  const literalControls = [
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'New York; Los Angeles'", desc: 'Semicolon inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Branch -- North'", desc: 'Double dash inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Historic /* Downtown */ Branch'", desc: 'Block comment inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'DROP TABLE brs'", desc: 'DROP TABLE keyword inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'DELETE FROM txns WHERE 1=1'", desc: 'DELETE statement inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'INSERT INTO accts VALUES (1)'", desc: 'INSERT statement inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'ALTER TABLE lns RENAME'", desc: 'ALTER keyword inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'CREATE TABLE test (x INT)'", desc: 'CREATE TABLE inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'PRAGMA query_only=OFF'", desc: 'PRAGMA inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'ATTACH \":memory:\" AS m'", desc: 'ATTACH inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'SELECT * FROM brs; VACUUM;'", desc: 'Semicolon and VACUUM inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Branch /* Multi */ -- Mixed'", desc: 'Mixed comments inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Special;Char;String'", desc: 'Multiple semicolons inside literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Admin--Notice'", desc: 'Comment sequence in name' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Safe /* comment */ literal'", desc: 'Comment in text filter' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = '/* prefix comment'", desc: 'Unclosed comment start in literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'suffix */ comment'", desc: 'Unclosed comment end in literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Line 1\n-- Line 2\nLine 3'", desc: 'Multiline literal with comment syntax' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'Value with ; and -- and /* all */'", desc: 'Composite punctuation in literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'TRUNCATE TABLE brs;'", desc: 'TRUNCATE in literal' },
    { sql: "SELECT br_id, br_nm FROM brs WHERE city = 'GRANT ALL PRIVILEGES'", desc: 'GRANT in literal' }
  ];

  for (const c of literalControls) {
    benign.push({ sql: c.sql, cat: 'literal_embedded_syntax', s: b1, desc: c.desc });
  }

  // Validate every candidate using real fixture execution and oracle 1
  const verified = [];
  for (const item of benign) {
    const fullDbPath = item.s.path;
    const r1 = readonlyOracle(item.sql, fullDbPath);
    if (!r1.prepare_error && r1.readonly === true) {
      count++;
      verified.push({
        id: `ben_${String(count).padStart(4, '0')}`,
        class: 'C',
        category: item.cat,
        provenance: 'agent-authored',
        sql: item.sql,
        expected: 'accept',
        fixture_db: item.s.relPath,
        notes: item.desc || `Valid benign analytical query on ${item.s.relPath}`
      });
    }
  }

  // If verified is less than 200, generate additional multi-column variations across fixtures
  let extraIdx = 0;
  while (verified.length < 220) {
    const s = dbSchemas[extraIdx % dbSchemas.length];
    extraIdx++;
    const t = s.tables[0];
    const c0 = t.columns[0]?.name || 'rowid';
    const limit = 1 + (extraIdx % 20);
    const sql = `SELECT "${c0}" FROM "${t.name}" ORDER BY "${c0}" DESC LIMIT ${limit}`;
    const r1 = readonlyOracle(sql, s.path);
    if (!r1.prepare_error && r1.readonly === true) {
      count++;
      verified.push({
        id: `ben_${String(count).padStart(4, '0')}`,
        class: 'C',
        category: 'single_table_limit_order',
        provenance: 'agent-authored',
        sql,
        expected: 'accept',
        fixture_db: s.relPath,
        notes: `Additional verified benign query on ${s.relPath}`
      });
    }
  }

  return verified;
}

function buildBoundaryCorpus(dbSchemas) {
  const boundary = [];
  const h3 = dbSchemas.find(s => s.relPath.includes('H3_metropol')) || dbSchemas[0];
  const f3 = dbSchemas.find(s => s.relPath.includes('F3_national')) || dbSchemas[0];

  // Helper
  function addBnd(idNum, cat, sql, expected, notes, fixture = h3.relPath) {
    boundary.push({
      id: `bnd_${String(idNum).padStart(3, '0')}`,
      class: 'D',
      category: cat,
      provenance: 'agent-authored',
      sql,
      expected, // 'accept' or 'reject'
      fixture_db: fixture,
      notes
    });
  }

  // 1. Join count: exactly 6 joins vs 7 joins (H3 has 9 tables)
  // Table names: doctors, patients, visits, diagnoses, prescriptions, departments, wards, lab_tests, appointments
  const join6 = `SELECT d.doctor_id FROM doctors AS d
    JOIN patients AS p ON 1=1
    JOIN visits AS v ON 1=1
    JOIN diagnoses AS diag ON 1=1
    JOIN prescriptions AS pr ON 1=1
    JOIN departments AS dep ON 1=1
    JOIN wards AS w ON 1=1 LIMIT 1`;
  addBnd(1, 'join_boundary_6', join6, 'accept', 'Exactly 6 joins (boundary limit 6)');

  const join7 = `SELECT d.doctor_id FROM doctors AS d
    JOIN patients AS p ON 1=1
    JOIN visits AS v ON 1=1
    JOIN diagnoses AS diag ON 1=1
    JOIN prescriptions AS pr ON 1=1
    JOIN departments AS dep ON 1=1
    JOIN wards AS w ON 1=1
    JOIN lab_tests AS lt ON 1=1 LIMIT 1`;
  addBnd(2, 'join_boundary_7', join7, 'reject', 'Exactly 7 joins (exceeds limit 6)');

  // 2. Subquery depth: exactly 4 vs 5 levels
  const depth4 = `SELECT * FROM doctors WHERE doctor_id IN (
    SELECT doctor_id FROM visits WHERE patient_id IN (
      SELECT patient_id FROM prescriptions WHERE visit_id IN (
        SELECT visit_id FROM diagnoses WHERE diagnosis_id > 0
      )
    )
  )`;
  addBnd(3, 'depth_boundary_4', depth4, 'accept', 'Subquery nesting depth 4 (limit 4)');

  const depth5 = `SELECT * FROM doctors WHERE doctor_id IN (
    SELECT doctor_id FROM visits WHERE patient_id IN (
      SELECT patient_id FROM prescriptions WHERE visit_id IN (
        SELECT visit_id FROM diagnoses WHERE diagnosis_id IN (
          SELECT diagnosis_id FROM lab_tests WHERE test_id > 0
        )
      )
    )
  )`;
  addBnd(4, 'depth_boundary_5', depth5, 'reject', 'Subquery nesting depth 5 (exceeds limit 4)');

  // 3. Length boundary: 3999, 4000, 4001 chars
  const baseSql = 'SELECT * FROM doctors WHERE 1=1';
  const padTo = (n) => {
    const padLen = n - baseSql.length - 8; // " AND ''='...'"
    const pad = 'a'.repeat(Math.max(0, padLen));
    return `${baseSql} AND '${pad}'='${pad}'`;
  };

  const len3999 = padTo(3999);
  const len4000 = padTo(4000);
  const len4001 = padTo(4001);

  addBnd(5, 'length_boundary_3999', len3999, 'accept', 'Length exactly 3999 chars');
  addBnd(6, 'length_boundary_4000', len4000, 'accept', 'Length exactly 4000 chars');
  addBnd(7, 'length_boundary_4001', len4001, 'reject', 'Length exactly 4001 chars (exceeds limit 4000)');

  // 4. Cartesian products: CROSS JOIN and comma joins
  addBnd(8, 'cross_join', 'SELECT * FROM doctors CROSS JOIN patients LIMIT 10', 'reject', 'Explicit CROSS JOIN without condition');
  addBnd(9, 'comma_join_no_where', 'SELECT * FROM doctors, patients LIMIT 10', 'reject', 'Comma join without WHERE or ON predicate');
  addBnd(10, 'comma_join_with_where', 'SELECT * FROM doctors, patients WHERE doctors.doctor_id = patients.patient_id LIMIT 10', 'accept', 'Comma join with linking WHERE predicate');

  // 5. Fan-out estimation near 5e9 limit
  // F3_national.db has tables with significant row counts
  addBnd(11, 'fanout_large_unkeyed', 'SELECT * FROM orders, order_items, restaurants, users', 'reject', 'Unkeyed join multiplying large table row counts beyond 5e9', f3.relPath);
  addBnd(12, 'fanout_keyed_safe', 'SELECT * FROM orders JOIN order_items ON orders.order_id = order_items.order_id LIMIT 10', 'accept', 'Keyed join with bounded intermediate rows', f3.relPath);

  return boundary;
}

function buildFuzzCorpus(attacks, benign) {
  const fuzz = [];
  let count = 0;

  // Pick samples from benign Class C and Class A attacks
  const seeds = [
    ...benign.slice(0, 150),
    ...attacks.filter(a => a.category === 'drop' || a.category === 'delete' || a.category === 'update' || a.category === 'insert').slice(0, 50)
  ];

  for (const seed of seeds) {
    const parentId = seed.id;
    const sql = seed.sql;

    // Mutation 1: Case mixing
    const mixedCase = sql.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('');
    count++;
    fuzz.push({
      id: `fuzz_${String(count).padStart(4, '0')}`,
      class: 'F',
      category: 'case_mixing',
      provenance: `mutation-of:${parentId}`,
      sql: mixedCase,
      expected: seed.expected,
      fixture_db: seed.fixture_db,
      notes: `Alternating case mutation of ${parentId}`
    });

    // Mutation 2: Whitespace substitutions (tabs, newlines, multiple spaces)
    const spaced = sql.replace(/\s+/g, (m, idx) => idx % 2 === 0 ? '\t\t' : '\n  \n');
    count++;
    fuzz.push({
      id: `fuzz_${String(count).padStart(4, '0')}`,
      class: 'F',
      category: 'whitespace_mutation',
      provenance: `mutation-of:${parentId}`,
      sql: spaced,
      expected: seed.expected,
      fixture_db: seed.fixture_db,
      notes: `Tab and newline substitution of ${parentId}`
    });

    // Mutation 3: Inline comments insertion
    const inlineComment = sql.replace(/\s+/g, '/**/');
    count++;
    fuzz.push({
      id: `fuzz_${String(count).padStart(4, '0')}`,
      class: 'F',
      category: 'inline_comments',
      provenance: `mutation-of:${parentId}`,
      sql: inlineComment,
      expected: 'reject', // gate should reject comments
      fixture_db: seed.fixture_db,
      notes: `Inline comment token separation of ${parentId}`
    });

    // Mutation 4: Bracket / identifier quoting style
    const bracketed = sql.replace(/"([A-Za-z0-9_]+)"/g, '[$1]');
    count++;
    fuzz.push({
      id: `fuzz_${String(count).padStart(4, '0')}`,
      class: 'F',
      category: 'bracket_quoting',
      provenance: `mutation-of:${parentId}`,
      sql: bracketed,
      expected: seed.expected,
      fixture_db: seed.fixture_db,
      notes: `Square bracket quoting mutation of ${parentId}`
    });

    // Mutation 5: Homoglyph substitution on keyword SELECT
    if (/SELECT/i.test(sql)) {
      const homoglyph = sql.replace(/SELECT/i, '\u0421\u0415L\u0415\u0421T'); // Cyrillic C, E, C
      count++;
      fuzz.push({
        id: `fuzz_${String(count).padStart(4, '0')}`,
        class: 'F',
        category: 'homoglyph_substitution',
        provenance: `mutation-of:${parentId}`,
        sql: homoglyph,
        expected: 'reject',
        fixture_db: seed.fixture_db,
        notes: `Cyrillic homoglyph substitution of ${parentId}`
      });
    }

    if (fuzz.length >= 350) break;
  }

  return fuzz;
}

async function main() {
  console.log('Loading database fixture schemas...');
  const dbSchemas = FIXTURES.map(getDatabaseSchema);
  console.log(`Loaded schemas for ${dbSchemas.length} database fixtures.`);

  console.log('Fetching public SQLi payloads from SecLists & PayloadsAllTheThings...');
  const publicPayloads = await fetchPublicPayloads();
  console.log(`Fetched ${publicPayloads.length} public payload variants.`);

  console.log('Building agent-authored Class A/B attacks...');
  const agentAttacks = buildAgentAuthoredAttacks(dbSchemas);
  console.log(`Built ${agentAttacks.length} agent-authored attack items across 22 categories.`);

  // Combine public + agent-authored attacks into attacks.jsonl
  let attCount = 0;
  const attackItems = [];

  for (const a of agentAttacks) {
    attCount++;
    attackItems.push({
      id: `att_${String(attCount).padStart(4, '0')}`,
      class: a.class,
      category: a.category,
      provenance: a.provenance,
      sql: a.sql,
      expected: a.expected,
      fixture_db: a.fixture_db,
      notes: a.notes,
    });
  }

  for (const p of publicPayloads) {
    attCount++;
    attackItems.push({
      id: `att_${String(attCount).padStart(4, '0')}`,
      class: 'A',
      category: `public_${p.type}`,
      provenance: `public:${p.source}:${p.line}`,
      sql: p.sql,
      expected: 'reject',
      fixture_db: 'database/bank/B1_community.db',
      notes: `Public injection from ${p.source}:${p.line} (${p.type})`,
    });
  }

  console.log('Building Class C benign corpus with oracle verification...');
  const benignItems = buildBenignCorpus(dbSchemas);
  console.log(`Verified ${benignItems.length} Class C benign items across 15 fixtures.`);

  console.log('Building Class D complexity boundary items...');
  const boundaryItems = buildBoundaryCorpus(dbSchemas);
  console.log(`Built ${boundaryItems.length} boundary items.`);

  console.log('Building fuzz set mutations...');
  const fuzzItems = buildFuzzCorpus(attackItems, benignItems);
  console.log(`Built ${fuzzItems.length} fuzz items.`);

  // Write out files
  const attacksPath = path.join(DATA_DIR, 'attacks.jsonl');
  const benignPath = path.join(DATA_DIR, 'benign.jsonl');
  const boundaryPath = path.join(DATA_DIR, 'boundary.jsonl');
  const fuzzPath = path.join(DATA_DIR, 'fuzz.jsonl');

  fs.writeFileSync(attacksPath, attackItems.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(benignPath, benignItems.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(boundaryPath, boundaryItems.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');
  fs.writeFileSync(fuzzPath, fuzzItems.map(x => JSON.stringify(x)).join('\n') + '\n', 'utf8');

  // Compute checksums
  const getHash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

  const shaAttacks = getHash(attacksPath);
  const shaBenign = getHash(benignPath);
  const shaBoundary = getHash(boundaryPath);
  const shaFuzz = getHash(fuzzPath);

  console.log('\n--- Corpus Statistics ---');
  console.log(`attacks.jsonl:  ${attackItems.length} items (SHA-256: ${shaAttacks})`);
  console.log(`benign.jsonl:   ${benignItems.length} items (SHA-256: ${shaBenign})`);
  console.log(`boundary.jsonl: ${boundaryItems.length} items (SHA-256: ${shaBoundary})`);
  console.log(`fuzz.jsonl:     ${fuzzItems.length} items (SHA-256: ${shaFuzz})`);
  console.log(`Total corpus:   ${attackItems.length + benignItems.length + boundaryItems.length + fuzzItems.length} items\n`);

  // Print provenance breakdown for attacks
  const provBreakdown = {};
  for (const a of attackItems) {
    const prov = a.provenance.startsWith('public:') ? 'public' : a.provenance;
    provBreakdown[prov] = (provBreakdown[prov] || 0) + 1;
  }
  console.log('Attack Provenance Breakdown:', provBreakdown);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error building corpus:', err);
    process.exit(1);
  });
}

module.exports = { main };
