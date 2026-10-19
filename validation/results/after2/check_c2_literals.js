const fs = require('fs');
const path = require('path');

const c2 = fs.readFileSync('validation/data/v4b/c2_benign.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const literals = new Set();
for (const item of c2) {
  const matches = item.sql.match(/'([^']+)'/g);
  if (matches) {
    for (const m of matches) {
      const val = m.slice(1, -1);
      if (val.length >= 4 && !/^\d+$/.test(val)) {
        literals.add(val);
      }
    }
  }
}
console.log('Unique string literals in c2_benign (len >= 4):', literals.size);

// Check if any literal is hardcoded in server/src/structured/sql.validator.js
const validatorSrc = fs.readFileSync('server/src/structured/sql.validator.js', 'utf8');
const foundInValidator = [];
for (const lit of literals) {
  if (validatorSrc.includes("'" + lit + "'") || validatorSrc.includes('"' + lit + '"')) {
    foundInValidator.push(lit);
  }
}
console.log('Literals found in sql.validator.js:', foundInValidator);

// Walk all files in server/src
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
walk('server/src');

const foundAcrossSrc = [];
const ignoreList = new Set(['admin', 'user', 'viewer', 'employee', 'analyst', 'manager', 'active', 'inactive', 'ready', 'error', 'failed', 'sqlite', 'postgres', 'mysql', 'true', 'false', 'null']);

for (const f of files) {
  const code = fs.readFileSync(f, 'utf8');
  for (const lit of literals) {
    if (ignoreList.has(lit.toLowerCase())) continue;
    if (code.includes("'" + lit + "'") || code.includes('"' + lit + '"')) {
      foundAcrossSrc.push({ file: f, literal: lit });
    }
  }
}
console.log('Suspicious c2 literals found across server/src:', foundAcrossSrc);
