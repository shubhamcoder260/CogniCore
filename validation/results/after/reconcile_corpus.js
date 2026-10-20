'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const DATA_DIR = path.join(ROOT, 'validation', 'data');
const REPORT_PATH = path.join(__dirname, 'AFTER_FIX_REPORT.md');

// Helper to count lines and stratify
function analyzeJsonl(filePath, extractors = {}) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(DATA_DIR, filePath);
  if (!fs.existsSync(absPath)) {
    return { error: 'File not found: ' + absPath };
  }
  const raw = fs.readFileSync(absPath, 'utf8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const total = lines.length;
  const distributions = {};

  for (const k of Object.keys(extractors)) {
    distributions[k] = {};
  }

  for (const line of lines) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      continue;
    }
    for (const [k, fn] of Object.entries(extractors)) {
      const val = fn(obj);
      distributions[k][val] = (distributions[k][val] || 0) + 1;
    }
  }

  return { total, distributions };
}

// Enumerate all frozen corpora
const corpusSummary = {};

// v3
corpusSummary['v3/v3_queries.jsonl'] = analyzeJsonl('v3/v3_queries.jsonl', {
  construct: o => o.construct,
  target_mechanism: o => o.target_mechanism,
  provenance: o => o.provenance
});

// v3b
corpusSummary['v3b/v3b_queries.jsonl'] = analyzeJsonl('v3b/v3b_queries.jsonl', {
  construct: o => o.construct,
  variant_form: o => o.variant_form,
  provenance: o => o.provenance
});

// v3c
corpusSummary['v3c/v3c_queries.jsonl'] = analyzeJsonl('v3c/v3c_queries.jsonl', {
  variant_form: o => o.variant_form,
  construct: o => o.construct
});

// v4
corpusSummary['v4/attacks.jsonl'] = analyzeJsonl('v4/attacks.jsonl', {
  class: o => o.class,
  category: o => o.category,
  provenance: o => o.provenance
});
corpusSummary['v4/benign.jsonl'] = analyzeJsonl('v4/benign.jsonl', {
  class: o => o.class,
  category: o => o.category,
  provenance: o => o.provenance
});
corpusSummary['v4/boundary.jsonl'] = analyzeJsonl('v4/boundary.jsonl', {
  class: o => o.class,
  category: o => o.category,
  provenance: o => o.provenance
});
corpusSummary['v4/fuzz.jsonl'] = analyzeJsonl('v4/fuzz.jsonl', {
  class: o => o.class,
  category: o => o.category,
  provenance: o => o.provenance
});

// v4b
corpusSummary['v4b/b2_probes.jsonl'] = analyzeJsonl('v4b/b2_probes.jsonl', {
  class: o => o.class,
  category: o => o.category,
  construct: o => o.construct,
  provenance: o => o.provenance
});
corpusSummary['v4b/c2_benign.jsonl'] = analyzeJsonl('v4b/c2_benign.jsonl', {
  class: o => o.class,
  category: o => o.category,
  construct: o => o.construct,
  provenance: o => o.provenance
});
corpusSummary['v4b/d2_boundary.jsonl'] = analyzeJsonl('v4b/d2_boundary.jsonl', {
  class: o => o.class,
  category: o => o.category,
  provenance: o => o.provenance
});

// v4c
corpusSummary['v4c/dos_items.jsonl'] = analyzeJsonl('v4c/dos_items.jsonl', {
  class: o => o.class,
  construct: o => o.construct,
  provenance: o => o.provenance
});

// v4d
corpusSummary['v4d/executable_writes.jsonl'] = analyzeJsonl('v4d/executable_writes.jsonl', {
  category: o => o.category,
  provenance: o => o.provenance
});

// v12
corpusSummary['v12/v12_files.jsonl'] = analyzeJsonl('v12/v12_files.jsonl', {
  category: o => o.category,
  subcategory: o => o.subcategory,
  expected_decision: o => o.expected_decision,
  provenance: o => o.provenance
});

// v13
corpusSummary['v13/v13_corpus.jsonl'] = analyzeJsonl('v13/v13_corpus.jsonl', {
  corpus_type: o => o.corpus_type,
  subcategory: o => o.subcategory,
  expected_blocked: o => o.expected_blocked,
  provenance: o => o.provenance
});

// v15
corpusSummary['v15/v15_pii.jsonl'] = analyzeJsonl('v15/v15_pii.jsonl', {
  category: o => o.category,
  subtype: o => o.subtype,
  in_scope: o => o.in_scope
});

// Save intermediate json
fs.writeFileSync(path.join(__dirname, 'reconcile_corpus_counts.json'), JSON.stringify(corpusSummary, null, 2));

console.log('=== CORPUS FILE SUMMARY ===');
for (const [file, info] of Object.entries(corpusSummary)) {
  console.log(`File: ${file} | Total lines: ${info.total}`);
  for (const [distKey, dist] of Object.entries(info.distributions || {})) {
    const keys = Object.keys(dist);
    if (keys.length <= 15) {
      console.log(`  ${distKey}: ${JSON.stringify(dist)}`);
    } else {
      console.log(`  ${distKey}: ${keys.length} distinct values (sum: ${Object.values(dist).reduce((a,b)=>a+b,0)})`);
    }
  }
}
