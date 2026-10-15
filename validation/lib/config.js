/**
 * CogniCore Validation Configuration & Constants
 * -------------------------------------------------------------
 * Central configuration defining the deterministic master seed,
 * directory paths, model sweep rosters, and temperature schedules.
 * -------------------------------------------------------------
 */

const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const TARGET_REPO = process.env.TARGET_REPO ? path.resolve(process.env.TARGET_REPO) : WORKSPACE_ROOT;

module.exports = {
  MASTER_SEED: 20261015,
  TARGET_REPO,

  TEMPERATURE: {
    PRIMARY: 0.0,
    SECONDARY: 0.2,
  },

  MODELS: {
    SWEEP_LIST: [
      'qwen2.5:7b',
      'qwen2.5-coder:7b',
      'llama3.1:8b',
      'gemma3:4b',
    ],
    DEFAULT_SQL: 'qwen2.5:7b',
    DEFAULT_REASONING: 'qwen2.5:14b',
    DEFAULT_EMBEDDING: 'nomic-embed-text',
  },

  PATHS: {
    WORKSPACE_ROOT,
    TARGET_REPO,
    VALIDATION_ROOT: path.resolve(TARGET_REPO, 'validation'),
    RAW_DIR: path.resolve(TARGET_REPO, 'validation/raw'),
    RESULTS_DIR: path.resolve(TARGET_REPO, 'validation/results'),
    EXPERIMENTS_DIR: path.resolve(TARGET_REPO, 'validation/experiments'),
    DATABASE_DIR: path.resolve(TARGET_REPO, 'database'),
    SAMPLE_DATA_DIR: path.resolve(TARGET_REPO, 'sample-data'),
    SERVER_DIR: path.resolve(TARGET_REPO, 'server'),
  },

  CONFIDENCE: {
    ALPHA: 0.05,
    Z_95: 1.959964,
    BOOTSTRAP_REPLICATES: 10000,
  },
};
