/**
 * Validation Suite Entrypoint
 * Allows `node --test validation/tests` to execute all validation tests.
 */
require('./stats.test.js');
require('./jsonl.test.js');
require('./v4_oracles.test.js');
require('./dos_controls.test.js');
