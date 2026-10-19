const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeEgress } = require('../../src/security/egress.guard');
const { diagnoseEmptyResult } = require('../../src/structured/result.checks');

describe('Egress Chokepoint (Item 3)', () => {
  const dataset = {
    dataset_id: 'ds_test',
    name: 'Test Bank',
    type: 'sqlite',
    schema: {
      tables: [
        {
          name: 'accts',
          columns: [
            { name: 'acct_id' },
            { name: 'holder_nm' },
            { name: 'city' },
            { name: 'bal' },
            { name: 'email' },
          ],
        },
      ],
    },
    profile: {
      semantic: {
        tables: [
          {
            name: 'accts',
            columns: [
              { name: 'holder_nm', pii: 'name', role: 'identifier' },
              { name: 'email', pii: 'email', role: 'identifier' },
              { name: 'bal', role: 'monetary' },
            ],
          },
        ],
      },
    },
  };

  const sampleRows = [
    { acct_id: 1, holder_nm: 'Alice Johnson', city: 'Bangalore', bal: 50000, email: 'alice@example.com' },
    { acct_id: 2, holder_nm: 'Bob Smith', city: 'Mumbai', bal: 75000, email: 'bob@corp.org' },
    { acct_id: 3, holder_nm: 'Charlie Davis', city: 'Bangalore', bal: 12000, email: 'charlie@bank.com' },
  ];

  test('sanitizeEgress applies row filter, denied-column removal, and PII redaction for viewer', () => {
    const rawResult = {
      columns: ['acct_id', 'holder_nm', 'city', 'bal', 'email'],
      rows: JSON.parse(JSON.stringify(sampleRows)),
      rowCount: 3,
    };

    const policy = {
      rowFilters: [
        { table: 'accts', column: 'city', op: '=', value: 'Bangalore' },
      ],
      deniedColumns: [
        { table: 'accts', column: 'bal' },
      ],
    };

    const viewer = { user_id: 'u_viewer', role: 'viewer' };
    const sanitized = sanitizeEgress({
      result: rawResult,
      dataset,
      user: viewer,
      policy,
      tableName: 'accts',
    });

    // 1. Row filter check: only Bangalore rows remain
    assert.equal(sanitized.rows.length, 2);
    assert.ok(sanitized.rows.every(r => r.city === 'Bangalore'));
    assert.equal(sanitized.rowCount, 2);

    // 2. Denied-column removal check: 'bal' column is completely removed
    assert.ok(!sanitized.columns.includes('bal'));
    assert.ok(sanitized.rows.every(r => r.bal === undefined));

    // 3. PII redaction check: email and name are masked for viewer
    assert.ok(sanitized.rows.every(r => !r.email.includes('alice@example.com')));
    assert.ok(sanitized.rows.every(r => r.email.includes('***')));
  });

  test('sanitizeEgress permits full access for admin', () => {
    const rawResult = {
      columns: ['acct_id', 'holder_nm', 'city', 'bal', 'email'],
      rows: JSON.parse(JSON.stringify(sampleRows)),
      rowCount: 3,
    };

    const policy = {
      rowFilters: [{ table: 'accts', column: 'city', op: '=', value: 'Bangalore' }],
      deniedColumns: [{ table: 'accts', column: 'bal' }],
    };

    const admin = { user_id: 'u_admin', role: 'admin' };
    const sanitized = sanitizeEgress({
      result: rawResult,
      dataset,
      user: admin,
      policy,
      tableName: 'accts',
    });

    assert.equal(sanitized.rows.length, 3);
    assert.ok(sanitized.columns.includes('bal'));
    assert.equal(sanitized.rows[0].email, 'alice@example.com');
  });

  test('diagnoseEmptyResult returns no available values for restricted users', async () => {
    const mockAdapter = {
      async executeQuery(sql) {
        if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ n: 0 }] };
        return {
          rows: [
            { v: 'Mumbai', n: 10 },
            { v: 'Delhi', n: 5 },
            { v: 'Bangalore', n: 2 },
          ],
        };
      },
    };

    const policy = {
      rowFilters: [{ table: 'accts', column: 'city', op: '=', value: 'Bangalore' }],
      deniedColumns: [],
    };

    const viewer = { user_id: 'u_viewer', role: 'viewer' };
    const diag = await diagnoseEmptyResult({
      adapter: mockAdapter,
      sql: "SELECT * FROM accts WHERE city = 'Atlantis'",
      schema: dataset.schema,
      datasetType: 'sqlite',
      policy,
      user: viewer,
    });

    assert.ok(diag.findings.length > 0);
    const finding = diag.findings[0];
    assert.equal(finding.type, 'value_not_found');
    // Must NOT leak raw database values to restricted user
    assert.ok(!finding.available || finding.available.length === 0, 'Restricted user should not receive available values');
  });
});
