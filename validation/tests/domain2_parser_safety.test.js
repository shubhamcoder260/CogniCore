const test = require('node:test');
const assert = require('node:assert/strict');

const {
  stripLiterals,
  findUnknownColumns,
} = require('../../server/src/structured/sql.analyzer');

const {
  validateSql,
  SQLValidationError,
  BLOCKED_KEYWORDS,
} = require('../../server/src/structured/sql.validator');

const {
  enforceLimit,
} = require('../../server/src/structured/sql.executor');

const {
  repairTableNames,
} = require('../../server/src/structured/sql.repair');

// ============================================================================
// 1. stripLiterals Tests
// ============================================================================
test('stripLiterals: masks single quotes, double quotes, and backticks while preserving length', () => {
  const sql = "SELECT `foo;bar`, \"col--name\" FROM 'my--table' WHERE msg = 'err; code';";
  const stripped = stripLiterals(sql);
  assert.equal(stripped.length, sql.length);
  assert.equal(stripped.includes(';'), true); // only trailing statement semicolon
  assert.equal(stripped.indexOf(';'), sql.length - 1);
  assert.equal(/--/.test(stripped), false); // internal double dashes masked
});

test('stripLiterals: handles escaped quotes cleanly', () => {
  const sql = "SELECT * FROM t WHERE str = 'it''s fine; really';";
  const stripped = stripLiterals(sql);
  assert.equal(stripped.length, sql.length);
  assert.equal(stripped.indexOf(';'), sql.length - 1);
});

// ============================================================================
// 2. Keyword & Comment Hygiene Tests (2.1 & 2.2)
// ============================================================================
test('sql.validator: allows scalar REPLACE function', () => {
  const schema = {
    tables: [{ name: 'contacts', columns: [{ name: 'phone' }] }],
  };
  const res = validateSql("SELECT REPLACE(phone, '-', '') FROM contacts", schema, 'sqlite');
  assert.equal(res.valid, true);
});

test('sql.validator: blocks DML REPLACE INTO statement', () => {
  const schema = {
    tables: [{ name: 'contacts', columns: [{ name: 'phone' }] }],
  };
  assert.throws(
    () => validateSql("REPLACE INTO contacts (phone) VALUES ('123')", schema, 'sqlite'),
    SQLValidationError
  );
});

test('sql.validator: permits queries querying data matching blocked keyword values', () => {
  const schema = {
    tables: [{ name: 'audit_logs', columns: [{ name: 'id' }, { name: 'action' }] }],
  };
  const res = validateSql("SELECT id FROM audit_logs WHERE action = 'DELETE'", schema, 'sqlite');
  assert.equal(res.valid, true);
});

test('sql.validator: permits string literals containing double dashes and semicolons', () => {
  const schema = {
    tables: [{ name: 'users', columns: [{ name: 'email' }, { name: 'notes' }] }],
  };
  const res = validateSql(
    "SELECT email FROM users WHERE email = 'user--test@example.com' AND notes = 'status; active';",
    schema,
    'sqlite'
  );
  assert.equal(res.valid, true);
});

test('sql.validator: strictly blocks actual SQL comments and multi-statement attacks', () => {
  const schema = {
    tables: [{ name: 'users', columns: [{ name: 'email' }] }],
  };
  assert.throws(() => validateSql('SELECT email FROM users -- comment', schema, 'sqlite'), SQLValidationError);
  assert.throws(() => validateSql('SELECT email FROM users /* comment */', schema, 'sqlite'), SQLValidationError);
  assert.throws(() => validateSql('SELECT email FROM users; DROP TABLE users;', schema, 'sqlite'), SQLValidationError);
});

// ============================================================================
// 3. Column Validation & buildScope Tests (2.3)
// ============================================================================
test('findUnknownColumns: handles window functions with OVER, PARTITION BY, ORDER BY', () => {
  const schema = {
    tables: [
      { name: 'employees', columns: [{ name: 'dept_id' }, { name: 'salary' }] },
    ],
  };
  const sql = 'SELECT row_number() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rn FROM employees';
  const unknown = findUnknownColumns(sql, schema);
  assert.deepEqual(unknown, []);
});

test('findUnknownColumns: handles implicit column aliases (no AS)', () => {
  const schema = {
    tables: [{ name: 't', columns: [{ name: 'a' }, { name: 'c' }] }],
  };
  const sql = 'SELECT a b, c d FROM t';
  const unknown = findUnknownColumns(sql, schema);
  assert.deepEqual(unknown, []);
});

test('findUnknownColumns: fails open on table-valued functions', () => {
  const schema = {
    tables: [{ name: 'users', columns: [{ name: 'id' }] }],
  };
  const sql = 'SELECT n FROM generate_series(1, 10)';
  const unknown = findUnknownColumns(sql, schema);
  assert.deepEqual(unknown, []);
});

test('findUnknownColumns: flags genuinely hallucinated columns', () => {
  const schema = {
    tables: [{ name: 'users', columns: [{ name: 'id' }, { name: 'email' }] }],
  };
  const sql = 'SELECT id, fake_column FROM users';
  const unknown = findUnknownColumns(sql, schema);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].name, 'fake_column');
});

test('sql.validator: shadow mode logs but does not throw on unknown columns by default', () => {
  const schema = {
    tables: [{ name: 'users', columns: [{ name: 'id' }] }],
  };
  delete process.env.ENFORCE_COLUMN_VALIDATION;
  const res = validateSql('SELECT id, ghost_col FROM users', schema, 'sqlite');
  assert.equal(res.valid, true);
});

test('sql.validator: throws on unknown columns when ENFORCE_COLUMN_VALIDATION is true', () => {
  const schema = {
    tables: [{ name: 'users', columns: [{ name: 'id' }] }],
  };
  process.env.ENFORCE_COLUMN_VALIDATION = 'true';
  try {
    assert.throws(() => validateSql('SELECT id, ghost_col FROM users', schema, 'sqlite'), SQLValidationError);
  } finally {
    delete process.env.ENFORCE_COLUMN_VALIDATION;
  }
});

// ============================================================================
// 4. enforceLimit & CTE Preservation Tests (2.4)
// ============================================================================
test('enforceLimit: wraps plain SELECT query in subquery with limit', () => {
  const sql = 'SELECT id, name FROM users WHERE active = 1';
  const capped = enforceLimit(sql, 500);
  assert.equal(capped, 'SELECT * FROM (SELECT id, name FROM users WHERE active = 1) AS __cognicore_capped LIMIT 500');
});

test('enforceLimit: preserves top-level CTE structure across SQL engines', () => {
  const sql = 'WITH active_users AS (SELECT id FROM users WHERE active = 1) SELECT * FROM active_users';
  const capped = enforceLimit(sql, 250);
  assert.equal(
    capped,
    'WITH active_users AS (SELECT id FROM users WHERE active = 1) SELECT * FROM (SELECT * FROM active_users) AS __cognicore_capped LIMIT 250'
  );
});

// ============================================================================
// 5. repairTableNames All 9 Hardened Cases (2.5)
// ============================================================================
const repairSchema = {
  tables: [
    { name: 'employee', columns: [{ name: 'id' }, { name: 'dept_id' }, { name: 'name' }] },
    { name: 'department', columns: [{ name: 'id' }, { name: 'name' }] },
    { name: 'ctes', columns: [{ name: 'id' }] },
    { name: 'users', columns: [{ name: 'id' }] },
    { name: 'employees', columns: [{ name: 'id' }, { name: 'dept_id' }] },
    { name: 'departments', columns: [{ name: 'id' }] },
    { name: 'hrs', columns: [{ name: 'id' }] },
  ],
};

test('repairTableNames: Case 1 - literal untouched, employe -> employee', () => {
  const res = repairTableNames("SELECT 'active employees' AS x FROM employe", repairSchema, 'sqlite');
  assert.equal(res.sql, "SELECT 'active employees' AS x FROM employee");
  assert.equal(res.repaired, true);
});

test('repairTableNames: Case 2 - schema-qualified repair hr.employe -> hr.employee', () => {
  const res = repairTableNames('SELECT * FROM hr.employe', repairSchema, 'sqlite');
  assert.equal(res.sql, 'SELECT * FROM hr.employee');
  assert.equal(res.repaired, true);
});

test('repairTableNames: Case 3 - comma-separated repair employe, department', () => {
  const res = repairTableNames('SELECT * FROM employe, department', repairSchema, 'sqlite');
  assert.equal(res.sql, 'SELECT * FROM employee, department');
  assert.equal(res.repaired, true);
});

test('repairTableNames: Case 4 - multi-occurrence surgical repair on join and qualifier', () => {
  const res = repairTableNames(
    'SELECT * FROM employe JOIN department ON employe.dept_id = department.id',
    repairSchema,
    'sqlite'
  );
  assert.equal(res.sql, 'SELECT * FROM employee JOIN department ON employee.dept_id = department.id');
  assert.equal(res.repaired, true);
});

test('repairTableNames: Case 5 - dialect-correct quoting (MySQL backticks)', () => {
  const res = repairTableNames('SELECT `employe`.name FROM `employe`', repairSchema, 'mysql');
  assert.equal(res.sql, 'SELECT `employee`.name FROM `employee`');
  assert.equal(res.repaired, true);
});

test('repairTableNames: Case 6 - CTE names not fuzzy matched', () => {
  const res = repairTableNames('WITH cte AS (SELECT 1) SELECT * FROM cte', repairSchema, 'sqlite');
  assert.equal(res.sql, 'WITH cte AS (SELECT 1) SELECT * FROM cte');
  assert.equal(res.repaired, false);
});

test('repairTableNames: Case 7 - short names (< 4 chars) not fuzzy matched', () => {
  const res = repairTableNames('SELECT * FROM usr', repairSchema, 'sqlite');
  assert.equal(res.sql, 'SELECT * FROM usr');
  assert.equal(res.repaired, false);
});

test('repairTableNames: Case 8 - implicit table aliases (no AS) not repaired', () => {
  const res = repairTableNames('SELECT * FROM employees e JOIN departments d ON e.dept_id = d.id', repairSchema, 'sqlite');
  assert.equal(res.sql, 'SELECT * FROM employees e JOIN departments d ON e.dept_id = d.id');
  assert.equal(res.repaired, false);
});

test('repairTableNames: Case 9 - schema qualifier prefix not repaired', () => {
  const res = repairTableNames('SELECT * FROM hr.employees', repairSchema, 'sqlite');
  assert.equal(res.sql, 'SELECT * FROM hr.employees');
  assert.equal(res.repaired, false);
});
