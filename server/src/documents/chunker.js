const config = require('../config/env');
const { splitBySection } = require('./sections');

/**
 * CHUNKER
 * Splits each page's text into overlapping chunks sized for embedding.
 * Prefers to break on paragraph/sentence boundaries rather than mid-word.
 */
function chunkPages(pages, { maxChars = config.documents.chunkMaxChars, overlapChars = config.documents.chunkOverlapChars } = {}) {
  if (!Array.isArray(pages)) return [];
  const chunks = [];
  let chunkIndex = 0;

  for (const page of pages) {
    if (!page || typeof page.text !== 'string') continue;
    // Structure-aware: chunk inside each detected section so a chunk never straddles two headings,
    // and every chunk remembers its section title for evidence ("Section 2.1 Revenue Review, page 4").
    for (const block of splitBySection(page.text)) {
      for (const text of chunkText(block.text, { maxChars, overlapChars })) {
        if (!text.trim()) continue;
        chunks.push({
          chunkIndex: chunkIndex++,
          pageNumber: page.pageNumber ?? null,
          section: block.section ?? null,
          text: text.trim(),
        });
      }
    }
  }
  return chunks;
}

function chunkText(text, { maxChars = config.documents.chunkMaxChars, overlapChars = config.documents.chunkOverlapChars } = {}) {
  const safeMax = Math.max(50, Number(maxChars) || config.documents.chunkMaxChars);
  const safeOverlap = Math.max(0, Math.min(Number(overlapChars) || 0, Math.floor(safeMax / 2)));

  if (text.length <= safeMax) return [text];

  const chunks = [];
  const paragraphs = text.split(/\n\s*\n/);

  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= safeMax) {
      current = current ? current + '\n\n' + para : para;
      continue;
    }

    if (current) chunks.push(current);

    if (para.length > safeMax) {
      // Paragraph itself is too long - hard-split with overlap.
      let start = 0;
      while (start < para.length) {
        const end = Math.min(start + safeMax, para.length);
        chunks.push(para.slice(start, end));
        if (end === para.length) break;
        const nextStart = end - safeOverlap;
        start = nextStart > start ? nextStart : start + 1;
      }
      current = '';
    } else {
      // Carry forward overlap from the end of the previous chunk if available
      if (current && safeOverlap > 0) {
        const overlapSeed = current.slice(-safeOverlap).trim();
        current = overlapSeed ? `${overlapSeed}\n\n${para}` : para;
        if (current.length > safeMax) current = para;
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

module.exports = { chunkPages, chunkText };
