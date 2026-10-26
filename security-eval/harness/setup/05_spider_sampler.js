'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { RcrReader, ROLE_MAP } = require('./04_rcr_reader');

// Deterministic PRNG (Mulberry32)
function createPrng(seed = 42) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function classifyHardness(sql) {
  const upper = sql.toUpperCase();
  const joinCount = (upper.match(/\bJOIN\b/g) || []).length;
  const hasSubquery = /\bSELECT\b[\s\S]+\bSELECT\b/i.test(sql);
  const hasAgg = /\b(COUNT|AVG|SUM|MIN|MAX|GROUP\s+BY|HAVING)\b/i.test(sql);
  const hasSet = /\b(UNION|INTERSECT|EXCEPT)\b/i.test(sql);

  if (hasSet || (joinCount >= 2 && hasSubquery)) return 'HARD';
  if (joinCount >= 1 || hasSubquery || hasAgg) return 'MEDIUM';
  return 'EASY';
}

function sampleSpiderDatabases(zipPath, outPath, opts = {}) {
  const seed = opts.seed || 42;
  const prng = createPrng(seed);

  console.log(`Sampling from ${zipPath} with seed ${seed}...`);
  const raw = execSync(`unzip -p "${zipPath}" access_control_dataset.jsonl`, {
    maxBuffer: 100 * 1024 * 1024,
    encoding: 'utf8',
  });

  const lines = raw.split('\n').filter(Boolean);
  const dbRecords = new Map();

  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (!dbRecords.has(r.db_id)) {
        const schema = RcrReader.parseSchemaDdl(r.schema_ddl);
        const tableCount = Object.keys(schema).length;
        dbRecords.set(r.db_id, {
          dbId: r.db_id,
          tableCount,
          schema,
          records: [],
        });
      }
      dbRecords.get(r.db_id).records.push(r);
    } catch (_) {}
  }

  // Stratify 153 databases into 4 table-count tiers
  const strata = {
    tier1_small: [],      // 2 - 3 tables
    tier2_medium_sm: [],  // 4 - 6 tables
    tier3_medium_lg: [],  // 7 - 10 tables
    tier4_large: [],      // 11 - 26 tables
  };

  for (const db of dbRecords.values()) {
    if (db.tableCount <= 3) strata.tier1_small.push(db);
    else if (db.tableCount <= 6) strata.tier2_medium_sm.push(db);
    else if (db.tableCount <= 10) strata.tier3_medium_lg.push(db);
    else strata.tier4_large.push(db);
  }

  // Shuffle and pick 4 from each stratum
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const selectedDbs = [
    ...shuffle(strata.tier1_small).slice(0, 4),
    ...shuffle(strata.tier2_medium_sm).slice(0, 4),
    ...shuffle(strata.tier3_medium_lg).slice(0, 4),
    ...shuffle(strata.tier4_large).slice(0, 4),
  ];

  const sampleManifest = {
    seed,
    timestamp: new Date().toISOString(),
    totalDbs: selectedDbs.length,
    databases: [],
  };

  for (const db of selectedDbs) {
    // Categorize records into bins: [isPermitted] x [hardness]
    const bins = {
      permitted_easy: [],
      permitted_medium: [],
      permitted_hard: [],
      denied_easy: [],
      denied_medium: [],
      denied_hard: [],
    };

    for (const rec of db.records) {
      const isPermitted = !rec.ground_truth_label.startsWith('ERROR');
      const hardness = classifyHardness(rec.query).toLowerCase();
      const binKey = `${isPermitted ? 'permitted' : 'denied'}_${hardness}`;
      if (bins[binKey]) {
        bins[binKey].push(rec);
      }
    }

    // Stratified sample 50 queries across bins
    const sampledQueries = [];
    const binKeys = Object.keys(bins);
    const targetPerBin = Math.max(1, Math.floor(50 / binKeys.length));

    for (const k of binKeys) {
      const shuffledBin = shuffle(bins[k]);
      sampledQueries.push(...shuffledBin.slice(0, targetPerBin));
    }

    // If still under 50, fill from remaining
    if (sampledQueries.length < 50) {
      const sampledSet = new Set(sampledQueries);
      const remaining = shuffle(db.records.filter(r => !sampledSet.has(r)));
      sampledQueries.push(...remaining.slice(0, 50 - sampledQueries.length));
    }

    const finalQueries = sampledQueries.slice(0, 50).map((r, idx) => {
      const translated = RcrReader.translateRecord(r);
      return {
        queryId: `${db.dbId}_q${String(idx + 1).padStart(2, '0')}`,
        user: r.user,
        evaluatedRole: translated.evaluatedRole,
        query: r.query,
        question: r.question,
        hardness: classifyHardness(r.query),
        groundTruthLabel: r.ground_truth_label,
        isPermitted: !r.ground_truth_label.startsWith('ERROR'),
        policies: translated.policiesForRole,
      };
    });

    sampleManifest.databases.push({
      dbId: db.dbId,
      tableCount: db.tableCount,
      tables: Object.keys(db.schema),
      queryCount: finalQueries.length,
      queries: finalQueries,
    });
  }

  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(sampleManifest, null, 2), 'utf8');

  return sampleManifest;
}

if (require.main === module) {
  const zipPath = path.resolve(__dirname, '../../../scratch/RCR/data/spider/spider-access-control.zip');
  const outPath = path.resolve(__dirname, '../../data/manifests/spider_16_db_sample.json');
  const res = sampleSpiderDatabases(zipPath, outPath);
  console.log(`Sampled ${res.databases.length} databases with ${res.databases.reduce((sum, d) => sum + d.queryCount, 0)} total queries.`);
  for (const d of res.databases) {
    console.log(` - ${d.dbId.padEnd(25)} : ${d.tableCount} tables (${d.queryCount} queries)`);
  }
}

module.exports = { sampleSpiderDatabases };
