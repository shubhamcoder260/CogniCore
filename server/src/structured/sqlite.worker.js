'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const Database = require('better-sqlite3');

try {
  const { dbPath, sql, params = [] } = workerData;
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    const stmt = db.prepare(sql);
    const rows = params && params.length ? stmt.all(...params) : stmt.all();
    const columns = rows.length ? Object.keys(rows[0]) : [];
    try { db.close(); } catch (_) {}
    parentPort.postMessage({ success: true, columns, rows });
  } catch (err) {
    try { db.close(); } catch (_) {}
    parentPort.postMessage({ success: false, error: err.message, code: err.code });
  }
} catch (err) {
  parentPort.postMessage({ success: false, error: err.message, code: err.code });
}
