const mysql = require('mysql2/promise');
const { DataSourceAdapter } = require('./base.adapter');
const { DatasetRegistry } = require('../dataset.registry');

class MySQLAdapter extends DataSourceAdapter {
  async connect() {
    const creds = DatasetRegistry.getCredentials(this.datasetId);
    if (!creds) throw new Error('No connection credentials found for this dataset.');

    this.pool = mysql.createPool({
      host: creds.host,
      port: creds.port || 3306,
      database: creds.database,
      user: creds.user,
      password: creds.password,
      ssl: creds.ssl ? {} : undefined,
      connectionLimit: 3,
      connectTimeout: 8000,
    });
    try {
      const conn = await this.pool.getConnection();
      conn.release();
      this.database = creds.database;
      return this;
    } catch (err) {
      try { await this.pool.end(); } catch (_) {}
      this.pool = null;
      throw err;
    }
  }

  async disconnect() {
    if (this.pool) {
      try { await this.pool.end(); } catch (_) {}
      this.pool = null;
    }
  }

  async getSchema() {
    const [tableRows] = await this.pool.query(
      `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY TABLE_NAME`,
      [this.database]
    );

    const tables = [];
    for (const row of tableRows) {
      const tableName = row.TABLE_NAME;
      const [colRows] = await this.pool.query(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
         FROM information_schema.columns
         WHERE table_schema = ? AND table_name = ? ORDER BY ORDINAL_POSITION`,
        [this.database, tableName]
      );
      const [fkRows] = await this.pool.query(
        `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
         FROM information_schema.key_column_usage
         WHERE table_schema = ? AND table_name = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
        [this.database, tableName]
      );

      let rowCount = 0;
      try {
        const [countRows] = await this.pool.query(`SELECT COUNT(*) AS c FROM ${quoteIdent(tableName)}`);
        rowCount = countRows[0].c;
      } catch (_) { /* ignore */ }

      tables.push({
        name: tableName,
        rowCount,
        columns: colRows.map(c => ({
          name: c.COLUMN_NAME,
          type: c.DATA_TYPE.toUpperCase(),
          nullable: c.IS_NULLABLE === 'YES',
          primaryKey: c.COLUMN_KEY === 'PRI',
        })),
        foreignKeys: fkRows.map(fk => ({
          column: fk.COLUMN_NAME,
          referencesTable: fk.REFERENCED_TABLE_NAME,
          referencesColumn: fk.REFERENCED_COLUMN_NAME,
        })),
      });
    }
    return { tables };
  }

  async getMetadata() {
    const schema = await this.getSchema();
    return { tableCount: schema.tables.length, totalRows: schema.tables.reduce((s, t) => s + t.rowCount, 0) };
  }

  async preview(tableName, limit = 10) {
    if (!tableName || typeof tableName !== 'string') {
      throw new Error('Table name is required for preview');
    }

    const systemPrefixes = ['information_schema', 'mysql', 'performance_schema', 'sys'];
    if (systemPrefixes.some((p) => tableName.toLowerCase().startsWith(p))) {
      throw new Error(`Cannot preview system table "${tableName}"`);
    }

    const schema = await this.getSchema();
    const schemaTable = schema.tables.find(
      (t) => t.name.toLowerCase() === tableName.toLowerCase()
    );
    if (!schemaTable) {
      throw new Error(`Table "${tableName}" not found in dataset schema`);
    }

    const quoted = quoteIdent(schemaTable.name);
    const [rows, fields] = await this.pool.query(`SELECT * FROM ${quoted} LIMIT ?`, [limit]);
    return { columns: fields.map(f => f.name), rows };
  }

  async executeQuery(sql) {
    const [rows, fields] = await this.pool.query(sql);
    return { columns: fields ? fields.map(f => f.name) : (rows[0] ? Object.keys(rows[0]) : []), rows };
  }

  async validateQuery() {
    return { valid: true };
  }
}

function quoteIdent(name) {
  return '`' + String(name).replace(/`/g, '``') + '`';
}

async function testMySQLConnection(creds) {
  let pool;
  try {
    pool = mysql.createPool({
      host: creds.host,
      port: creds.port || 3306,
      database: creds.database,
      user: creds.user,
      password: creds.password,
      ssl: creds.ssl ? {} : undefined,
      connectionLimit: 1,
      connectTimeout: 8000,
    });
    const conn = await pool.getConnection();
    conn.release();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (pool) await pool.end();
  }
}

module.exports = { MySQLAdapter, testMySQLConnection };
