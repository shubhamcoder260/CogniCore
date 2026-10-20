const fs = require('fs');

// 1. Update spider_runner.js
let runner = fs.readFileSync('validation/experiments/spider_runner.js', 'utf8');
const oldRunnerTarget = `function loadCatalog() {
  const sampleItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl')).map((item) => ({ ...item, split: 'test' }));
  const pilotItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/pilot.jsonl')).map((item) => ({ ...item, split: 'pilot' }));`;

const newRunnerTarget = `function loadCatalog() {
  const sampleItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl')).map((item) => ({ ...item, split: 'test' }));
  const sampleBItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/frozen_sample_300_B.jsonl')).map((item) => ({ ...item, split: 'test_b' }));
  const pilotItems = loadJsonl(path.join(process.cwd(), 'validation/data/spider/pilot.jsonl')).map((item) => ({ ...item, split: 'pilot' }));`;

runner = runner.replace(oldRunnerTarget, newRunnerTarget);
runner = runner.replace(
  'for (const item of [...sampleItems, ...pilotItems]) {',
  'for (const item of [...sampleItems, ...sampleBItems, ...pilotItems]) {'
);
runner = runner.replace(
  "hardness: check.hardness || 'medium',",
  "hardness: check.hardness || item.hardness || 'medium',"
);
fs.writeFileSync('validation/experiments/spider_runner.js', runner, 'utf8');
console.log('spider_runner.js updated with Sample B support');

// 2. Update spider_supervisor.js
let supervisor = fs.readFileSync('validation/experiments/spider_supervisor.js', 'utf8');
const oldSupervisorTarget = `  if (!targetItems) {
    const file = split === 'pilot'
      ? path.join(process.cwd(), 'validation/data/spider/pilot.jsonl')
      : path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl');`;

const newSupervisorTarget = `  if (!targetItems) {
    let file;
    if (split === 'pilot') {
      file = path.join(process.cwd(), 'validation/data/spider/pilot.jsonl');
    } else if (split === 'sample_b' || split === 'sampleB' || split === 'B') {
      file = path.join(process.cwd(), 'validation/data/spider/frozen_sample_300_B.jsonl');
    } else {
      file = path.join(process.cwd(), 'validation/data/spider/frozen_sample_300.jsonl');
    }`;

supervisor = supervisor.replace(oldSupervisorTarget, newSupervisorTarget);
fs.writeFileSync('validation/experiments/spider_supervisor.js', supervisor, 'utf8');
console.log('spider_supervisor.js updated with Sample B support');
