'use strict';
const fs = require('fs');
const crypto = require('crypto');
const manifest = JSON.parse(fs.readFileSync('validation/MANIFEST.json', 'utf8'));
let allMatch = true;
for (const [relPath, expectedHash] of Object.entries(manifest.checksums.databases)) {
  const fileBuf = fs.readFileSync(relPath);
  const hash = crypto.createHash('sha256').update(fileBuf).digest('hex');
  if (hash !== expectedHash) {
    console.error(`MISMATCH: ${relPath}: expected ${expectedHash}, got ${hash}`);
    allMatch = false;
  }
}
if (allMatch) {
  console.log('ALL 15 FIXTURE DATABASE HASHES MATCH MANIFEST EXACTLY (100% UNMUTATED)!');
}
