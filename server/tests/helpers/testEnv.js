const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Must run before any other require in a test file, so config/env.js picks
// up NODE_ENV=test and isolates storage under data-test/ (see env.js).
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_do_not_use_in_prod';

if (!process.env.COGNICORE_TEST_DB_PATH && process.env.USE_MEMORY_DB !== 'true') {
  process.env.COGNICORE_TEST_DB_PATH = path.join(os.tmpdir(), `cognicore-test-${crypto.randomUUID()}.db`);
}
