/**
 * CogniCore V4 Child Execution Worker
 * -------------------------------------------------------------
 * Executes SQL in an isolated child process to guard against
 * hangs, memory exhaustion, crashes, or unhandled exceptions.
 * -------------------------------------------------------------
 */

const path = require('path');

const [,, mode, dbPath, sqlBase64] = process.argv;

if (!mode || !dbPath || !sqlBase64) {
  process.stderr.write('Missing arguments: mode dbPath sqlBase64\n');
  process.exit(1);
}

const sql = Buffer.from(sqlBase64, 'base64').toString('utf8');

(async () => {
  try {
    if (mode === 'rw') {
      const Database = require(path.resolve(__dirname, '../node_modules/better-sqlite3'));
      const db = new Database(dbPath, { readonly: false });
      try {
        db.exec(sql);
      } finally {
        db.close();
      }
      process.stdout.write(JSON.stringify({ success: true, mode: 'rw' }));
    } else if (mode === 'real') {
      const { SQLiteAdapter } = require(path.resolve(__dirname, '../../server/src/ingestion/adapters/sqlite.adapter'));
      const { executeValidatedQuery } = require(path.resolve(__dirname, '../../server/src/structured/sql.executor'));
      const adapter = new SQLiteAdapter({ location: dbPath });
      const res = await executeValidatedQuery(adapter, sql);
      process.stdout.write(JSON.stringify({ success: true, mode: 'real', rowCount: res.rowCount }));
    } else {
      process.stderr.write(`Unknown mode: ${mode}\n`);
      process.exit(1);
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ success: false, error: err.message }));
  }
})();
