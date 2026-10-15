const Database = require('../node_modules/better-sqlite3');
const db = new Database('./database/bank/B1_community.db', { readonly: true });
const sql = "SELECT t.br_id, p.name FROM brs AS t JOIN pragma_table_info('brs') AS p ON 1=1 LIMIT 5";
const rows = db.prepare(sql).all();
console.log('Returned rows from pragma_table_info:');
console.log(JSON.stringify(rows, null, 2));
db.close();
