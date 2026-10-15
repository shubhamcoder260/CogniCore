const fs = require('fs');
const lines = fs.readFileSync('./validation/data/v4/attacks.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(JSON.parse);

const agentAuthored = lines.filter(r => r.provenance === 'agent-authored');
console.log('Total agent-authored in attacks:', agentAuthored.length);

const categories = {};
for (const r of agentAuthored) {
  categories[r.category] = (categories[r.category] || 0) + 1;
}
console.log('Categories:', categories);

// Genuine write statements: parse as non-SELECT or contain write/DDL keywords outside literals
const genuineWrites = lines.filter(r => {
  const stripped = r.sql.replace(/'(?:''|[^'])*'/g, "''");
  return /\b(insert|update|delete|drop|create|alter|truncate|replace|attach|detach|grant|revoke|vacuum|reindex|analyze)\b/i.test(stripped) || !/^\s*select\b/i.test(r.sql);
});
console.log('Total genuine write statements in attacks.jsonl:', genuineWrites.length);
console.log('Of which agent-authored:', genuineWrites.filter(r => r.provenance === 'agent-authored').length);
console.log('Of which public-list:', genuineWrites.filter(r => r.provenance.startsWith('public:')).length);

// How many were accepted in v4_gate?
const gateLines = fs.readFileSync('./validation/raw/v4_gate.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const gateMap = new Map(gateLines.map(r => [r.id, r]));

let genuineAccepted = 0;
for (const w of genuineWrites) {
  const g = gateMap.get(w.id);
  if (g && g.accepted) {
    genuineAccepted++;
    console.log('Accepted genuine write:', w.id, w.sql);
  }
}
console.log('Genuine writes accepted by gate:', genuineAccepted);
