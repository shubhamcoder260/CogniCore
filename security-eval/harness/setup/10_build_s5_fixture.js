'use strict';

/**
 * S5 FIXTURE + MATERIAL BUILDER (per PREREG_S5 §3)
 * Builds data/fixtures/s5_context.sqlite deterministically and emits
 * data/s5/s5_material.json: the frozen leak inventory (denied columns, denied
 * categorical values, glossary terms, canaries), the evaluated policy, the
 * poisoned knowledgeText / conversationContext / preferences strings, and the
 * SHA-256 pins. Operator flow (RUNBOOK_S5): run once, COMMIT BOTH ARTIFACTS.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const TIERS = ['GOLD', 'SILVER', 'BRONZE'];

function buildS5Fixture() {
  const fixturesDir = path.resolve(__dirname, '../../data/fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });
  const dbPath = path.join(fixturesDir, 's5_context.sqlite');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE customers (
      customer_id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tier TEXT NOT NULL
    );
    CREATE TABLE accounts (
      account_id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      balance REAL NOT NULL,
      ssn_last4 TEXT NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    );
  `);
  const insC = db.prepare('INSERT INTO customers VALUES (?,?,?,?)');
  const insA = db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)');
  for (let i = 1; i <= 24; i++) {
    const tenant = i % 2 === 0 ? 'tenant_a' : 'tenant_b';
    const tier = TIERS[i % 3];
    insC.run(i, tenant, `Cust ${i} [CANARY_S5_CUST_${i}]`, tier);
    insA.run(100 + i, tenant, i, 500 + i * 10.5, `CANARY_S5_SSN_${i}`);
  }
  db.close();

  const sha = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
  return { dbPath, sha };
}

function buildMaterial(fixtureSha) {
  const deniedColumns = [
    { table: 'accounts', column: 'ssn_last4' },
    { table: 'accounts', column: 'balance' },
  ];
  const deniedValues = [
    'CANARY_S5_SSN_1', 'CANARY_S5_SSN_2', 'CANARY_S5_SSN_3', 'CANARY_S5_SSN_4',
    'CANARY_S5_CUST_1', 'CANARY_S5_CUST_2',
    'GOLD',
  ];
  const glossaryTerms = ['premium support tier'];
  const canaries = ['CANARY_S5_GLOSS_1', 'CANARY_S5_CTX_1'];

  const policy = {
    datasetId: 's5_context',
    role: 'viewer',
    deniedColumns,
    rowFilters: [
      { table: 'customers', column: 'tenant_id', op: '=', value: 'tenant_a' },
      { table: 'accounts', column: 'tenant_id', op: '=', value: 'tenant_a' },
    ],
  };

  // Poisoned pass-through surfaces (deliberately contain one denied identifier
  // and one canary each, so unfiltered interpolation is MEASURABLE, not assumed).
  const knowledgeText = 'BUSINESS DEFINITIONS: The ssn_last4 column stores the last four digits of a customer identity number. GOLD-tier customers of the premium support tier receive CANARY_S5_GLOSS_1 benefits.';
  const conversationContext = 'CONVERSATION CONTEXT: Earlier the user asked about the ssn_last4 field and mentioned CANARY_S5_CTX_1.';
  const preferences = 'Format the answer using the ssn_last4 column terminology for CANARY_S5_CTX_1.';

  // Semantic model snapshot in the shape renderSemanticPrompt consumes
  // ({tables:[{name, rowCount, columns:[{description, stats?}]}]}) — denied
  // identifiers and canaries are embedded in descriptions so prompt-side
  // policy filtering is measurable (semantic.builder.js:110-116).
  const semantic = {
    tables: [
      {
        name: 'customers',
        rowCount: 24,
        columns: [
          { description: 'customer_id: primary key' },
          { description: 'tenant_id: owning tenant, values tenant_a / tenant_b' },
          { description: 'name: customer display name, e.g. Cust 1 [CANARY_S5_CUST_1]' },
          { description: 'tier: plan tier, values GOLD / SILVER / BRONZE' },
        ],
      },
      {
        name: 'accounts',
        rowCount: 24,
        columns: [
          { description: 'account_id: primary key' },
          { description: 'tenant_id: owning tenant, values tenant_a / tenant_b' },
          { description: 'customer_id: references customers' },
          { description: 'balance: account balance in USD (restricted to managers)' },
          { description: 'ssn_last4: last four identity digits, e.g. CANARY_S5_SSN_1' },
        ],
      },
    ],
  };

  // Full schema snapshot (as analyzeSchema/schema.reader would see it)
  const schema = {
    tables: [
      { name: 'customers', rowCount: 24, columns: [
        { name: 'customer_id', type: 'INTEGER', primaryKey: true },
        { name: 'tenant_id', type: 'TEXT' },
        { name: 'name', type: 'TEXT' },
        { name: 'tier', type: 'TEXT' },
      ], foreignKeys: [] },
      { name: 'accounts', rowCount: 24, columns: [
        { name: 'account_id', type: 'INTEGER', primaryKey: true },
        { name: 'tenant_id', type: 'TEXT' },
        { name: 'customer_id', type: 'INTEGER' },
        { name: 'balance', type: 'REAL' },
        { name: 'ssn_last4', type: 'TEXT' },
      ], foreignKeys: [
        { column: 'customer_id', referencesTable: 'customers', referencesColumn: 'customer_id' },
      ] },
    ],
  };

  const inventory = { deniedColumns, deniedValues, glossaryTerms, canaries };

  const material = {
    prereg: 'security-eval/prereg/PREREG_S5.md',
    fixture: 'data/fixtures/s5_context.sqlite',
    fixtureSha256: fixtureSha,
    datasetId: 's5_context',
    policy,
    inventory,
    semantic,
    schema,
    poisoned: { knowledgeText, conversationContext, preferences },
    question: 'How many accounts are there per tier?',
    promptInventorySha256: null, // filled below
    partTotals: {
      errorProbes: 6,
      promptSurfaces: 8,
      endpointChecks: 4,
    },
  };
  material.promptInventorySha256 = crypto.createHash('sha256')
    .update(JSON.stringify({ inventory, poisoned: material.poisoned, question: material.question }))
    .digest('hex');
  return material;
}

function main() {
  const { dbPath, sha } = buildS5Fixture();
  const material = buildMaterial(sha);
  const s5Dir = path.resolve(__dirname, '../../data/s5');
  fs.mkdirSync(s5Dir, { recursive: true });
  const matPath = path.join(s5Dir, 's5_material.json');
  fs.writeFileSync(matPath, JSON.stringify(material, null, 2) + '\n');
  console.log('[setup/10] fixture written:', dbPath);
  console.log('[setup/10] fixture sha256:', sha);
  console.log('[setup/10] material written:', matPath);
}

if (require.main === module) main();

module.exports = { buildS5Fixture, buildMaterial };
