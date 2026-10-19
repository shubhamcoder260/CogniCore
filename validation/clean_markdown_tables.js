'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const filesToClean = [
  'validation/results/after/AFTER_FIX_REPORT.md',
  'validation/results/after/V12_RESULTS.md',
  'validation/results/after/V13_RESULTS.md',
  'validation/results/after/V14_RESULTS.md',
  'validation/results/after/V15_RESULTS.md',
  'validation/results/after/V3_RESULTS.md',
  'validation/results/after/V3b_RESULTS.md',
  'validation/results/after/V3c_RESULTS.md',
  'validation/results/after/V4_RESULTS.md',
  'validation/results/after/V4b_RESULTS.md',
  'validation/results/after/V4c_RESULTS.md',
  'validation/results/after/V4d_RESULTS.md',
  'validation/LIMITATIONS.md'
];

for (const rel of filesToClean) {
  const p = path.resolve(repoRoot, rel);
  if (!fs.existsSync(p)) continue;
  let text = fs.readFileSync(p, 'utf8');
  const before = text;

  // Replace math notation in table headers and cells
  text = text.replace(/Total \$n\$/g, 'Total N');
  text = text.replace(/Total \(\$n\$\)/g, 'Total (N)');
  text = text.replace(/Total Items \(\$N\$\)/g, 'Total Items (N)');
  text = text.replace(/Total Queries \(\$N\$\)/g, 'Total Queries (N)');
  text = text.replace(/\| \$n\$ \|/g, '| N |');
  text = text.replace(/\| \$N\$ \|/g, '| N |');
  text = text.replace(/Baseline Leaks \(\$k\$\)/g, 'Baseline Leaks (K)');
  text = text.replace(/After Leaks \(\$k\$\)/g, 'After Leaks (K)');
  text = text.replace(/Baseline Rej \(\$k\$\)/g, 'Baseline Rej (K)');
  text = text.replace(/After Rej \(\$k\$\)/g, 'After Rej (K)');
  text = text.replace(/Accepted \(\$k\$\)/g, 'Accepted (K)');
  text = text.replace(/Detected \(\$k\$\)/g, 'Detected (K)');
  text = text.replace(/Falsely Blocked \(\$k\$\)/g, 'Falsely Blocked (K)');
  text = text.replace(/Neutralized \(\$k\$\)/g, 'Neutralized (K)');
  text = text.replace(/Masked \(\$k\$\)/g, 'Masked (K)');
  text = text.replace(/False Rejections \(\$k\$\)/g, 'False Rejections (K)');
  text = text.replace(/\$\\to\$/g, '->');
  text = text.replace(/\$\\rightarrow\$/g, '->');
  text = text.replace(/\\rightarrow/g, '->');
  text = text.replace(/\$0 \/ 119\$/g, '0 / 119');
  text = text.replace(/\(\$1 - 0\.05\^\{1\/n\}\$\)/g, '(1 - 0.05^(1/n))');
  text = text.replace(/\(\$3\/n\$\)/g, '(3/n)');
  text = text.replace(/Rule of Three \(\$3\/n\$\)/g, 'Rule of Three (3/n)');
  text = text.replace(/\$n_\\text\{accepted\} = 1503\$/g, 'n_accepted = 1503');
  text = text.replace(/\(\$N=15\$ to \$30\$\)/g, '(N = 15 to 30)');
  text = text.replace(/\$O\(N\)\$/g, 'O(N)');
  text = text.replace(/\(\$16\^8 \\approx 4\.29 \\times 10\^9\$\)/g, '(16^8 ~ 4.29 x 10^9)');
  text = text.replace(/\$16\^8 \\approx 4\.29 \\times 10\^9/g, '16^8 ~ 4.29 x 10^9');
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (m, g) => '`' + g.trim() + '`');
  text = text.replace(/\$2,774 - 112 = 2,662\$/g, '2,774 - 112 = 2,662');
  text = text.replace(/\$1,191 - 112 = 1,079\$/g, '1,191 - 112 = 1,079');

  // Fix table cell variable interpolations that have $
  text = text.replace(/SELECT \$\{cq\} FROM \$\{tq\}/g, 'SELECT {col} FROM {table}');

  if (text !== before) {
    fs.writeFileSync(p, text, 'utf8');
    console.log('Cleaned file:', rel);
  } else {
    console.log('Unchanged:', rel);
  }
}
