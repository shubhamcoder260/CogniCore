const fs = require('fs');
const path = require('path');
const { generatePoliciesForFixture } = require('../lib/v3_oracles');

const v4Gate = fs.readFileSync('validation/raw/v4_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const v4bGate = fs.readFileSync('validation/raw/v4b_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const acceptedV4 = new Set(v4Gate.filter(r => r.accepted === true).map(r => r.id));
const acceptedV4b = new Set(v4bGate.filter(r => r.accepted === true).map(r => r.id));
const benign = fs.readFileSync('validation/data/v4/benign.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const c2 = fs.readFileSync('validation/data/v4b/c2_benign.jsonl', 'utf8').trim().split('\n').map(JSON.parse);

const acceptedC = benign.filter(r => acceptedV4.has(r.id));
const acceptedC2 = c2.filter(r => acceptedV4b.has(r.id));

const allAccepted = [...acceptedC, ...acceptedC2];

const fixtureMap = {};
for (const item of allAccepted) {
  const f = item.fixture_db.startsWith('database/') ? item.fixture_db : 'database/' + item.fixture_db;
  if (!fixtureMap[f]) fixtureMap[f] = [];
  fixtureMap[f].push(item);
}

let touchingCount = 0;
for (const [f, items] of Object.entries(fixtureMap)) {
  const policies = generatePoliciesForFixture(f);
  const filteredTables = new Set();
  for (const u of [policies.u1, policies.u2, policies.u3]) {
    for (const rf of (u?.policy?.rowFilters || [])) filteredTables.add(rf.table.toLowerCase());
    for (const cd of (u?.policy?.deniedColumns || [])) filteredTables.add(cd.table.toLowerCase());
  }

  const touching = items.filter(it => {
    const sql = it.sql.toLowerCase();
    for (const t of filteredTables) {
      if (new RegExp('\\b' + t + '\\b').test(sql) || sql.includes('"' + t + '"')) {
        return true;
      }
    }
    return false;
  });
  console.log(f.padEnd(40), 'accepted:', String(items.length).padStart(3), 'touching filtered table:', touching.length);
  touchingCount += touching.length;
}
console.log('Total accepted benign touching filtered tables:', touchingCount);
