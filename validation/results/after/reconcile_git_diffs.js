'use strict';

const cp = require('child_process');

const findings = [
  { id: 'V3-01', file: 'server/src/security/data.policy.js' },
  { id: 'V3-02', file: 'server/src/structured/sql.generator.js' },
  { id: 'V3-03', file: 'server/src/api/routes/datasets.js' },
  { id: 'V3-04', file: 'server/src/api/routes/tools.js' },
  { id: 'V3-05', file: 'server/src/structured/result.checks.js' },
  { id: 'V3-06', file: 'server/src/security/data.policy.js' },
  { id: 'V3-07', file: 'server/src/security/data.policy.js' },
  { id: 'V3-08', file: 'server/src/conversation/session.manager.js' },
  { id: 'V4-01', file: 'server/src/ingestion/adapters/sqlite.adapter.js' },
  { id: 'V4-02', file: 'server/src/structured/sql.validator.js' },
  { id: 'V4-03', file: 'server/src/structured/sql.validator.js' },
  { id: 'V4-04', file: 'server/src/structured/sql.executor.js' },
  { id: 'V4-05', file: 'server/src/ingestion/adapters/sqlite.adapter.js' },
  { id: 'V4-06', file: 'server/src/structured/sql.complexity.js' },
  { id: 'V4-07', file: 'server/src/structured/sql.validator.js' },
  { id: 'V4-08', file: 'server/src/structured/sql.repair.js' },
  { id: 'V4-09', file: 'server/src/structured/sql.validator.js' },
  { id: 'V4-10', file: 'server/src/ingestion/adapters/sqlite.adapter.js' },
  { id: 'V4-11', file: 'server/src/ingestion/adapters/sqlite.adapter.js' },
  { id: 'V12-01', file: 'server/src/security/file.validator.js' },
  { id: 'V12-02', file: 'server/src/security/file.validator.js' },
  { id: 'V12-03', file: 'server/src/documents/zip.reader.js' },
  { id: 'V13-01', file: 'server/src/guardrails/rate.limit.js' },
  { id: 'V13-02', file: 'server/src/guardrails/input.guard.js' },
  { id: 'V13-03', file: 'server/src/guardrails/input.guard.js' },
  { id: 'V14-01', file: 'server/src/core/session.manager.js' },
  { id: 'V14-02', file: 'server/src/api/routes/auth.js' },
  { id: 'V15-01', file: 'server/src/guardrails/pii.js' },
  { id: 'V15-02', file: 'server/src/core/core.engine.js' },
  { id: 'V15-03', file: 'server/src/guardrails/pii.js' }
];

console.log('Finding | File | Lines Changed between spider-audit-complete and e975b89');
console.log('---|---|---');
for (const f of findings) {
  try {
    const diff = cp.execSync(`git diff spider-audit-complete..e975b89 -- ${f.file}`).toString();
    const stat = cp.execSync(`git diff --shortstat spider-audit-complete..e975b89 -- ${f.file}`).toString().trim();
    console.log(`${f.id} | \`${f.file}\` | ${stat || 'NO DIFF (0 lines changed)'}`);
  } catch (e) {
    console.log(`${f.id} | \`${f.file}\` | ERROR: ${e.message}`);
  }
}
