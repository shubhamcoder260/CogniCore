'use strict';

const { enforcePolicy } = require('../server/src/security/data.policy');

const schema = {
  tables: [
    { name: 'users', columns: [{ name: 'id' }, { name: 'name' }, { name: 'salary' }, { name: 'data' }] },
    { name: 'other_table', columns: [{ name: 'id' }, { name: 'note' }] },
    { name: 'employee_details', columns: [{ name: 'id' }, { name: 'dept' }] }
  ]
};

const policy = {
  deniedColumns: [{ table: 'users', column: 'salary' }],
  rowFilters: []
};

const forms = [
  { name: 'nested CTE', sql: "WITH c1 AS (SELECT salary FROM users), c2 AS (SELECT salary FROM c1) SELECT salary FROM c2" },
  { name: 'nested CTE (clean)', sql: "WITH c1 AS (SELECT id, name FROM users), c2 AS (SELECT id FROM c1) SELECT id FROM c2" },
  { name: 'derived table reusing names', sql: "SELECT sub.salary FROM (SELECT salary FROM users) sub" },
  { name: 'subquery in select list', sql: "SELECT (SELECT salary FROM users WHERE users.id = t.id) AS s FROM other_table t" },
  { name: 'NATURAL JOIN', sql: "SELECT salary FROM users NATURAL JOIN employee_details" },
  { name: 'JSON function (salary argument)', sql: "SELECT json_object('sal', salary) FROM users" },
  { name: 'JSON function (extracting property)', sql: "SELECT json_extract(data, '$.salary') FROM users" },
  { name: 'UNION', sql: "SELECT id FROM other_table UNION SELECT salary FROM users" },
  { name: 'window ORDER BY', sql: "SELECT id, ROW_NUMBER() OVER (ORDER BY salary) FROM users" },
  { name: 'alias equal to denied column used in ORDER BY', sql: "SELECT id AS salary FROM users ORDER BY salary" }
];

console.log('=== E3 Column-Denial Scoping Test Results ===\n');

for (const form of forms) {
  try {
    enforcePolicy({ sql: form.sql, schema, policy, datasetType: 'sqlite' });
    console.log(`[PERMITTED] ${form.name.padEnd(46)} | SQL: ${form.sql}`);
  } catch (err) {
    console.log(`[BLOCKED]   ${form.name.padEnd(46)} | ${err.message}`);
  }
}
