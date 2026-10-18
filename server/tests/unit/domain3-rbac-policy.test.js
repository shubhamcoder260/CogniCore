const test = require('node:test');
const assert = require('node:assert/strict');
const { assertColumnAccess, applyRowFilters, PolicyError, PolicyStore } = require('../../src/security/data.policy');
const { requireDatasetAccess } = require('../../src/security/rbac');
const { cleanTestDb } = require('../helpers/testServer');
const { extractCteBodies, buildScope, tokenize } = require('../../src/structured/sql.analyzer');

// Mock schema with employees, departments, secret_salary
const testSchema = {
  tables: [
    {
      name: 'employees',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'dept_id', type: 'INTEGER' },
        { name: 'bonus', type: 'REAL' },
        { name: 'salary', type: 'REAL' },
      ],
    },
    {
      name: 'departments',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'salary', type: 'REAL' }, // unrestricted department salary metric
      ],
    },
    {
      name: 'secret_salary',
      columns: [
        { name: 'employee_id', type: 'INTEGER' },
        { name: 'amount', type: 'REAL' },
      ],
    },
  ],
};

test('Domain 3.1: 10 Core Column-Access Verification Cases', async (t) => {
  const policyEmployeesSalary = {
    deniedColumns: [{ table: 'employees', column: 'salary' }],
    rowFilters: [],
  };

  const policySecretSalaryAmount = {
    deniedColumns: [{ table: 'secret_salary', column: 'amount' }],
    rowFilters: [],
  };

  await t.test('Case 1: SELECT bonus AS salary FROM employees -> Allow (Alias false positive)', () => {
    const sql = 'SELECT bonus AS salary FROM employees';
    assert.doesNotThrow(() => assertColumnAccess(sql, testSchema, policyEmployeesSalary));
  });

  await t.test('Case 2: SELECT d.salary FROM departments d JOIN employees e ON d.id = e.dept_id -> Allow (Qualified ref to different table)', () => {
    const sql = 'SELECT d.salary FROM departments d JOIN employees e ON d.id = e.dept_id';
    assert.doesNotThrow(() => assertColumnAccess(sql, testSchema, policyEmployeesSalary));
  });

  await t.test('Case 3: SELECT d.* FROM departments d JOIN employees e ON d.id = e.dept_id -> Allow (Qualified wildcard)', () => {
    const sql = 'SELECT d.* FROM departments d JOIN employees e ON d.id = e.dept_id';
    assert.doesNotThrow(() => assertColumnAccess(sql, testSchema, policyEmployeesSalary));
  });

  await t.test('Case 4: SELECT * FROM departments d JOIN employees e ON d.id = e.dept_id -> Block (Unqualified wildcard)', () => {
    const sql = 'SELECT * FROM departments d JOIN employees e ON d.id = e.dept_id';
    assert.throws(() => assertColumnAccess(sql, testSchema, policyEmployeesSalary), PolicyError);
  });

  await t.test('Case 5: WITH safe_view AS (SELECT employee_id, amount FROM secret_salary) SELECT employee_id FROM safe_view -> Allow (CTE does not reference denied column in outer query)', () => {
    const sql = 'WITH safe_view AS (SELECT employee_id, amount FROM secret_salary) SELECT employee_id FROM safe_view';
    assert.doesNotThrow(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount));
  });

  await t.test('Case 6: WITH safe_view AS (SELECT amount FROM secret_salary) SELECT amount FROM safe_view -> Block (CTE-aliased denied column leak)', () => {
    const sql = 'WITH safe_view AS (SELECT amount FROM secret_salary) SELECT amount FROM safe_view';
    assert.throws(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount), PolicyError);
  });

  await t.test('Case 7: WITH safe_view AS (SELECT amount AS safe_amount FROM secret_salary) SELECT safe_amount FROM safe_view -> Block (CTE-aliased denied column via alias)', () => {
    const sql = 'WITH safe_view AS (SELECT amount AS safe_amount FROM secret_salary) SELECT safe_amount FROM safe_view';
    assert.throws(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount), PolicyError);
  });

  await t.test('Case 8: SELECT e.name FROM employees e WHERE e.id IN (SELECT s.employee_id FROM secret_salary s WHERE s.amount > 100) -> Block (Subquery denied column)', () => {
    const sql = 'SELECT e.name FROM employees e WHERE e.id IN (SELECT s.employee_id FROM secret_salary s WHERE s.amount > 100)';
    assert.throws(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount), PolicyError);
  });

  await t.test('Case 9: SELECT e.name FROM employees e WHERE e.id IN (SELECT s.employee_id FROM secret_salary s) -> Allow (Subquery safe column)', () => {
    const sql = 'SELECT e.name FROM employees e WHERE e.id IN (SELECT s.employee_id FROM secret_salary s)';
    assert.doesNotThrow(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount));
  });

  await t.test('Case 10: SELECT row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn FROM employees -> Block (KEYWORDS verification + denied column in window ORDER BY)', () => {
    const sql = 'SELECT row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn FROM employees';
    assert.throws(() => assertColumnAccess(sql, testSchema, policyEmployeesSalary), PolicyError);
  });
});

test('Domain 3.1: Subquery Alias Scoping (Cases C and D)', async (t) => {
  const policySecretSalaryAmount = {
    deniedColumns: [{ table: 'secret_salary', column: 'amount' }],
    rowFilters: [],
  };

  await t.test('Case C: SELECT sub.employee_id FROM (SELECT employee_id FROM secret_salary) sub -> Allow', () => {
    const sql = 'SELECT sub.employee_id FROM (SELECT employee_id FROM secret_salary) sub';
    assert.doesNotThrow(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount));
  });

  await t.test('Case D: SELECT sub.amount FROM (SELECT amount FROM secret_salary) sub -> Block', () => {
    const sql = 'SELECT sub.amount FROM (SELECT amount FROM secret_salary) sub';
    assert.throws(() => assertColumnAccess(sql, testSchema, policySecretSalaryAmount), PolicyError);
  });
});

test('Domain 3.2: Row Filter CTE Dialect Qualification', () => {
  const policy = {
    deniedColumns: [],
    rowFilters: [{ table: 'employees', column: 'dept_id', op: '=', value: '10' }],
  };

  // SQLite: main."employees"
  const sqliteSql = applyRowFilters('SELECT * FROM employees', testSchema, policy, 'sqlite');
  assert.ok(sqliteSql.includes('main."employees"'), 'SQLite row filter CTE must select from main."employees"');

  // Postgres: public."employees"
  const pgSql = applyRowFilters('SELECT * FROM employees', testSchema, policy, 'postgres');
  assert.ok(pgSql.includes('"public"."employees"') || pgSql.includes('public."employees"'), 'PostgreSQL row filter CTE must select from public."employees" to avoid CTE cycle');
});

test('Domain 3.3: requireDatasetAccess Query Parameter Support', () => {
  const { DatasetRegistry } = require('../../src/ingestion/dataset.registry');
  const ds = DatasetRegistry.create({ name: 'query_param_test', type: 'sqlite', source: 'upload', location: null, ownerId: 'usr_owner' });

  const middleware = requireDatasetAccess('read');

  // Passing datasetId via req.query
  let calledNext = false;
  const reqWithQuery = {
    params: {},
    body: {},
    query: { datasetId: ds.dataset_id },
    user: { user_id: 'usr_owner', role: 'user' },
  };
  const res = {
    status() { return this; },
    json() { return this; },
  };

  middleware(reqWithQuery, res, () => { calledNext = true; });
  assert.equal(calledNext, true, 'requireDatasetAccess must resolve datasetId from req.query');
  assert.equal(reqWithQuery.dataset.dataset_id, ds.dataset_id);
});

test('Domain 3.4: PolicyStore.removeForDataset Cascade', () => {
  const dsId = 'ds_cascade_test';
  PolicyStore.add({ datasetId: dsId, role: '*', kind: 'deny_column', columnName: 'salary' });
  assert.ok(PolicyStore.list(dsId).length > 0);

  PolicyStore.removeForDataset(dsId);
  assert.equal(PolicyStore.list(dsId).length, 0, 'removeForDataset must clear all policies for the dataset');
});

test('Domain 3.5: Database Cleanliness and Test Isolation', () => {
  assert.doesNotThrow(() => cleanTestDb(), 'cleanTestDb must execute without throwing');
});
