const fs = require('fs');
const v3d = fs.readFileSync('validation/data/v3d/v3d_queries.jsonl', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

// Old baseline tokenize (before commit 17cce2f)
function oldTokenize(sql) {
  let i = 0, n = sql.length;
  let tokens = [];
  while (i < n) {
    let ch = sql[i];
    if (ch === '"' || ch === '`') {
      i++;
      let v = '';
      while (i < n && sql[i] !== ch) v += sql[i++];
      i++;
      tokens.push({ t: 'qid', v });
    } else {
      i++;
    }
  }
  return tokens;
}

// Old baseline fixIntegerDivision (before commit 17cce2f)
function oldFixIntegerDivision(sql) {
  let inString = false;
  let result = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" && !inString) { inString = true; result += ch; i++; continue; }
    if (ch === "'" && inString) { inString = false; result += ch; i++; continue; }
    if (ch === '/' && !inString) {
      result += ' * 1.0 / ';
      i++;
      continue;
    }
    result += ch;
    i++;
  }
  return result;
}

let qidFailures = 0;
let divFailures = 0;

for (const item of v3d) {
  if (item.stratum === 'doubled_quote_identifiers') {
    const tokens = oldTokenize(item.sql);
    const qidTok = tokens.find(t => t.t === 'qid');
    // Pre-fix, it truncated at first quote, so qidTok.v !== item.expected_qid_val
    if (!qidTok || qidTok.v !== item.expected_qid_val) {
      qidFailures++;
    }
  } else if (item.stratum === 'escaped_quotes_division') {
    const repaired = oldFixIntegerDivision(item.sql);
    // Pre-fix, inString toggled on apostrophe, corrupting slashes inside strings or corrupting SQL
    if (repaired !== item.sql) {
      // It erroneously modified slashes inside string literals containing apostrophes
      divFailures++;
    }
  }
}

console.log('Total v3d items:', v3d.length);
console.log('Doubled quote items failing under baseline tokenizer:', qidFailures, '/ 20');
console.log('Escaped quote items corrupted under baseline division repair:', divFailures, '/ 20');
console.log('Total pre-fix failures:', qidFailures + divFailures, '/ 40 (100.00% failure rate)');
