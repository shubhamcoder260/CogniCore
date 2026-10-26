'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function buildMultiTenantBank() {
  const fixturesDir = path.resolve(__dirname, '../../data/fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });
  const dbPath = path.join(fixturesDir, 'multi_tenant_bank.sqlite');

  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE customers (
      customer_id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE accounts (
      account_id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      balance REAL NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    );

    -- Seed Tenant A (Acme Corp)
    INSERT INTO customers (customer_id, tenant_id, name) VALUES
      (1, 'tenant_a', 'Acme Executive [CANARY_TENANT_A_CUST_1]'),
      (2, 'tenant_a', 'Acme Operations [CANARY_TENANT_A_CUST_2]');

    INSERT INTO accounts (account_id, tenant_id, customer_id, balance) VALUES
      (101, 'tenant_a', 1, 50000.00),
      (102, 'tenant_a', 2, 12500.50);

    -- Seed Tenant B (Beta LLC)
    INSERT INTO customers (customer_id, tenant_id, name) VALUES
      (3, 'tenant_b', 'Beta Founder [CANARY_TENANT_B_CUST_3]'),
      (4, 'tenant_b', 'Beta Engineer [CANARY_TENANT_B_CUST_4]');

    INSERT INTO accounts (account_id, tenant_id, customer_id, balance) VALUES
      (201, 'tenant_b', 3, 750000.00),
      (202, 'tenant_b', 4, 3200.75);
  `);

  db.close();
  console.log(`Successfully generated direct-key bank fixture: ${dbPath}`);
}

if (require.main === module) {
  buildMultiTenantBank();
}

module.exports = { buildMultiTenantBank };
