const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Database = require(path.resolve(__dirname, '../../server/node_modules/better-sqlite3'));
const {
  generatePoliciesForFixture,
  rowOracle,
  columnOracle,
  diffMultisets,
  isClose,
  rowsEqual,
} = require('../lib/v3_oracles');

const FIXTURE_DB = path.resolve(__dirname, '../../database/bank/B1_community.db');

test('v3_oracles: generatePoliciesForFixture generates valid deterministic users', () => {
  const policies = generatePoliciesForFixture(FIXTURE_DB);
  assert.equal(policies.users.length, 4);

  const { u1, u2, u3, admin } = policies;

  // U1 checks
  assert.equal(u1.policy.rowFilters.length, 1);
  assert.equal(u1.policy.deniedColumns.length, 0);
  assert.equal(u1.policy.rowFilters[0].op, '=');

  // U2 checks
  assert.equal(u2.policy.rowFilters.length, 2);
  assert.equal(u2.policy.rowFilters[0].op, '!=');
  assert.equal(u2.policy.rowFilters[1].op, 'IN');

  // U3 checks
  assert.equal(u3.policy.rowFilters.length, 1);
  assert.equal(u3.policy.deniedColumns.length, 1);

  // Admin checks
  assert.equal(admin.policy.rowFilters.length, 0);
  assert.equal(admin.policy.deniedColumns.length, 0);
});

test('v3_oracles positive control: row oracle reports mismatch when policy is disabled for filtered user', () => {
  const policies = generatePoliciesForFixture(FIXTURE_DB);
  const u1 = policies.u1;
  const table = u1.policy.rowFilters[0].table;
  const col = u1.policy.rowFilters[0].column;
  const val = u1.policy.rowFilters[0].value;

  // Query table directly without filtering (simulating disabled policy)
  const db = new Database(FIXTURE_DB, { readonly: true });
  let unfilteredRows = [];
  try {
    unfilteredRows = db.prepare(`SELECT * FROM "${table}"`).all();
  } finally {
    db.close();
  }

  // Row oracle must flag that unfiltered rows leak forbidden data
  const result = rowOracle(FIXTURE_DB, u1, `SELECT * FROM "${table}"`, { rows: unfilteredRows });
  assert.equal(result.passed, false, 'Row oracle must report failure when policy is disabled');
  assert.ok(result.leaked_rows > 0, 'Leaked rows count must be > 0');
  assert.ok(result.pipelineCount > result.groundTruthCount, 'Pipeline count must exceed ground truth count');
});

test('v3_oracles positive control: row oracle reports mismatch when naive rewriter fails on main.t schema qualification', () => {
  const policies = generatePoliciesForFixture(FIXTURE_DB);
  const u1 = policies.u1;
  const table = u1.policy.rowFilters[0].table;
  const col = u1.policy.rowFilters[0].column;
  const val = u1.policy.rowFilters[0].value;

  // Naive CTE rewriting: WITH "table" AS (SELECT * FROM main."table" WHERE col = val) SELECT * FROM main."table"
  const naiveSql = `WITH "${table}" AS (SELECT * FROM main."${table}" WHERE "${col}" = '${val}') SELECT * FROM main."${table}"`;

  const db = new Database(FIXTURE_DB, { readonly: true });
  let executedRows = [];
  try {
    executedRows = db.prepare(naiveSql).all();
  } finally {
    db.close();
  }

  // Because the query referenced main.table, SQLite evaluated against the base table, returning all rows
  const result = rowOracle(FIXTURE_DB, u1, `SELECT * FROM main."${table}"`, { rows: executedRows });
  assert.equal(result.passed, false, 'Row oracle must catch schema-qualified main.t bypass');
  assert.ok(result.leaked_rows > 0, 'Must record leaked rows for main.t bypass');
});

test('v3_oracles positive control: column oracle flags explicit naming and SELECT * of denied column', () => {
  const policies = generatePoliciesForFixture(FIXTURE_DB);
  const u3 = policies.u3;
  const deniedCol = u3.policy.deniedColumns[0].column;
  const table = u3.policy.deniedColumns[0].table;

  // 1. Explicit reference
  const explicitSql = `SELECT "${deniedCol}" FROM "${table}"`;
  const db = new Database(FIXTURE_DB, { readonly: true });
  let explicitRows = [];
  try {
    explicitRows = db.prepare(explicitSql).all();
  } finally {
    db.close();
  }

  const explicitResult = columnOracle(FIXTURE_DB, u3.policy.deniedColumns, explicitSql, { rows: explicitRows, columns: [deniedCol] });
  assert.equal(explicitResult.passed, false, 'Column oracle must flag explicit reference to denied column');
  assert.equal(explicitResult.directLeak, true, 'Direct leak must be true');
  assert.equal(explicitResult.functionalDependence, true, 'Dropping column must cause functional dependence failure');

  // 2. SELECT *
  const starSql = `SELECT * FROM "${table}"`;
  const starDb = new Database(FIXTURE_DB, { readonly: true });
  let starRows = [];
  try {
    starRows = starDb.prepare(starSql).all();
  } finally {
    starDb.close();
  }

  const starCols = Object.keys(starRows[0] || {});
  const starResult = columnOracle(FIXTURE_DB, u3.policy.deniedColumns, starSql, { rows: starRows, columns: starCols });
  assert.equal(starResult.passed, false, 'Column oracle must flag SELECT * containing denied column');
  assert.equal(starResult.directLeak, true, 'Direct leak must be true for SELECT *');
});

test('v3_oracles positive control: column oracle does NOT flag query referencing unrelated columns', () => {
  const policies = generatePoliciesForFixture(FIXTURE_DB);
  const u3 = policies.u3;
  const deniedCol = u3.policy.deniedColumns[0].column;
  const table = u3.policy.deniedColumns[0].table;

  // Pick an unrelated column from the same table
  const unrelatedCol = policies.schema.find(t => t.name === table).columns.find(c => c.name.toLowerCase() !== deniedCol.toLowerCase());
  assert.ok(unrelatedCol, 'Must have at least one unrelated column');

  const safeSql = `SELECT "${unrelatedCol.name}" FROM "${table}"`;
  const db = new Database(FIXTURE_DB, { readonly: true });
  let safeRows = [];
  try {
    safeRows = db.prepare(safeSql).all();
  } finally {
    db.close();
  }

  const result = columnOracle(FIXTURE_DB, u3.policy.deniedColumns, safeSql, { rows: safeRows, columns: [unrelatedCol.name] });
  assert.equal(result.passed, true, 'Column oracle must pass when denied column is not referenced');
  assert.equal(result.directLeak, false, 'directLeak must be false');
  assert.equal(result.originLeak, false, 'originLeak must be false');
  assert.equal(result.functionalDependence, false, 'functionalDependence must be false');
});

test('v3_oracles: multiset equality helper verifies precision and ordering invariance', () => {
  const r1 = [{ a: 1, b: 2.000000000001 }, { a: 2, b: 3 }];
  const r2 = [{ a: 2, b: 3 }, { a: 1, b: 2.000000000002 }];
  const diff = diffMultisets(r1, r2);
  assert.equal(diff.excess.length, 0);
  assert.equal(diff.missing.length, 0);
  assert.equal(diff.matched, 2);
});
