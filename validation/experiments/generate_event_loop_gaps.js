'use strict';

const fs = require('fs');
const path = require('path');

const b2File = path.resolve(__dirname, '../raw/v4b_resource.jsonl');
const v4cFile = path.resolve(__dirname, '../raw/v4c_resource.jsonl');
const outputFile = path.resolve(__dirname, '../raw/event_loop_gaps.csv');

const b2 = fs.readFileSync(b2File, 'utf8').trim().split('\n').map(JSON.parse);
const v4c = fs.readFileSync(v4cFile, 'utf8').trim().split('\n').map(JSON.parse);

console.log('Total B2 items:', b2.length);
console.log('Total v4c items:', v4c.length);

const allItems = [];
b2.forEach(it => {
  allItems.push({
    source: 'v4b_resource',
    id: it.id,
    class: it.class || 'B2',
    construct: it.construct,
    fixture_db: it.fixture_db,
    elapsed_ms: it.elapsed_ms,
    max_gap_ms: it.max_heartbeat_gap_ms,
    status: it.status || (it.killed ? 'KILLED' : 'COMPLETED')
  });
});
v4c.forEach(it => {
  allItems.push({
    source: 'v4c_resource',
    id: it.id,
    class: it.class || 'v4c_DoS',
    construct: it.construct,
    fixture_db: it.fixture_db,
    elapsed_ms: it.elapsed_ms,
    max_gap_ms: it.max_heartbeat_gap_ms,
    status: it.execution_status
  });
});

const csvRows = ['source,id,class,construct,fixture_db,elapsed_ms,max_gap_ms,status'];
allItems.forEach(it => {
  csvRows.push(`${it.source},${it.id},${it.class},${it.construct},${it.fixture_db},${it.elapsed_ms},${it.max_gap_ms},${it.status}`);
});

fs.writeFileSync(outputFile, csvRows.join('\n') + '\n', 'utf8');
console.log(`Saved ${outputFile} with ${allItems.length} rows.`);

const over250 = allItems.filter(it => it.max_gap_ms > 250);
console.log(`Items with max_gap_ms > 250 ms: ${over250.length}`);
over250.forEach(it => {
  console.log(`  ${it.id} (${it.class} / ${it.construct}): ${it.max_gap_ms} ms (elapsed: ${it.elapsed_ms} ms, status: ${it.status})`);
});
