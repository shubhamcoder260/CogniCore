const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const outDir = path.resolve(__dirname, '../data/external');
fs.mkdirSync(outDir, { recursive: true });

function fetchRows(offset, limit) {
  return new Promise((resolve, reject) => {
    const url = 'https://datasets-server.huggingface.co/rows?dataset=deepset%2Fprompt-injections&config=default&split=test&offset=' + offset + '&limit=' + limit;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.rows.map(r => r.row));
        } catch (e) {
          reject(new Error('JSON parse error: ' + e.message + ', raw: ' + data.slice(0, 100)));
        }
      });
    }).on('error', reject);
  });
}

async function main() {
  console.log('Fetching deepset/prompt-injections test split...');
  const rows0 = await fetchRows(0, 100);
  const rows1 = await fetchRows(100, 100);
  const allRows = [...rows0, ...rows1];
  console.log('Fetched total rows:', allRows.length);
  const outPath = path.join(outDir, 'deepset_prompt_injections_test.json');
  fs.writeFileSync(outPath, JSON.stringify(allRows, null, 2), 'utf8');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
  console.log('Saved to:', outPath);
  console.log('SHA-256:', hash);
}

main().catch(err => {
  console.error('Fetch error:', err.message);
  process.exit(1);
});
