const fs = require('fs');
const lines = fs.readFileSync('validation/raw/spider/spider_sample_b_units.jsonl', 'utf8').trim().split('\n').map(JSON.parse);

console.log('=== VALIDATION REJECTIONS IN C4 ===');
for (const r of lines.filter(x => x.config === 'C4' && x.status === 'validation_error')) {
  console.log(`- [${r.question_id}] (${r.db_id}) "${r.question}"`);
  console.log(`  Gen SQL: ${r.generated_sql}`);
  console.log(`  Reason: ${r.error_message}`);
}

console.log('\n=== RUNTIME ERRORS IN C4 ===');
for (const r of lines.filter(x => x.config === 'C4' && x.status === 'error')) {
  console.log(`- [${r.question_id}] (${r.db_id}) "${r.question}"`);
  console.log(`  Gen SQL: ${r.generated_sql}`);
  console.log(`  Error: ${r.error_message}`);
  console.log(`  Recovery Attempts: ${r.recovery_attempts}`);
}

console.log('\n=== C0 ERRORS (UNCAUGHT BY BASELINE) ===');
for (const r of lines.filter(x => x.config === 'C0' && x.status === 'error')) {
  console.log(`- [${r.question_id}] (${r.db_id}) "${r.question}"`);
  console.log(`  Gen SQL: ${r.generated_sql}`);
  console.log(`  Error: ${r.error_message}`);
}
