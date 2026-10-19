const fs = require('fs');
const res = fs.readFileSync('validation/raw/after2/v4c_resource.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const gate = fs.readFileSync('validation/raw/after2/v4c_gate.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
console.log('Count res:', res.length, 'gate:', gate.length);
let maxGap = 0;
for (let i = 0; i < 29; i++) {
  const g = gate[i];
  const r = res[i];
  if (r.max_heartbeat_gap_ms > maxGap) maxGap = r.max_heartbeat_gap_ms;
  console.log(`[${i+1}] ${g.id} (${g.construct}) | Gate: ${g.gate_accepted ? 'ACC' : 'REJ (' + g.gate_layer + ')'} | Exec: ${r.execution_status} | Elapsed: ${r.elapsed_ms}ms | Peak RSS: ${r.peak_rss_mb}MB | EL Blocked: ${r.event_loop_blocked} | Max Gap: ${r.max_heartbeat_gap_ms}ms`);
}
console.log('MAX EVENT LOOP GAP:', maxGap, 'ms');
