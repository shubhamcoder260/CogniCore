// Spider dev sampler, seed 20261015
const fs = require("fs");
const path = require("path");

const [devPath, outDir] = process.argv.slice(2);
if (!devPath || !outDir) {
  throw new Error("Usage: node sample.js <dev.json> <output-directory>");
}

const dev = JSON.parse(fs.readFileSync(devPath, "utf8"));
if (!Array.isArray(dev) || dev.length !== 1034) {
  throw new Error(`Expected 1034 questions, got ${dev.length}`);
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261015);
const indices = dev.map((_, i) => i);

for (let i = indices.length - 1; i > 0; i--) {
  const j = Math.floor(random() * (i + 1));
  [indices[i], indices[j]] = [indices[j], indices[i]];
}

const toRow = i => ({
  id: `spider-dev-${i}`,
  db_id: dev[i].db_id,
  question: dev[i].question,
  gold_sql: dev[i].query
});

const writeJsonl = (name, slice) => {
  const data = slice.map(i => JSON.stringify(toRow(i))).join("\n") + "\n";
  fs.writeFileSync(path.join(outDir, name), data, "utf8");
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "pool_order.json"),
  JSON.stringify(indices) + "\n",
  "utf8"
);

writeJsonl("pilot.jsonl", indices.slice(0, 30));
writeJsonl("candidates.jsonl", indices.slice(30, 400));

console.log("Questions:", dev.length);
console.log("Pilot:", 30);
console.log("Candidates:", 370);
console.log("Seed: 20261015");
console.log("Output:", path.resolve(outDir));