const Database = require('C:/cognicore/CogniCore/server/node_modules/better-sqlite3');
const dbPath = 'C:/cognicore/validation_workspace/spider_databases/flight_2/flight_2.sqlite';
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
  console.log('SQLite version:', db.prepare('SELECT sqlite_version() AS v').get().v);

  const settings = db.prepare('PRAGMA compile_options').all()
    .map(x => x.compile_options)
    .filter(x => /DQS|OMIT/i.test(x));
  console.log('Relevant compile options:', JSON.stringify(settings));

  for (const sql of [
    `SELECT "AHD" AS value`,
    `SELECT 'AHD' AS value`
  ]) {
    try {
      console.log(JSON.stringify({ sql, result: db.prepare(sql).all() }));
    } catch (e) {
      console.log(JSON.stringify({ sql, error: e.message }));
    }
  }
} finally {
  db.close();
}
