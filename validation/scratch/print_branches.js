const Database = require('../../server/node_modules/better-sqlite3');
const db = new Database('database/bank/B2_district.db', { readonly: true });
console.log(db.prepare('SELECT branch_name, city FROM branches').all());
db.close();
