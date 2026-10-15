'use strict';

const Database = require('../../server/node_modules/better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../../database/bank/B2_district.db');
const db = new Database(dbPath, { readonly: true });

const t0 = Date.now();
for (let i = 0; i < 1000; i++) {
  const rows = db.prepare('SELECT account_id, balance FROM accounts LIMIT 5').all();
}
const elapsed = Date.now() - t0;
console.log(`1,000 queries took ${elapsed} ms (${(1000 / (elapsed / 1000)).toFixed(0)} q/s)`);
db.close();
