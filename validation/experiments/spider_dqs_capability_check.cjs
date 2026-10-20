const Database = require('C:/cognicore/CogniCore/server/node_modules/better-sqlite3');
const db = new Database(
  'C:/cognicore/validation_workspace/spider_databases/flight_2/flight_2.sqlite',
  { readonly: true, fileMustExist: true }
);

try {
  console.log('SQLite version:', db.prepare('SELECT sqlite_version() AS v').get().v);

  for (const pragma of [
    'PRAGMA dqs_ddl',
    'PRAGMA dqs_dml'
  ]) {
    try {
      console.log(JSON.stringify({ pragma, result: db.prepare(pragma).all() }));
    } catch (e) {
      console.log(JSON.stringify({ pragma, error: e.message }));
    }
  }

  console.log('Database remains read-only; no PRAGMA assignments attempted.');
} finally {
  db.close();
}
