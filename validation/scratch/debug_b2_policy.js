const fs = require('fs');
const Database = require('../../server/node_modules/better-sqlite3');
const { rowOracle } = require('../lib/v3_oracles');

const e2e = fs.readFileSync('validation/raw/v3_e2e_results.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const item = e2e.find(r => r.id === 'v3_row_0048');

console.log('item.policy:', item.policy);
console.log('item.sql:', item.sql);
const res = rowOracle(item.fixture, item, item.sql, { rows: [{ account_id: 1, branch_name: null }] });
console.log('res:', res);
