const { Parser } = require('../../../server/node_modules/node-sql-parser');
const parser = new Parser();
const sql = "SELECT * FROM json_each('[1,2]')";

try {
  console.log('tableList:', parser.tableList(sql, { database: 'sqlite' }));
} catch(e) {
  console.log('tableList error:', e.message);
}
try {
  console.log('ast:', JSON.stringify(parser.astify(sql, { database: 'sqlite' }), null, 2));
} catch(e) {
  console.log('ast error:', e.message);
}
