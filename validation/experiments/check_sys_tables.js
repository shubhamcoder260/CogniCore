const fs = require('fs');
const path = require('path');
const lines = fs.readFileSync('./validation/raw/v4b_gate.jsonl', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(JSON.parse);

const sysTableItems = lines.filter(r => /sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_stat1|dbstat/i.test(r.original_sql));
console.log('Total sysTableItems in v4b_gate:', sysTableItems.length);

const byLayer = {};
let acceptedCount = 0;
for (const it of sysTableItems) {
  if (it.accepted) {
    acceptedCount++;
  } else {
    const l = it.rejecting_layer || 'unknown';
    byLayer[l] = (byLayer[l] || 0) + 1;
  }
}
console.log('Accepted count:', acceptedCount);
console.log('Rejecting layers:', byLayer);
if (sysTableItems.length > 0) {
  console.log('Sample rejected reason:', sysTableItems[0].reason);
}
