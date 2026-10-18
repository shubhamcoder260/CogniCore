/**
 * Validation Suite Entrypoint
 * Allows `node --test validation/tests` to execute all validation tests.
 */
require('./stats.test.js');
require('./jsonl.test.js');
require('./v4_oracles.test.js');
require('./dos_controls.test.js');
require('./v3_oracles.test.js');
require('./v12_v15_controls.test.js');
require('./domain1_governance.test.js');
require('./domain2_parser_safety.test.js');
require('./domain3_rbac_policy.test.js');
require('./domain4_connectors.test.js');
