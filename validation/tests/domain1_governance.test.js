const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectRelationships,
  extractIdStem,
  ROLE_SELF_REF_STEMS,
  AUDIT_USER_STEMS,
  USER_TABLE_CANDIDATES,
} = require('../../server/src/schema/relationship.detector');

const {
  shortestJoinPath,
  buildJoinSkeleton,
  renderJoinHints,
  MIN_TRAVERSABLE_CONFIDENCE,
} = require('../../server/src/schema/join.planner');

const { cleanSqlOutput } = require('../../server/src/structured/sql.generator');
const { diagnoseEmptyResult } = require('../../server/src/structured/result.checks');

// ============================================================================
// 1. cleanSqlOutput Tests (Semicolon & Fence Hygiene)
// ============================================================================
test('cleanSqlOutput: preserves semicolons within single-quoted string literals', () => {
  const raw = "SELECT * FROM logs WHERE message = 'error; code 101'; -- comment";
  const cleaned = cleanSqlOutput(raw);
  assert.equal(cleaned, "SELECT * FROM logs WHERE message = 'error; code 101'");
});

test('cleanSqlOutput: preserves escaped single quotes and semicolons within string literals', () => {
  const raw = "SELECT * FROM logs WHERE message = 'it''s a trap; run';";
  const cleaned = cleanSqlOutput(raw);
  assert.equal(cleaned, "SELECT * FROM logs WHERE message = 'it''s a trap; run'");
});

test('cleanSqlOutput: preserves semicolons within double-quoted identifiers', () => {
  const raw = 'SELECT "col;name", val FROM "my;table"; SELECT 2;';
  const cleaned = cleanSqlOutput(raw);
  assert.equal(cleaned, 'SELECT "col;name", val FROM "my;table"');
});

test('cleanSqlOutput: cleanly extracts SQL from markdown code fences amidst conversational text', () => {
  const raw = `Here is your SQL query to find all active users:
\`\`\`sql
SELECT user_id, email FROM users WHERE is_active = 1;
\`\`\`
Let me know if you need any adjustments!`;
  const cleaned = cleanSqlOutput(raw);
  assert.equal(cleaned, 'SELECT user_id, email FROM users WHERE is_active = 1');
});

// ============================================================================
// 2. extractIdStem Tests (Boundary & False Positive Defense)
// ============================================================================
test('extractIdStem: correctly extracts stems for valid foreign key column conventions', () => {
  assert.equal(extractIdStem('department_id'), 'department');
  assert.equal(extractIdStem('parent_category_id'), 'parent_category');
  assert.equal(extractIdStem('employeeId'), 'employee');
  assert.equal(extractIdStem('studentID'), 'student');
  assert.equal(extractIdStem('created_by_id'), 'created_by');
  assert.equal(extractIdStem('assigned_to_id'), 'assigned_to');
  assert.equal(extractIdStem('id'), null); // Primary key itself, not an FK stem
  assert.equal(extractIdStem('ID'), null);
});

test('extractIdStem: rejects common non-FK English words ending in "id"', () => {
  const nonFkWords = [
    'valid', 'rigid', 'fluid', 'hybrid', 'candid',
    'lucid', 'vivid', 'splendid', 'livid', 'sordid', 'rabid', 'morbid',
  ];
  for (const word of nonFkWords) {
    assert.equal(extractIdStem(word), null, `Expected word '${word}' not to be recognized as FK stem`);
  }
});

// ============================================================================
// 3. detectRelationships Tests (Strict Ordering & Confidence Hierarchy)
// ============================================================================
test('detectRelationships: assigns confidence 0.5 to external outbound naming heuristic', () => {
  const schema = {
    tables: [
      {
        name: 'orders',
        columns: [{ name: 'id', primaryKey: true }, { name: 'customer_id' }],
        foreignKeys: [],
      },
      {
        name: 'customers',
        columns: [{ name: 'id', primaryKey: true }, { name: 'name' }],
        foreignKeys: [],
      },
    ],
  };
  const rels = detectRelationships(schema);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].fromTable, 'orders');
  assert.equal(rels[0].toTable, 'customers');
  assert.equal(rels[0].confidence, 0.5);
  assert.equal(rels[0].method, 'naming_heuristic');
});

test('detectRelationships: detects structural self-references at confidence 0.35', () => {
  const schema = {
    tables: [
      {
        name: 'categories',
        columns: [
          { name: 'category_id', primaryKey: true },
          { name: 'category_name' },
          { name: 'parent_category_id' },
        ],
        foreignKeys: [],
      },
    ],
  };
  const rels = detectRelationships(schema);
  assert.equal(rels.length, 1);
  assert.equal(rels[0].fromTable, 'categories');
  assert.equal(rels[0].toTable, 'categories');
  assert.equal(rels[0].toColumn, 'category_id');
  assert.equal(rels[0].confidence, 0.35);
  assert.equal(rels[0].method, 'structural_self_reference');
});

test('detectRelationships: detects role-based self-references at confidence 0.3', () => {
  const schema = {
    tables: [
      {
        name: 'employees',
        columns: [
          { name: 'emp_id', primaryKey: true },
          { name: 'name' },
          { name: 'manager_id' },
          { name: 'mentor_id' },
        ],
        foreignKeys: [],
      },
    ],
  };
  const rels = detectRelationships(schema);
  assert.equal(rels.length, 2);
  const managerRel = rels.find((r) => r.fromColumn === 'manager_id');
  const mentorRel = rels.find((r) => r.fromColumn === 'mentor_id');
  assert.ok(managerRel);
  assert.equal(managerRel.toTable, 'employees');
  assert.equal(managerRel.confidence, 0.3);
  assert.equal(managerRel.method, 'role_self_reference');
  assert.ok(mentorRel);
  assert.equal(mentorRel.toTable, 'employees');
  assert.equal(mentorRel.confidence, 0.3);
});

test('detectRelationships: detects audit/role user reference pointing to users table at confidence 0.3', () => {
  const schema = {
    tables: [
      {
        name: 'tickets',
        columns: [
          { name: 'ticket_id', primaryKey: true },
          { name: 'assigned_to_id' },
          { name: 'created_by_id' },
        ],
        foreignKeys: [],
      },
      {
        name: 'users',
        columns: [{ name: 'id', primaryKey: true }, { name: 'email' }],
        foreignKeys: [],
      },
    ],
  };
  const rels = detectRelationships(schema);
  assert.equal(rels.length, 2);
  const assignedRel = rels.find((r) => r.fromColumn === 'assigned_to_id');
  assert.ok(assignedRel);
  assert.equal(assignedRel.toTable, 'users');
  assert.equal(assignedRel.confidence, 0.3);
  assert.equal(assignedRel.method, 'audit_role_user_reference');
});

// ============================================================================
// 4. buildJoinSkeleton & join.planner Tests (Aliasing & Direct Fallback)
// ============================================================================
test('buildJoinSkeleton: generates clean unaliased join skeleton for distinct tables', () => {
  const path = [
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id' },
  ];
  const skeleton = buildJoinSkeleton('orders', path);
  assert.equal(
    skeleton,
    'FROM "orders"\n  JOIN "customers" ON "orders"."customer_id" = "customers"."id"'
  );
});

test('buildJoinSkeleton: generates collision-free query-scoped counter aliases (t1, t2) for self-joins', () => {
  const path = [
    { fromTable: 'employees', fromColumn: 'manager_id', toTable: 'employees', toColumn: 'emp_id' },
  ];
  const skeleton = buildJoinSkeleton('employees', path);
  assert.equal(
    skeleton,
    'FROM "employees" AS "t1"\n  JOIN "employees" AS "t2" ON "t1"."manager_id" = "t2"."emp_id"'
  );
});

test('buildJoinSkeleton: handles repeating tables in multi-hop chains without 3-char prefix collision', () => {
  // users -> user_settings -> users (e.g. referer)
  const path = [
    { fromTable: 'users', fromColumn: 'setting_id', toTable: 'user_settings', toColumn: 'id' },
    { fromTable: 'user_settings', fromColumn: 'auditor_id', toTable: 'users', toColumn: 'id' },
  ];
  const skeleton = buildJoinSkeleton('users', path);
  assert.equal(
    skeleton,
    'FROM "users" AS "t1"\n  JOIN "user_settings" AS "t2" ON "t1"."setting_id" = "t2"."id"\n  JOIN "users" AS "t3" ON "t2"."auditor_id" = "t3"."id"'
  );
});

test('shortestJoinPath: enforces MIN_TRAVERSABLE_CONFIDENCE (0.4) and excludes self-refs in multi-hop paths', () => {
  const relationships = [
    // employees self-ref (conf 0.3)
    { fromTable: 'employees', fromColumn: 'manager_id', toTable: 'employees', toColumn: 'id', confidence: 0.3 },
    // audit link to users (conf 0.3)
    { fromTable: 'audit_logs', fromColumn: 'created_by_id', toTable: 'users', toColumn: 'id', confidence: 0.3 },
    // declared valid path
    { fromTable: 'orders', fromColumn: 'customer_id', toTable: 'customers', toColumn: 'id', confidence: 0.5 },
    { fromTable: 'order_items', fromColumn: 'order_id', toTable: 'orders', toColumn: 'id', confidence: 0.5 },
  ];

  // Self-ref edges should not be traversable in shortestJoinPath
  const selfPath = shortestJoinPath(relationships, 'employees', 'employees');
  assert.deepEqual(selfPath, []);

  // Low confidence audit link should not be traversable in multi-hop path search
  const auditPath = shortestJoinPath(relationships, 'audit_logs', 'users');
  assert.equal(auditPath, null);

  // High confidence path is cleanly traversable
  const orderPath = shortestJoinPath(relationships, 'order_items', 'customers');
  assert.ok(orderPath);
  assert.equal(orderPath.length, 2);
});

test('renderJoinHints: renders up to 3 self-join hints for tables with multiple self-refs', () => {
  const schema = {
    tables: [
      {
        name: 'employees',
        columns: [
          { name: 'emp_id', primaryKey: true },
          { name: 'manager_id' },
          { name: 'mentor_id' },
        ],
      },
    ],
  };
  const relationships = [
    { fromTable: 'employees', fromColumn: 'manager_id', toTable: 'employees', toColumn: 'emp_id', confidence: 0.3 },
    { fromTable: 'employees', fromColumn: 'mentor_id', toTable: 'employees', toColumn: 'emp_id', confidence: 0.3 },
  ];

  const hints = renderJoinHints('show employees and their manager or mentor', schema, relationships);
  assert.ok(hints.includes('To self-join "employees" (via manager_id):'));
  assert.ok(hints.includes('To self-join "employees" (via mentor_id):'));
  assert.ok(hints.includes('"employees" AS "t1"'));
  assert.ok(hints.includes('"employees" AS "t2"'));
});

test('renderJoinHints: direct-pair fallback surfaces 1-hop audit edges for direct queries', () => {
  const schema = {
    tables: [
      { name: 'tasks', columns: [{ name: 'id', primaryKey: true }, { name: 'assigned_to_id' }] },
      { name: 'users', columns: [{ name: 'id', primaryKey: true }, { name: 'email' }] },
    ],
  };
  const relationships = [
    {
      fromTable: 'tasks',
      fromColumn: 'assigned_to_id',
      toTable: 'users',
      toColumn: 'id',
      confidence: 0.3,
      method: 'audit_role_user_reference',
    },
  ];

  const hints = renderJoinHints('show tasks and the assigned users', schema, relationships);
  assert.ok(hints.includes('To combine "tasks" with "users", use:'));
  assert.ok(hints.includes('FROM "tasks"\n  JOIN "users" ON "tasks"."assigned_to_id" = "users"."id"'));
});

// ============================================================================
// 5. diagnoseEmptyResult Tests (Pure Diagnostic, Zero Mutation)
// ============================================================================
test('diagnoseEmptyResult: returns pure findings without mutating query or producing repairedSql', async () => {
  const mockAdapter = {
    executeQuery: async () => ({ rows: [{ n: 1 }] }),
  };
  const schema = {
    tables: [
      {
        name: 'customers',
        columns: [{ name: 'name', type: 'text' }],
      },
    ],
  };
  const sql = "SELECT * FROM customers WHERE name = 'Alice'";
  const result = await diagnoseEmptyResult({
    adapter: mockAdapter,
    sql,
    schema,
    datasetType: 'sqlite',
  });

  assert.equal(result.repairedSql, undefined, 'repairedSql must never be returned');
  assert.ok(Array.isArray(result.findings));
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, 'case_or_whitespace_mismatch');
  assert.equal(result.findings[0].column, 'name');
});
