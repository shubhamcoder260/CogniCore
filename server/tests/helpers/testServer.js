require('./testEnv');
const { createApp } = require('../../src/app');

/** Starts the real app on a random free port. Caller must close() it after. */
function startTestServer() {
  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Small fetch wrapper that always parses JSON and never throws on non-2xx. */
async function req(baseUrl, method, path, { body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) { /* non-JSON response, fine */ }
  return { status: res.status, body: json, headers: res.headers };
}

const Database = require('better-sqlite3');
const config = require('../../src/config/env');
const fs = require('fs');

function cleanTestDb(db) {
  if (!db) {
    if (config.paths.registryDb && fs.existsSync(config.paths.registryDb)) {
      const conn = new Database(config.paths.registryDb);
      try { cleanTestDb(conn); } finally { conn.close(); }
    }
    return;
  }
  db.pragma('foreign_keys = OFF');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const del = db.transaction((tbls) => {
    for (const t of tbls) {
      db.prepare(`DELETE FROM "${t.name}"`).run();
    }
    try {
      const seq = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
      if (seq) db.prepare("DELETE FROM sqlite_sequence").run();
    } catch (_) {}
  });
  del(tables);
  db.pragma('foreign_keys = ON');
}

function freshDb() {
  cleanTestDb();
  fs.mkdirSync(config.paths.data, { recursive: true });
  fs.mkdirSync(config.paths.uploads, { recursive: true });
}

module.exports = { startTestServer, req, cleanTestDb, freshDb };
