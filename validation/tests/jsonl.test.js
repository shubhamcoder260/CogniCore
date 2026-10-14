const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { appendRecord, readAll, completedKeys, RAW_DIR } = require('../lib/jsonl');

test('jsonl: enforces append-only invariant, byte immutability, and resume helper', () => {
  const testFile = path.join(RAW_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  if (fs.existsSync(testFile)) fs.unlinkSync(testFile);

  try {
    // 1. Refuse write outside validation/raw/
    const forbiddenPath = path.resolve(__dirname, '../../forbidden.jsonl');
    assert.throws(
      () => appendRecord(forbiddenPath, { test: 1 }),
      /Refusing write outside validation\/raw\//
    );

    // 2. Append first 3 records
    appendRecord(testFile, { item: 'A', value: 10 });
    appendRecord(testFile, { item: 'B', value: 20 });
    appendRecord(testFile, { item: 'C', value: 30 });

    const initialBuffer = fs.readFileSync(testFile);
    const initialBytesLen = initialBuffer.length;
    const initialHash = crypto.createHash('sha256').update(initialBuffer).digest('hex');

    // 3. Re-open and append 2 more records
    appendRecord(testFile, { item: 'D', value: 40 });
    appendRecord(testFile, { item: 'E', value: 50 });

    const updatedBuffer = fs.readFileSync(testFile);
    assert.ok(updatedBuffer.length > initialBytesLen);

    // 4. Assert first N bytes are bit-for-bit identical
    const prefixBuffer = updatedBuffer.subarray(0, initialBytesLen);
    const prefixHash = crypto.createHash('sha256').update(prefixBuffer).digest('hex');
    assert.equal(prefixHash, initialHash, 'First N bytes must never be altered or mutated');

    // 5. Read all 5 records
    const records = readAll(testFile);
    assert.equal(records.length, 5);
    assert.equal(records[0].item, 'A');
    assert.equal(records[0].seq, 1);
    assert.equal(records[4].item, 'E');
    assert.equal(records[4].seq, 5);
    assert.ok(records.every((r) => r.ts_iso && r.run_id));

    // 6. Test resume helper: completedKeys
    const keys = completedKeys(testFile, (r) => r.item);
    assert.equal(keys.size, 5);
    assert.ok(keys.has('A'));
    assert.ok(keys.has('E'));
    assert.ok(!keys.has('Z'));
  } finally {
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  }
});
