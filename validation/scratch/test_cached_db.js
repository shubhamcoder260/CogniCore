const { enforcePolicy } = require('../../server/src/security/data.policy');
const Database = require('../../server/node_modules/better-sqlite3');

const sql = 'SELECT "br_id", "br_nm" FROM main."brs"';
const policy = { deniedColumns: [], rowFilters: [{ table: 'brs', column: 'city', op: '=', value: 'Bangalore' }] };
const schema = { tables: [{ name: 'brs', columns: [{ name: 'br_id' }, { name: 'br_nm' }, { name: 'city' }] }] };

const rewritten = enforcePolicy({ sql, schema, policy, datasetType: 'sqlite' });
console.log('Rewritten SQL:', rewritten);

const db = new Database('database/bank/B1_community.db', { readonly: true });
const rows = db.prepare(rewritten).all();
console.log('Rows count:', rows.length);
console.log('Rows sample:', rows[0]);
db.close();
