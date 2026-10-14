/**
 * Append-Only JSONL Structured Logger & Resume Helper
 * -------------------------------------------------------------
 * Ensures persistent, append-only experiment logging with mandatory
 * fsync. Strictly refuses writing to paths outside validation/raw/.
 * -------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');

const RAW_DIR = path.resolve(__dirname, '../raw');
const seqMap = new Map();

function assertRawPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(RAW_DIR)) {
    throw new Error(`Refusing write outside validation/raw/. Target path: ${resolved}`);
  }
  return resolved;
}

/**
 * Appends a record to an append-only JSONL file with fsync.
 * Merges { ts_iso, run_id, seq } into the record.
 * @param {string} file - Target file path (must be inside validation/raw/)
 * @param {object} obj - Data object to record
 * @returns {object} The persisted record
 */
function appendRecord(file, obj) {
  const target = assertRawPath(file);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const currentSeq = (seqMap.get(target) || 0) + 1;
  seqMap.set(target, currentSeq);

  const record = {
    ts_iso: new Date().toISOString(),
    run_id: obj.run_id || 'run_default',
    seq: currentSeq,
    ...obj,
  };

  const line = JSON.stringify(record) + '\n';
  const fd = fs.openSync(target, 'a');
  try {
    fs.writeSync(fd, line, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  return record;
}

/**
 * Reads all records from a JSONL file.
 * @param {string} file - Path to JSONL file
 * @returns {Array<object>} Array of parsed records
 */
function readAll(file) {
  const target = path.resolve(file);
  if (!fs.existsSync(target)) return [];
  const content = fs.readFileSync(target, 'utf8');
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Resume helper: returns a Set of completed keys extracted by keyFn.
 * @param {string} file - Path to JSONL file
 * @param {(record: object) => string} keyFn - Function returning unique key
 * @returns {Set<string>}
 */
function completedKeys(file, keyFn) {
  const records = readAll(file);
  const set = new Set();
  for (const r of records) {
    const k = keyFn(r);
    if (k !== undefined && k !== null) {
      set.add(k);
    }
  }
  return set;
}

module.exports = {
  appendRecord,
  readAll,
  completedKeys,
  RAW_DIR,
};
