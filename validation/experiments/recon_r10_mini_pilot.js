/**
 * RECON R10: Mini-Pilot on 12 Questions across 3 Databases
 * Tests (a) Raw C0 path (DDL prompt -> model -> raw SQLite execution)
 *   and (b) CogniCore real path (full prompt -> model -> clean -> repair -> validate -> policy -> exec)
 * Compares results against Gold SQL.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');

const Database = require('../../server/node_modules/better-sqlite3');
const { createAdapter } = require('../../server/src/ingestion/adapters');
const { buildSemanticModel } = require('../../server/src/semantic/semantic.builder');
const { inspectFixture } = require('../lib/v3_oracles');
const { analyzeSchema } = require('../../server/src/schema/schema.analyzer');
const { prepareSql } = require('../../server/src/core/engines/structured.engine');
const { validateSql } = require('../../server/src/structured/sql.validator');
const { enforcePolicy } = require('../../server/src/security/data.policy');
const { executeValidatedQuery } = require('../../server/src/structured/sql.executor');

function getSqlGenerator() {
  const code = fs.readFileSync(path.resolve(__dirname, '../../server/src/structured/sql.generator.js'), 'utf8');
  const vm = require('vm');
  const mod = { exports: {} };
  const reqWrapper = (p) => {
    if (p.startsWith('.')) return require(path.resolve(__dirname, '../../server/src/structured', p));
    return require(p);
  };
  const ctx = vm.createContext({ module: mod, exports: mod.exports, require: reqWrapper, console });
  vm.runInContext(code + '\nmodule.exports.buildPrompt = buildPrompt; module.exports.cleanSqlOutput = cleanSqlOutput;', ctx);
  return mod.exports;
}

const { buildPrompt, cleanSqlOutput } = getSqlGenerator();

function queryOllama(prompt, temperature = 0.1, maxTokens = 500) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const body = JSON.stringify({
      model: 'qwen2.5-coder:7b',
      prompt,
      stream: false,
      options: {
        temperature,
        num_predict: maxTokens,
        num_ctx: 4096
      }
    });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/generate',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          resolve({
            response: data.response || '',
            wallClockMs: Date.now() - t0,
            promptTokens: data.prompt_eval_count || 0,
            genTokens: data.eval_count || 0
          });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getDDL(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare("SELECT sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL").all();
    return rows.map(r => r.sql + ';').join('\n\n');
  } finally {
    db.close();
  }
}

function canonicalizeRows(rows) {
  if (!rows || !Array.isArray(rows)) return [];
  // Sort rows deterministically by stringified key-value pairs
  return rows.map(row => {
    const sorted = {};
    Object.keys(row).sort().forEach(k => {
      let v = row[k];
      if (typeof v === 'number') v = +v.toFixed(4);
      sorted[k.toLowerCase()] = v;
    });
    return JSON.stringify(sorted);
  }).sort();
}

function compareRowSets(actualRows, goldRows) {
  if (!actualRows || !goldRows) return false;
  if (actualRows.length !== goldRows.length) return false;
  const aCanon = canonicalizeRows(actualRows);
  const gCanon = canonicalizeRows(goldRows);
  if (aCanon.length !== gCanon.length) return false;
  for (let i = 0; i < aCanon.length; i++) {
    if (aCanon[i] !== gCanon[i]) return false;
  }
  return true;
}

const PILOT_QUESTIONS = [
  // Database 1: B1_community (Bank)
  {
    id: 'RECON-B1-01',
    category: 'count',
    db: 'database/bank/B1_community.db',
    question: 'How many accounts are there?',
    goldSql: 'SELECT COUNT(*) FROM accts'
  },
  {
    id: 'RECON-B1-02',
    category: 'filter',
    db: 'database/bank/B1_community.db',
    question: 'List all accounts with a balance greater than 50000.',
    goldSql: 'SELECT * FROM accts WHERE bal > 50000'
  },
  {
    id: 'RECON-B1-03',
    category: 'join',
    db: 'database/bank/B1_community.db',
    question: 'Show each account ID along with its branch name.',
    goldSql: 'SELECT accts.acct_id, brs.br_nm FROM accts JOIN brs ON accts.br_id = brs.br_id'
  },
  {
    id: 'RECON-B1-04',
    category: 'aggregation',
    db: 'database/bank/B1_community.db',
    question: 'What is the average account balance for each account type?',
    goldSql: 'SELECT acct_typ, AVG(bal) FROM accts GROUP BY acct_typ'
  },

  // Database 2: F1_quickbite (Food Delivery)
  {
    id: 'RECON-F1-01',
    category: 'count',
    db: 'database/fooddelivery/F1_quickbite.db',
    question: 'How many restaurants are there?',
    goldSql: 'SELECT COUNT(*) FROM rst'
  },
  {
    id: 'RECON-F1-02',
    category: 'filter',
    db: 'database/fooddelivery/F1_quickbite.db',
    question: 'List all restaurants with a rating greater than 4.5.',
    goldSql: 'SELECT * FROM rst WHERE rat > 4.5'
  },
  {
    id: 'RECON-F1-03',
    category: 'join',
    db: 'database/fooddelivery/F1_quickbite.db',
    question: 'Show each order ID along with the restaurant name.',
    goldSql: 'SELECT ords.ord_id, rst.rst_nm FROM ords JOIN rst ON ords.rst_id = rst.rst_id'
  },
  {
    id: 'RECON-F1-04',
    category: 'aggregation',
    db: 'database/fooddelivery/F1_quickbite.db',
    question: 'What is the average menu item price for each restaurant?',
    goldSql: 'SELECT rst_id, AVG(prc) FROM mnu GROUP BY rst_id'
  },

  // Database 3: H1_clinic (Hospital)
  {
    id: 'RECON-H1-01',
    category: 'count',
    db: 'database/hospital/H1_clinic.db',
    question: 'How many doctors are there?',
    goldSql: 'SELECT COUNT(*) FROM doctors'
  },
  {
    id: 'RECON-H1-02',
    category: 'filter',
    db: 'database/hospital/H1_clinic.db',
    question: 'List all patients who are older than 60.',
    goldSql: 'SELECT * FROM patients WHERE age > 60'
  },
  {
    id: 'RECON-H1-03',
    category: 'join',
    db: 'database/hospital/H1_clinic.db',
    question: "Show each doctor's name along with their department name.",
    goldSql: 'SELECT doctors.name, departments.name FROM doctors JOIN departments ON doctors.dept_id = departments.dept_id'
  },
  {
    id: 'RECON-H1-04',
    category: 'aggregation',
    db: 'database/hospital/H1_clinic.db',
    question: 'What is the total visit fee collected by each department?',
    goldSql: 'SELECT dept_id, SUM(fee) FROM visits GROUP BY dept_id'
  }
];

async function run() {
  console.log(`Starting R10 Mini-Pilot on ${PILOT_QUESTIONS.length} questions across 3 databases...`);
  const tPilotStart = Date.now();
  const results = [];

  // Group by db to reuse semantic models and adapters
  const dbs = ['database/bank/B1_community.db', 'database/fooddelivery/F1_quickbite.db', 'database/hospital/H1_clinic.db'];
  const dbContexts = {};

  for (const dbRel of dbs) {
    const fullPath = path.resolve(__dirname, '../../', dbRel);
    const tables = inspectFixture(fullPath);
    const schema = { tables };
    const adapter = createAdapter('sqlite', { datasetId: path.basename(dbRel), location: fullPath });
    await adapter.connect();
    const semantic = await buildSemanticModel({ adapter, schema, datasetType: 'sqlite' });
    const { relationships } = analyzeSchema(schema);
    const ddl = getDDL(fullPath);
    dbContexts[dbRel] = { fullPath, schema, adapter, semantic, relationships, ddl };
  }

  for (let i = 0; i < PILOT_QUESTIONS.length; i++) {
    const item = PILOT_QUESTIONS[i];
    const ctx = dbContexts[item.db];
    const sha256 = crypto.createHash('sha256').update(item.question).digest('hex');

    console.log(`\n[${item.id}] "${item.question}" (${item.category})`);

    // 1. Execute Gold SQL via dedicated read-only SQLite handle
    let goldRows = null;
    let goldError = null;
    try {
      const gDb = new Database(ctx.fullPath, { readonly: true });
      try {
        goldRows = gDb.prepare(item.goldSql).all();
      } finally {
        gDb.close();
      }
    } catch (err) {
      goldError = err.message;
    }

    // ----------------------------------------------------
    // PATH (A): RAW C0 PROMPT
    // ----------------------------------------------------
    const c0Prompt = `You are a SQL engine. Given the following SQLite DDL schema, answer the question with a SELECT statement.\n\nSCHEMA:\n${ctx.ddl}\n\nQUESTION: ${item.question}\n\nSQL:`;
    const c0QueryRes = await queryOllama(c0Prompt, 0.1, 500);
    const c0RawText = c0QueryRes.response;

    // Attempt direct execution of raw text on SQLite
    let c0DirectExecSuccess = false;
    let c0DirectExecError = null;
    let c0DirectRows = null;
    try {
      const directDb = new Database(ctx.fullPath, { readonly: true });
      try {
        c0DirectRows = directDb.prepare(c0RawText.trim()).all();
        c0DirectExecSuccess = true;
      } finally {
        directDb.close();
      }
    } catch (err) {
      c0DirectExecError = err.message;
    }

    // Also test execution with basic markdown strip
    let c0ExtractedSql = c0RawText.trim();
    if (c0ExtractedSql.includes('```')) {
      const match = c0ExtractedSql.match(/```(?:sql)?\s*([\s\S]*?)\s*```/i);
      if (match) c0ExtractedSql = match[1].trim();
    }
    // Semicolon split
    if (c0ExtractedSql.includes(';')) {
      c0ExtractedSql = c0ExtractedSql.split(';')[0].trim();
    }

    let c0ExtractedExecSuccess = false;
    let c0ExtractedExecError = null;
    let c0ExtractedRows = null;
    try {
      const extDb = new Database(ctx.fullPath, { readonly: true });
      try {
        c0ExtractedRows = extDb.prepare(c0ExtractedSql).all();
        c0ExtractedExecSuccess = true;
      } finally {
        extDb.close();
      }
    } catch (err) {
      c0ExtractedExecError = err.message;
    }

    const c0MatchGold = c0ExtractedExecSuccess && compareRowSets(c0ExtractedRows, goldRows);

    // ----------------------------------------------------
    // PATH (B): COGNICORE GOVERNED PATH
    // ----------------------------------------------------
    const govPrompt = buildPrompt({
      question: item.question,
      schema: ctx.schema,
      relationships: ctx.relationships,
      datasetType: 'sqlite',
      semantic: ctx.semantic,
      knowledgeText: ''
    });

    const govQueryRes = await queryOllama(govPrompt, 0.1, 500);
    const govRawText = govQueryRes.response;

    // Step B1: Clean SQL
    const govCleanedSql = cleanSqlOutput(govRawText);

    // Step B2: prepareSql
    const prepRes = prepareSql(govCleanedSql, { schema: ctx.schema, semantic: ctx.semantic });
    const govRepairedSql = prepRes.sql;
    const hasRepair = govRepairedSql.trim() !== govCleanedSql.trim();

    // Step B3: validateSql
    let govGateAccepted = true;
    let govGateReason = null;
    try {
      validateSql(govRepairedSql, ctx.schema, 'sqlite');
    } catch (err) {
      govGateAccepted = false;
      govGateReason = err.message;
    }

    // Step B4: enforcePolicy & execute via fresh adapter
    let govExecSuccess = false;
    let govExecError = null;
    let govRows = null;
    if (govGateAccepted) {
      const govAdapter = createAdapter('sqlite', { datasetId: path.basename(item.db), location: ctx.fullPath });
      try {
        const polSql = enforcePolicy({ sql: govRepairedSql, schema: ctx.schema, policy: null, datasetType: 'sqlite' });
        const execRes = await executeValidatedQuery(govAdapter, polSql, { maxRows: 1000 });
        govRows = execRes.rows;
        govExecSuccess = true;
      } catch (err) {
        govExecError = err.message;
      }
    }

    const govMatchGold = govExecSuccess && compareRowSets(govRows, goldRows);

    console.log(`  Raw C0: DirectExec=${c0DirectExecSuccess ? 'OK' : 'FAIL'} | MatchGold=${c0MatchGold}`);
    console.log(`  Gov V1: Gate=${govGateAccepted ? 'PASS' : 'REJECT'} | Repair=${hasRepair} | MatchGold=${govMatchGold}`);

    results.push({
      id: item.id,
      category: item.category,
      database: item.db,
      question: item.question,
      sha256,
      goldSql: item.goldSql,
      goldRowsCount: goldRows?.length ?? null,
      rawPath: {
        rawOutputText: c0RawText,
        extractedSql: c0ExtractedSql,
        directExecSuccess: c0DirectExecSuccess,
        directExecError: c0DirectExecError,
        extractedExecSuccess: c0ExtractedExecSuccess,
        extractedExecError: c0ExtractedExecError,
        matchGold: c0MatchGold,
        wallClockMs: c0QueryRes.wallClockMs
      },
      governedPath: {
        rawOutputText: govRawText,
        cleanedSql: govCleanedSql,
        repairedSql: govRepairedSql,
        repairDiff: hasRepair ? { from: govCleanedSql, to: govRepairedSql, repairs: prepRes.repairs } : null,
        gateAccepted: govGateAccepted,
        gateRejectReason: govGateReason,
        execSuccess: govExecSuccess,
        execError: govExecError,
        matchGold: govMatchGold,
        wallClockMs: govQueryRes.wallClockMs
      }
    });
  }

  // Disconnect adapters
  for (const dbRel of dbs) {
    await dbContexts[dbRel].adapter.disconnect();
  }

  const totalPilotTimeMs = Date.now() - tPilotStart;
  console.log(`\nR10 Mini-Pilot finished in ${(totalPilotTimeMs / 1000).toFixed(1)}s`);

  const outDir = path.resolve(__dirname, '../raw/recon');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'r10_mini_pilot.json'), JSON.stringify({
    totalQuestions: results.length,
    wallClockMs: totalPilotTimeMs,
    results
  }, null, 2), 'utf8');

  console.log(`Results saved to ${path.join(outDir, 'r10_mini_pilot.json')}`);
}

run().catch(console.error);
