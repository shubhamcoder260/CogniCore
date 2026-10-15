const Database = require('../node_modules/better-sqlite3');
const db = new Database(':memory:');
const row = db.prepare("SELECT fts3_tokenizer('simple') AS tok").get();
console.log('row:', row);
console.log('constructor:', row.tok?.constructor?.name);
console.log('Buffer.isBuffer:', Buffer.isBuffer(row.tok));
console.log('Uint8Array:', row.tok instanceof Uint8Array);
console.log('ByteLength:', row.tok?.byteLength || row.tok?.length);
if (row.tok) {
  const buf = Buffer.from(row.tok);
  console.log('Buffer hex:', buf.toString('hex'));
  console.log('Length bytes:', buf.length);
}

// Now test 2-argument registration
try {
  db.prepare("SELECT fts3_tokenizer('custom', fts3_tokenizer('simple'))").get();
  console.log('2-arg call succeeded');
} catch (e) {
  console.log('2-arg call failed:', e.message);
}
db.close();
