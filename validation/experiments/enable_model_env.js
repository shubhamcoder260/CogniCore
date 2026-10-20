const fs = require('fs');
let c = fs.readFileSync('validation/lib/ollama_wrapper.js', 'utf8');
c = c.replace(
  "const DEFAULT_MODEL = 'qwen2.5-coder:7b';",
  "const DEFAULT_MODEL = process.env.OLLAMA_MODEL || process.env.SPIDER_MODEL || 'qwen2.5-coder:7b';"
);
fs.writeFileSync('validation/lib/ollama_wrapper.js', c, 'utf8');
console.log('Successfully updated ollama_wrapper.js to support process.env.OLLAMA_MODEL');
