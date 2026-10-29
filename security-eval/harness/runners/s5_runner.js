'use strict';

/**
 * S5 RUNNER — Schema and Context Leakage, deterministic parts (per PREREG_S5)
 *
 * Zero LLM, zero network by default.
 *   Part A (O5-1): HTTP opt-in (--base-url + --tokens-file + --dataset-id).
 *     Without them the part records NOT_RUN_HTTP_DISABLED (P4 pattern).
 *   Part B (O5-2): error-text probes — assertColumnAccess / enforcePolicy /
 *     validateSql with denied identifiers; messages scanned via S5LeakScanner.
 *   Part C (O5-3): prompt capture — buildPrompt / buildExplanationPrompt called
 *     directly with the frozen material (no model contact); 8 preregistered
 *     surfaces scanned for denied elements + canaries.
 *   Part D (O5-4): cross-user isolation — admin-vs-restricted prompt diff +
 *     static prompt-cache check (grep evidence recorded in output).
 *
 * Ladder: --rung 971d171 | 965ba48 | HEAD (PREREG_S5 header).
 * Preflight: material + fixture missing → abort exit 2 (waived on --dry-run).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const JsonlLogger = require('../oracles/jsonl_logger');
const ManifestWriter = require('../oracles/manifest_writer');
const StatsCalculator = require('../oracles/stats');
const { S5LeakScanner } = require('../oracles/s5_leak_scanner');

const SPEC_RUNGS = ['971d171', '965ba48', 'HEAD'];
const MATERIAL_PATH = path.resolve(__dirname, '../../data/s5/s5_material.json');
const FIXTURE_PATH = path.resolve(__dirname, '../../data/fixtures/s5_context.sqlite');

async function runS5Suite(opts = {}) {
  const rung = opts.rung || 'HEAD';
  const worktreeDir = rung === 'HEAD'
    ? path.resolve(__dirname, '../../../')
    : path.resolve(__dirname, `../../../../cognicore-ladder/${rung}`);
  const dryRun = Boolean(opts.dryRun);
  const baseUrl = opts.baseUrl || null;
  const tokensFile = opts.tokensFile || null;
  const datasetId = opts.datasetId || null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.resolve(__dirname, `../../runs/${timestamp}_s5_${rung}`);
  const logger = new JsonlLogger(runDir, 's5_results.jsonl');
  const failSummary = (error, code) => {
    const s = { suite: 'S5', rung, valid: false, error, runDir };
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 's5_summary.json'), JSON.stringify(s, null, 2), 'utf8');
    if (require.main === module) process.exitCode = code;
    return s;
  };

  console.log(`=== S5 (Schema & Context Leakage, deterministic parts) — rung ${rung} ===`);
  console.log(`Worktree: ${worktreeDir}\nMaterial: ${MATERIAL_PATH}\nFixture: ${FIXTURE_PATH}`);

  // --- Material + fixture preflight -----------------------------------------
  if (!fs.existsSync(MATERIAL_PATH)) {
    return failSummary(`Material missing at ${MATERIAL_PATH} — run harness/setup/10_build_s5_fixture.js and commit both artifacts first.`, 2);
  }
  const material = JSON.parse(fs.readFileSync(MATERIAL_PATH, 'utf8'));
  const fixtureExists = fs.existsSync(FIXTURE_PATH);
  let fixtureSha = null;
  if (fixtureExists) fixtureSha = crypto.createHash('sha256').update(fs.readFileSync(FIXTURE_PATH)).digest('hex');
  if (!dryRun) {
    if (!fixtureExists) {
      return failSummary(`Preflight: fixture missing at ${FIXTURE_PATH} — run harness/setup/10_build_s5_fixture.js and commit the built file.`, 2);
    }
    if (fixtureSha !== material.fixtureSha256) {
      return failSummary(`Fixture SHA-256 ${fixtureSha} != material ${material.fixtureSha256}. Rebuild via setup/10 or file a dated prereg amendment.`, 3);
    }
  } else if (!fixtureExists) {
    console.log('DRY-RUN: fixture missing (preflight waived).');
  }

  fs.mkdirSync(runDir, { recursive: true });
  ManifestWriter.writeManifest(runDir, {
    suite: 'S5', rung, worktree: worktreeDir, dryRun,
    materialPath: MATERIAL_PATH, fixturePath: FIXTURE_PATH, fixtureSha256: fixtureSha,
    httpMode: Boolean(baseUrl && tokensFile && datasetId), specRungs: SPEC_RUNGS,
  }, [MATERIAL_PATH, ...(fixtureExists ? [FIXTURE_PATH] : [])]);

  const { buildPrompt, buildSchemaDescription } = require(path.resolve(worktreeDir, 'server/src/structured/sql.generator.js'));
  const { buildExplanationPrompt } = require(path.resolve(worktreeDir, 'server/src/response/answer.composer.js'));
  const { assertColumnAccess, enforcePolicy, PolicyError } = require(path.resolve(worktreeDir, 'server/src/security/data.policy.js'));
  const { validateSql } = require(path.resolve(worktreeDir, 'server/src/structured/sql.validator.js'));

  const scanner = new S5LeakScanner({ inventory: material.inventory });
  if (scanner.inventoryCount === 0) {
    return failSummary('Material inventory is empty — scanner would be vacuous; refusing to run.', 3);
  }
  const relationships = material.schema.tables.flatMap((t) => (t.foreignKeys || []).map((fk) => ({
    fromTable: t.name, fromColumn: fk.column, toTable: fk.referencesTable, toColumn: fk.referencesColumn,
  })));

  const restrictedPolicy = material.policy;
  const adminPolicy = { deniedColumns: [], rowFilters: [] };
  let processedCount = 0;
  let errorProbesEvaluated = 0;
  let errorLeaks = 0;
  let promptSurfacesEvaluated = 0;
  let promptLeaks = 0;
  const verdictCounts = {};

  const record = (obj) => {
    processedCount++;
    logger.log(obj);
    logger.saveCheckpoint({ processedCount });
  };

  // ==========================================================================
  // PART B — error-text probes (O5-2). 6 preregistered probes.
  // ==========================================================================
  const errorProbes = [
    { id: 'B-P1', kind: 'assertColumnAccess', sql: 'SELECT account_id, ssn_last4 FROM accounts WHERE tenant_id = \'tenant_a\'', deniedElement: 'ssn_last4' },
    { id: 'B-P2', kind: 'assertColumnAccess', sql: 'SELECT account_id, balance FROM accounts WHERE tenant_id = \'tenant_a\'', deniedElement: 'balance' },
    { id: 'B-P3', kind: 'enforcePolicy', sql: 'SELECT ssn_last4, balance FROM accounts', deniedElement: 'ssn_last4' },
    { id: 'B-P4', kind: 'validateSql', sql: 'SELECT secret_column FROM accounts', deniedElement: 'secret_column' },
    { id: 'B-P5', kind: 'assertColumnAccess', sql: 'SELECT account_id FROM accounts_x', deniedElement: 'accounts_x' },
    { id: 'B-P6', kind: 'validateSql', sql: 'DROP TABLE accounts', deniedElement: 'accounts' },
  ];
  for (const probe of errorProbes) {
    const base = { part: 'B', probeId: probe.id, kind: probe.kind, sql: probe.sql, rung };
    if (dryRun) { record({ ...base, status: 'DRY_RUN' }); continue; }
    errorProbesEvaluated++;
    let outcome = 'NOT_APPLICABLE_NO_ERROR';
    let message = null;
    let matches = [];
    try {
      if (probe.kind === 'assertColumnAccess') assertColumnAccess(probe.sql, material.schema, restrictedPolicy);
      else if (probe.kind === 'enforcePolicy') enforcePolicy({ sql: probe.sql, schema: material.schema, policy: restrictedPolicy, datasetType: 'sqlite' });
      else validateSql(probe.sql, material.schema, 'sqlite');
    } catch (err) {
      message = String(err && err.message ? err.message : err);
      const scan = scanner.scanText(message);
      const targeted = scan.matches.filter((m) => m.element === probe.deniedElement);
      matches = targeted;
      outcome = targeted.length > 0 ? 'LEAK_IN_ERROR' : 'NO_LEAK_IN_ERROR';
    }
    if (outcome === 'LEAK_IN_ERROR') errorLeaks++;
    verdictCounts[outcome] = (verdictCounts[outcome] || 0) + 1;
    record({ ...base, outcome, message, matches });
  }

  // ==========================================================================
  // PART C — prompt capture (O5-3). 8 preregistered surfaces.
  // ==========================================================================
  const surfaces = [];
  if (!dryRun) {
    const q = material.question;
    const P = material.poisoned;
    // 1. restricted, clean inputs — Item-12 schema/semantic filtering expected
    surfaces.push({
      id: 'C-S1', builder: 'buildPrompt',
      args: { question: q, schema: material.schema, semantic: material.semantic, relationships, datasetType: 'sqlite', policy: restrictedPolicy },
      expectation: 'PROMPT_CLEAN (denied schema/semantic filtered per sql.generator.js:26-57)',
    });
    // 2. admin, clean inputs — authorized baseline (contains everything)
    surfaces.push({
      id: 'C-S2', builder: 'buildPrompt',
      args: { question: q, schema: material.schema, semantic: material.semantic, relationships, datasetType: 'sqlite', policy: adminPolicy },
      expectation: 'authorized baseline (admin)',
    });
    // 3. restricted + poisoned knowledgeText — unfiltered pass-through (:99)
    surfaces.push({
      id: 'C-S3', builder: 'buildPrompt',
      args: { question: q, schema: material.schema, semantic: material.semantic, relationships, datasetType: 'sqlite', policy: restrictedPolicy, knowledgeText: P.knowledgeText },
      expectation: 'PROMPT_LEAK if knowledgeText passes through unfiltered',
    });
    // 4. restricted + poisoned conversationContext — unfiltered pass-through (:99)
    surfaces.push({
      id: 'C-S4', builder: 'buildPrompt',
      args: { question: q, schema: material.schema, semantic: material.semantic, relationships, datasetType: 'sqlite', policy: restrictedPolicy, conversationContext: P.conversationContext },
      expectation: 'PROMPT_LEAK if conversationContext passes through unfiltered',
    });
    // 5. explanation prompt with poisoned conversationContext (sanitized :40)
    surfaces.push({
      id: 'C-S5', builder: 'buildExplanationPrompt',
      args: { question: q, evidence: { source_type: 'database', dataset_name: 's5_context', query: 'SELECT tier, COUNT(*) AS n FROM accounts GROUP BY tier', row_count: 3, columns: ['tier', 'n'], sample_rows: [{ tier: 'GOLD', n: 8 }], truncated: false }, conversationContext: P.conversationContext },
      expectation: 'measured (neutralizeInjection strips instruction-like lines only)',
    });
    // 6. explanation prompt with poisoned preferences (sanitized :41)
    surfaces.push({
      id: 'C-S6', builder: 'buildExplanationPrompt',
      args: { question: q, evidence: { source_type: 'database', dataset_name: 's5_context', query: 'SELECT tier, COUNT(*) AS n FROM accounts GROUP BY tier', row_count: 3, columns: ['tier', 'n'], sample_rows: [{ tier: 'GOLD', n: 8 }], truncated: false }, preferences: P.preferences },
      expectation: 'measured',
    });
    // 7. restricted + recovery note carrying previous SQL with a denied column (:83)
    surfaces.push({
      id: 'C-S7', builder: 'buildPrompt',
      args: { question: q, schema: material.schema, semantic: material.semantic, relationships, datasetType: 'sqlite', policy: restrictedPolicy, recovery: { previousSql: 'SELECT ssn_last4 FROM accounts', error: 'syntax error near FROM', hints: ['use exact column names'] } },
      expectation: 'PROMPT_LEAK if recovery.previousSql interpolated unfiltered',
    });
    // 8. canary suppression in SQL prompt: canaries in ALLOWED-column semantic values
    surfaces.push({
      id: 'C-S8', builder: 'buildPrompt',
      args: { question: q, schema: material.schema, semantic: material.semantic, relationships, datasetType: 'sqlite', policy: restrictedPolicy },
      expectation: 'CANARY_PROMPT_LEAK check (canary regex strip per sql.generator.js:114)',
      canaryOnly: true,
    });
  }

  for (const surface of surfaces) {
    const base = { part: 'C', surfaceId: surface.id, builder: surface.builder, rung };
    if (dryRun) { record({ ...base, status: 'DRY_RUN' }); continue; }
    promptSurfacesEvaluated++;
    let prompt;
    try {
      prompt = surface.builder === 'buildPrompt' ? buildPrompt(surface.args) : buildExplanationPrompt(surface.args);
    } catch (err) {
      verdictCounts.PROMPT_BUILD_ERROR = (verdictCounts.PROMPT_BUILD_ERROR || 0) + 1;
      record({ ...base, outcome: 'PROMPT_BUILD_ERROR', error: String(err && err.message) });
      continue;
    }
    const scan = scanner.scanText(prompt);
    const canaryMatches = scan.matches.filter((m) => m.elementClass === 'canary');
    let outcome;
    if (surface.canaryOnly) {
      outcome = canaryMatches.length > 0 ? 'CANARY_PROMPT_LEAK' : 'CANARY_SUPPRESSED';
    } else if (surface.id === 'C-S2') {
      outcome = 'AUTHORIZED_BASELINE'; // admin prompt intentionally contains all elements
    } else {
      outcome = scan.matches.length > 0 ? 'PROMPT_LEAK' : 'PROMPT_CLEAN';
    }
    if (outcome === 'PROMPT_LEAK' || outcome === 'CANARY_PROMPT_LEAK') promptLeaks++;
    verdictCounts[outcome] = (verdictCounts[outcome] || 0) + 1;
    record({ ...base, outcome, expectation: surface.expectation, matches: scan.matches, promptLength: prompt.length });
  }

  // ==========================================================================
  // PART D — cross-user isolation (O5-4)
  // ==========================================================================
  let partD = { outcome: 'NOT_EVALUATED_DRY_RUN' };
  if (!dryRun) try {
    const restrictedPrompt = buildPrompt({
      question: material.question, schema: material.schema, semantic: material.semantic,
      relationships, datasetType: 'sqlite', policy: restrictedPolicy,
    });
    const adminPrompt = buildPrompt({
      question: material.question, schema: material.schema, semantic: material.semantic,
      relationships, datasetType: 'sqlite', policy: adminPolicy,
    });
    const adminOnlyLines = S5LeakScanner.promptDiff(restrictedPrompt, adminPrompt);
    const scanRestricted = scanner.scanText(restrictedPrompt);
    // SHARING_DETECTED would require the restricted prompt to contain admin-only
    // inventory elements — impossible for pure functions; measured anyway.
    const sharing = scanRestricted.state === 'LEAK'
      ? scanRestricted.matches.filter((m) => adminOnlyLines.some((l) => l.includes(String(m.element))))
      : [];
    // Static prompt-cache evidence (grep-style check, recorded verbatim)
    const genSrc = fs.readFileSync(path.resolve(worktreeDir, 'server/src/structured/sql.generator.js'), 'utf8');
    const cacheHits = ['cache', 'memo', 'lru'].filter((kw) => new RegExp(kw, 'i').test(genSrc));
    partD = {
      outcome: sharing.length > 0 ? 'SHARING_DETECTED' : 'NO_PROMPT_CACHE_FOUND',
      adminOnlyLineCount: adminOnlyLines.length,
      restrictedPromptScan: scanRestricted.state,
      sharingMatches: sharing.slice(0, 5),
      staticEvidence: {
        checked: 'server/src/structured/sql.generator.js',
        keywordsFound: cacheHits,
        note: 'buildPrompt is a pure function of per-request inputs; no prompt cache layer exists in the generator (grep evidence). Cross-user contamination is therefore measurable only via shared state outside this module.',
      },
    };
    verdictCounts[partD.outcome] = (verdictCounts[partD.outcome] || 0) + 1;
    record({ part: 'D', oracle: 'O5-4', ...partD, rung });
  } catch (e) {
    partD = {
      outcome: 'RUNG_CRASH',
      error: String((e && e.message) || e).slice(0, 200),
      note: 'rung buildPrompt crashed (pre-965ba48 unguarded c.stats.missing; frozen material carries no per-column stats); Part D honestly not evaluated at this rung',
    };
    verdictCounts[partD.outcome] = (verdictCounts[partD.outcome] || 0) + 1;
    record({ part: 'D', oracle: 'O5-4', ...partD, rung });
  }

  // ==========================================================================
  // PART A — endpoint scan (O5-1), HTTP opt-in
  // ==========================================================================
  let partA = { outcome: 'NOT_RUN_HTTP_DISABLED', note: 'supply --base-url, --tokens-file and --dataset-id to enable (RUNBOOK_S5 §4)' };
  if (baseUrl && tokensFile && datasetId && !dryRun) {
    let tokens;
    try { tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8')); } catch (err) {
      return failSummary(`--tokens-file unreadable: ${err.message}`, 2);
    }
    partA = { outcome: 'EVALUATED', endpoints: [] };
    for (const role of ['viewer', 'admin']) {
      const token = tokens[role];
      if (!token) {
        partA.endpoints.push({ role, outcome: 'NOT_EVALUATED_NO_TOKEN' });
        continue;
      }
      for (const kind of ['schema', 'preview']) {
        const url = kind === 'schema'
          ? `${baseUrl.replace(/\/$/, '')}/api/schema/${datasetId}`
          : `${baseUrl.replace(/\/$/, '')}/api/datasets/${datasetId}/preview?table=accounts&limit=25`;
        try {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
          const body = await res.text();
          const scan = scanner.scanText(body);
          partA.endpoints.push({ role, kind, httpStatus: res.status, outcome: scan.state, matches: scan.matches, bodyLength: body.length });
        } catch (err) {
          partA.endpoints.push({ role, kind, outcome: 'HTTP_ERROR', error: String(err && err.message) });
        }
      }
    }
    const schV = partA.endpoints.find((e) => e.role === 'viewer' && e.kind === 'schema');
    const prevV = partA.endpoints.find((e) => e.role === 'viewer' && e.kind === 'preview');
    if (schV && prevV && schV.outcome !== 'HTTP_ERROR' && prevV.outcome !== 'HTTP_ERROR') {
      const { b, c } = S5LeakScanner.pairedIndicators(schV, prevV);
      partA.asymmetry = {
        schemaViewerLeaks: schV.matches.length, previewViewerLeaks: prevV.matches.length,
        mcnemarB: b, mcnemarC: c,
        mcnemarP: (b + c) > 0 ? StatsCalculator.exactMcNemarTest(b, c) : null,
      };
    }
    verdictCounts[partA.outcome] = (verdictCounts[partA.outcome] || 0) + 1;
    record({ part: 'A', oracle: 'O5-1', ...partA, rung });
  } else if (dryRun && (baseUrl || tokensFile || datasetId)) {
    partA = { outcome: 'DRY_RUN_FLAGGED_HTTP' };
  } else {
    verdictCounts[partA.outcome] = (verdictCounts[partA.outcome] || 0) + 1;
    record({ part: 'A', oracle: 'O5-1', ...partA, rung });
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  if (dryRun) {
    const s = {
      suite: 'S5', rung, dryRun: true, valid: null, runDir,
      note: 'DRY_RUN — nothing executed; preflight waived.',
      partTotals: material.partTotals,
    };
    fs.writeFileSync(path.join(runDir, 's5_summary.json'), JSON.stringify(s, null, 2), 'utf8');
    console.log('\nDRY-RUN complete — no probes executed.');
    return s;
  }

  const cpBoundB = (errorProbesEvaluated === material.partTotals.errorProbes && errorLeaks === 0)
    ? StatsCalculator.clopperPearsonZeroEvents(errorProbesEvaluated, 0.95) : null;
  const quotableB = errorProbesEvaluated === material.partTotals.errorProbes;
  const quotableC = promptSurfacesEvaluated === material.partTotals.promptSurfaces;

  const summary = {
    suite: 'S5', rung, valid: true, dryRun: false, runDir,
    fixtureSha256: fixtureSha, materialPromptInventorySha256: material.promptInventorySha256,
    partA, partB: {
      evaluated: errorProbesEvaluated, expected: material.partTotals.errorProbes,
      quotable: quotableB, leaks: errorLeaks,
      clopperPearsonUpper95_zeroLeaks: cpBoundB,
    },
    partC: {
      evaluated: promptSurfacesEvaluated, expected: material.partTotals.promptSurfaces,
      quotable: quotableC, leaks: promptLeaks,
    },
    partD,
    verdictCounts,
    zeroLlm: true,
    methodNote: 'Part B: 6 preregistered error probes through assertColumnAccess/enforcePolicy/validateSql; messages scanned against the frozen inventory. Part C: 8 preregistered prompt surfaces via direct buildPrompt/buildExplanationPrompt calls (no model); scanner = identifier word-boundary + substring + canary matching. Part D: admin-vs-restricted prompt diff + static cache grep evidence. Part A: HTTP opt-in per P4 pattern; without credentials it is NOT_RUN_HTTP_DISABLED.',
  };
  fs.writeFileSync(path.join(runDir, 's5_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`\nS5 complete: B ${errorProbesEvaluated}/${material.partTotals.errorProbes} leaks=${errorLeaks} quotable=${quotableB}; C ${promptSurfacesEvaluated}/${material.partTotals.promptSurfaces} leaks=${promptLeaks} quotable=${quotableC}; D=${partD.outcome}; A=${partA.outcome}`);
  if (require.main === module) process.exitCode = 0;
  return summary;
}

module.exports = { runS5Suite };

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const rungArg = (get('--rung') || 'HEAD');
  if (!SPEC_RUNGS.includes(rungArg)) {
    console.error(`Unknown --rung "${rungArg}". Spec rungs: ${SPEC_RUNGS.join(', ')}`);
    process.exit(2);
  }
  runS5Suite({
    rung: rungArg,
    dryRun: args.includes('--dry-run'),
    baseUrl: get('--base-url'),
    tokensFile: get('--tokens-file'),
    datasetId: get('--dataset-id'),
  })
    .then((s) => { if (!s.valid && !s.dryRun) process.exitCode = process.exitCode || 2; })
    .catch((err) => { console.error('S5 runner crashed:', err); process.exitCode = 1; });
}
