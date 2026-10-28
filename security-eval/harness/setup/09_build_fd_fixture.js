'use strict';

/**
 * S4 FIXTURE BUILDER (per PREREG_S4 §3)
 * Builds data/fixtures/fd_leak.sqlite deterministically (no RNG) and emits
 * data/s4/fd_declarations.json with the declared functional dependencies, the
 * evaluated policy, the preregistered query sets, and the fixture SHA-256.
 *
 * Operator flow (RUNBOOK_S4): run once, then COMMIT BOTH ARTIFACTS. Re-running
 * reproduces byte-identical content (same SQLite page layout for same inserts;
 * the SHA-256 recorded in declarations is the one the runner pins).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const ZIPS = ['10001', '10002', '20001', '20002', '30001', '30002', '30003', '30004'];
const ZIP_STATE = { 10001: 'NY', 10002: 'NY', 20001: 'NJ', 20002: 'NJ', 30001: 'CT', 30002: 'CT', 30003: 'CT', 30004: 'CT' };
const GRADES = ['A', 'B', 'C', 'D', 'E'];
const ROLES = ['R1', 'R2', 'R3', 'R4'];
const TENANTS = ['tenant_a', 'tenant_b'];

function buildFdFixture() {
  const fixturesDir = path.resolve(__dirname, '../../data/fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });
  const dbPath = path.join(fixturesDir, 'fd_leak.sqlite');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  // Orphan audit rows are REQUIRED by PREREG_S4 §3 (join-unreachable rows);
  // disable FK enforcement for the build only (per-connection, not persisted).
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE employees (
      emp_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      job_grade TEXT NOT NULL,
      salary_band TEXT NOT NULL,
      zip TEXT NOT NULL,
      state TEXT NOT NULL,
      role_code TEXT NOT NULL,
      salary_tier TEXT NOT NULL,
      bonus_note TEXT NOT NULL,
      tenant_id TEXT NOT NULL
    );
    CREATE TABLE regions (
      region_id INTEGER PRIMARY KEY,
      region_name TEXT NOT NULL
    );
    CREATE TABLE districts (
      district_id INTEGER PRIMARY KEY,
      district_name TEXT NOT NULL,
      region_id INTEGER NOT NULL,
      FOREIGN KEY (region_id) REFERENCES regions(region_id)
    );
    CREATE TABLE branches (
      branch_id INTEGER PRIMARY KEY,
      branch_name TEXT NOT NULL,
      district_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      FOREIGN KEY (district_id) REFERENCES districts(district_id)
    );
    CREATE TABLE chain_accounts (
      account_id INTEGER PRIMARY KEY,
      account_name TEXT NOT NULL,
      balance REAL NOT NULL,
      branch_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      FOREIGN KEY (branch_id) REFERENCES branches(branch_id)
    );
    CREATE TABLE audits (
      audit_id INTEGER PRIMARY KEY,
      audit_note TEXT NOT NULL,
      account_id INTEGER,
      FOREIGN KEY (account_id) REFERENCES chain_accounts(account_id)
    );
  `);

  const insEmp = db.prepare(`INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const empRows = [];
  for (let i = 1; i <= 120; i++) {
    const grade = GRADES[i % 5];
    const band = `BAND_${grade}`;
    const zip = ZIPS[i % 8];
    const state = ZIP_STATE[zip];
    const role = ROLES[i % 4];
    const tier = `TIER_${role}_${state}`;
    const tenant = TENANTS[i % 2];
    empRows.push({
      emp_id: i, name: `Emp ${i} [CANARY_FD_EMP_${i}]`, job_grade: grade, salary_band: band,
      zip, state, role_code: role, salary_tier: tier,
      bonus_note: `note ${i} [CANARY_FD_NOTE_${i}]`, tenant_id: tenant,
    });
    insEmp.run(i, empRows[i - 1].name, grade, band, zip, state, role, tier, empRows[i - 1].bonus_note, tenant);
  }

  const insRegion = db.prepare(`INSERT INTO regions VALUES (?,?)`);
  for (let r = 1; r <= 3; r++) insRegion.run(r, `Region_${r} [CANARY_FD_REGION_${r}]`);

  const insDistrict = db.prepare(`INSERT INTO districts VALUES (?,?,?)`);
  for (let d = 1; d <= 9; d++) insDistrict.run(d, `District_${d}`, Math.ceil(d / 3));

  const insBranch = db.prepare(`INSERT INTO branches VALUES (?,?,?,?)`);
  for (let b = 1; b <= 27; b++) {
    insBranch.run(b, `Branch_${b} [CANARY_FD_BRANCH_${b}]`, Math.ceil(b / 3), TENANTS[b % 2]);
  }

  const insAcct = db.prepare(`INSERT INTO chain_accounts VALUES (?,?,?,?,?)`);
  for (let a = 1; a <= 108; a++) {
    const branchId = Math.ceil(a / 4);
    const tenant = TENANTS[a % 2];
    insAcct.run(a, `Acct_${a} [CANARY_FD_CHAIN_ACCT_${a}]`, 1000 + a, branchId, tenant);
  }

  const insAudit = db.prepare(`INSERT INTO audits VALUES (?,?,?)`);
  // 20 joined rows (10 tenant_a accounts, 10 tenant_b accounts), 6 orphans, 4 cross-tenant refs
  const tenantAAccounts = [];
  const tenantBAccounts = [];
  for (let a = 1; a <= 108; a++) (a % 2 === 0 ? tenantAAccounts : tenantBAccounts).push(a);
  let auditId = 1;
  const orphanIds = [9001, 9002, 9003, 9004, 9005, 9006];
  for (let k = 0; k < 10; k++) { const id = auditId++; insAudit.run(id, `audit ${id} [CANARY_FD_AUDIT_${id}]`, tenantAAccounts[k]); }
  for (let k = 0; k < 10; k++) { const id = auditId++; insAudit.run(id, `audit ${id} [CANARY_FD_AUDIT_${id}]`, tenantBAccounts[k]); }
  for (const o of orphanIds) { const id = auditId++; insAudit.run(id, `orphan ${id} [CANARY_FD_AUDIT_${id}]`, o); }
  for (let k = 0; k < 4; k++) { const id = auditId++; insAudit.run(id, `xtenant ${id} [CANARY_FD_AUDIT_${id}]`, tenantBAccounts[10 + k]); }

  db.close();

  const sha = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
  return { dbPath, sha, empRows, orphanIds };
}

function buildDeclarations(fixtureSha, orphanIds) {
  const evaluatedPolicy = {
    datasetId: 'fd_leak',
    role: 'employee',
    deniedColumns: [
      { table: 'employees', column: 'salary_band' },
      { table: 'employees', column: 'salary_tier' },
      { table: 'employees', column: 'bonus_note' },
      { table: 'employees', column: 'state' },
      { table: 'branches', column: 'branch_name' },
      { table: 'chain_accounts', column: 'account_name' },
    ],
    rowFilters: [
      { table: 'employees', column: 'tenant_id', op: '=', value: 'tenant_a' },
      { table: 'branches', column: 'tenant_id', op: '=', value: 'tenant_a' },
      { table: 'chain_accounts', column: 'tenant_id', op: '=', value: 'tenant_a' },
    ],
  };

  // PREREG_S4 §6: Part A = 3 FD arms x 4 queries + 2 control queries = 14 executions.
  // PREREG_S4 §6: Part B = 10 preregistered referential probes.
  const partA = {
    fd_1: [
      { id: 'A-FD1-Q1', sql: 'SELECT emp_id, name, job_grade FROM employees' },
      { id: 'A-FD1-Q2', sql: "SELECT emp_id, job_grade, zip FROM employees WHERE job_grade IN ('A', 'B')" },
      { id: 'A-FD1-Q3', sql: 'SELECT emp_id, job_grade FROM employees ORDER BY emp_id LIMIT 50' },
      { id: 'A-FD1-Q4', sql: 'SELECT job_grade, COUNT(*) AS n FROM employees GROUP BY job_grade' },
    ],
    fd_2: [
      { id: 'A-FD2-Q1', sql: 'SELECT emp_id, zip FROM employees' },
      { id: 'A-FD2-Q2', sql: "SELECT emp_id, zip, name FROM employees WHERE tenant_id = 'tenant_a'" },
      { id: 'A-FD2-Q3', sql: "SELECT emp_id, zip FROM employees WHERE tenant_id = 'tenant_a' ORDER BY emp_id LIMIT 40" },
      { id: 'A-FD2-Q4', sql: 'SELECT zip, COUNT(*) AS n FROM employees GROUP BY zip' },
    ],
    fd_3: [
      { id: 'A-FD3-Q1', sql: 'SELECT emp_id, role_code, zip FROM employees' },
      { id: 'A-FD3-Q2', sql: 'SELECT emp_id, role_code, state FROM employees' },
      { id: 'A-FD3-Q3', sql: "SELECT emp_id, role_code, zip FROM employees WHERE role_code = 'R1'" },
      { id: 'A-FD3-Q4', sql: 'SELECT emp_id, role_code, zip FROM employees ORDER BY emp_id LIMIT 60' },
    ],
    control: [
      { id: 'A-CTL-Q1', sql: 'SELECT region_id, region_name FROM regions' },
      { id: 'A-CTL-Q2', sql: "SELECT branch_id, tenant_id FROM branches WHERE tenant_id = 'tenant_a'" },
    ],
  };

  const partB = [
    { id: 'B-Q1', sql: 'SELECT audit_id, audit_note, account_id FROM audits', expect: 'unjoined no-tenant-key child' },
    { id: 'B-Q2', sql: 'SELECT a.audit_id, a.audit_note, ca.branch_id FROM audits a JOIN chain_accounts ca ON a.account_id = ca.account_id', expect: 'joined child' },
    { id: 'B-Q3', sql: "SELECT audit_id FROM audits WHERE account_id IN (SELECT account_id FROM chain_accounts WHERE tenant_id = 'tenant_a')", expect: 'subquery child' },
    { id: 'B-Q4', sql: "SELECT ca.account_id, ca.balance FROM chain_accounts ca JOIN branches b ON ca.branch_id = b.branch_id WHERE b.tenant_id = 'tenant_a'", expect: 'chain depth 1' },
    { id: 'B-Q5', sql: "SELECT ca.account_id, ca.balance FROM chain_accounts ca JOIN branches b ON ca.branch_id = b.branch_id JOIN districts d ON b.district_id = d.district_id WHERE d.region_id = 1", expect: 'chain depth 2 via region filter' },
    { id: 'B-Q6', sql: "SELECT r.region_id, ca.account_id FROM chain_accounts ca JOIN branches b ON ca.branch_id = b.branch_id JOIN districts d ON b.district_id = d.district_id JOIN regions r ON d.region_id = r.region_id WHERE b.tenant_id = 'tenant_a'", expect: 'chain depth 3' },
    { id: 'B-Q7', sql: 'SELECT b.branch_id, b.tenant_id FROM branches b JOIN districts d ON b.district_id = d.district_id WHERE d.region_id = 1', expect: 'branch listing via district' },
    { id: 'B-Q8', sql: 'SELECT audit_id, audit_note FROM audits WHERE account_id NOT IN (SELECT account_id FROM chain_accounts)', expect: 'orphan probe' },
    { id: 'B-Q9', sql: 'SELECT branch_id, tenant_id FROM branches', expect: 'unfiltered branch listing (row policy must filter)' },
    { id: 'B-Q10', sql: 'SELECT account_id, balance, tenant_id FROM chain_accounts', expect: 'unfiltered accounts (row policy must filter)' },
  ];

  const declarations = {
    prereg: 'security-eval/prereg/PREREG_S4.md',
    fixture: 'data/fixtures/fd_leak.sqlite',
    fixtureSha256: fixtureSha,
    identityColumn: 'emp_id',
    orphanAccountIds: orphanIds,
    dependencies: [
      { id: 'FD-1', table: 'employees', determinant: ['job_grade'], dependent: 'salary_band', preDependencies: [] },
      { id: 'FD-2', table: 'employees', determinant: ['zip'], dependent: 'state', preDependencies: [] },
      { id: 'FD-3', table: 'employees', determinant: ['role_code', 'state'], dependent: 'salary_tier', preDependencies: ['FD-2'] },
    ],
    fkDerivedPurges: [
      { table: 'audits', via: 'account_id', refTable: 'chain_accounts', refCol: 'account_id', tenantCol: 'tenant_id', tenant: 'tenant_a' },
    ],
    policy: evaluatedPolicy,
    partA,
    partB,
    totals: {
      partAQueryExecutions: 14,
      partBQueries: 10,
    },
  };
  return declarations;
}

function main() {
  const { dbPath, sha, orphanIds } = buildFdFixture();
  const declarations = buildDeclarations(sha, orphanIds);
  const s4Dir = path.resolve(__dirname, '../../data/s4');
  fs.mkdirSync(s4Dir, { recursive: true });
  const declPath = path.join(s4Dir, 'fd_declarations.json');
  fs.writeFileSync(declPath, JSON.stringify(declarations, null, 2) + '\n');
  console.log('[setup/09] fixture written:', dbPath);
  console.log('[setup/09] fixture sha256:', sha);
  console.log('[setup/09] declarations written:', declPath);
  console.log('[setup/09] rows: employees=120 regions=3 districts=9 branches=27 chain_accounts=108 audits=30 (6 orphans)');
}

if (require.main === module) main();

module.exports = { buildFdFixture, buildDeclarations };
