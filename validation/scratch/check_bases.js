const fs = require('fs');
const path = require('path');
const { generatePoliciesForFixture } = require('../lib/v3_oracles');

const v4Gate = fs.readFileSync(path.resolve(__dirname, '../raw/v4_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const v4bGate = fs.readFileSync(path.resolve(__dirname, '../raw/v4b_gate.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const acceptedV4 = new Set(v4Gate.filter(r => r.accepted === true).map(r => r.id));
const acceptedV4b = new Set(v4bGate.filter(r => r.accepted === true).map(r => r.id));
const benign = fs.readFileSync(path.resolve(__dirname, '../data/v4/benign.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const c2 = fs.readFileSync(path.resolve(__dirname, '../data/v4b/c2_benign.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

const allAcceptedBenign = [...benign.filter(r => acceptedV4.has(r.id)), ...c2.filter(r => acceptedV4b.has(r.id))];

let countTouchingFiltered = 0;
let countTouchingT1 = 0;
let countTouchingT2 = 0;
const touchingBenign = [];
for (const b of allAcceptedBenign) {
  const fPath = b.fixture_db.startsWith('database/') ? b.fixture_db : 'database/' + b.fixture_db;
  const policies = generatePoliciesForFixture(path.resolve(__dirname, '../../', fPath));
  const t1 = policies.u1.policy.rowFilters[0].table.toLowerCase();
  const t2 = policies.u2.policy.rowFilters[1]?.table.toLowerCase() || t1;
  const sqlLower = b.sql.toLowerCase();
  const touchesT1 = new RegExp('\\b' + t1 + '\\b').test(sqlLower) || sqlLower.includes('"' + t1 + '"');
  const touchesT2 = new RegExp('\\b' + t2 + '\\b').test(sqlLower) || sqlLower.includes('"' + t2 + '"');
  if (touchesT1) countTouchingT1++;
  if (touchesT2) countTouchingT2++;
  if (touchesT1 || touchesT2) {
    countTouchingFiltered++;
    touchingBenign.push(b);
  }
}
console.log('Total accepted benign:', allAcceptedBenign.length);
console.log('Touching T1:', countTouchingT1);
console.log('Touching T2:', countTouchingT2);
console.log('Benign touching filtered table (T1 or T2):', countTouchingFiltered);
