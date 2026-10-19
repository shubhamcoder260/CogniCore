/**
 * FILE-CONTENT VALIDATION (blueprint #17)
 * The extension is only a claim. Before a single byte is parsed we check that the CONTENT matches
 * it (magic bytes / structure), reject disguised executables and archives, and cap the size of
 * zip-based formats against zip bombs. Fails closed: unknown content is refused.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { readZipEntries } = require('../documents/zip.reader');

class UploadValidationError extends Error { constructor(m) { super(m); this.name = 'UploadValidationError'; this.status = 400; } }

const ZIP_BASED = { '.xlsx': 'xl/', '.docx': 'word/', '.pptx': 'ppt/' };
const TEXT_EXT = new Set(['.csv', '.txt', '.md', '.markdown', '.json']);
const BLOCKED_SIGNATURES = [
  [Buffer.from('MZ'), 'a Windows executable', true],
  [Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'a Linux executable', true],
  [Buffer.from('#!'), 'a script', false],
  [Buffer.from([0xca, 0xfe, 0xba, 0xbe]), 'a compiled program', true],
  [Buffer.from('<?php'), 'PHP code', false],
  [Buffer.from('<script', 'utf8'), 'HTML/JavaScript', false],
  [Buffer.from('GIF87a'), 'a GIF image', true],
  [Buffer.from('GIF89a'), 'a GIF image', true],
];

function readHead(file, n = 8192) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { fs.closeSync(fd); }
}

function readTail(file, n = 8192) {
  const stat = fs.statSync(file);
  if (stat.size <= n) return readHead(file, n);
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(n);
    const r = fs.readSync(fd, b, 0, n, stat.size - n);
    return b.subarray(0, r);
  } finally {
    fs.closeSync(fd);
  }
}

function looksLikeText(head) {
  if (head.includes(0)) return false;                       // NUL byte => binary
  const s = head.toString('utf8');
  const bad = (s.match(/\uFFFD/g) || []).length;           // replacement chars => not UTF-8 text
  return bad / Math.max(s.length, 1) < 0.02;
}

function stripLeadingWhitespaceAndBOM(head) {
  let off = 0;
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) off = 3;
  else if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) off = 2;
  else if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) off = 2;
  while (off < head.length && (head[off] === 0 || head[off] === 0x20 || head[off] === 0x09 || head[off] === 0x0d || head[off] === 0x0a)) {
    off++;
  }
  return head.subarray(off);
}

function sanitizeFilename(name) {
  let clean = String(name || 'upload');
  try { clean = decodeURIComponent(clean); } catch (_) {}
  try { clean = decodeURIComponent(clean); } catch (_) {}
  clean = path.basename(clean);
  clean = clean.replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]+/g, '_');
  clean = clean.replace(/^\.+/, '');
  clean = clean.replace(/[\.\s]+$/, '');
  return clean.slice(0, 150) || 'upload';
}

function parseCsv(str) {
  const lines = [];
  let cur = [''];
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < str.length && str[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else inQuotes = false;
      } else cur[cur.length - 1] += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') cur.push('');
      else if (ch === '\r') { if (str[i + 1] === '\n') i++; lines.push(cur); cur = ['']; }
      else if (ch === '\n') { lines.push(cur); cur = ['']; }
      else cur[cur.length - 1] += ch;
    }
  }
  if (inQuotes) throw new UploadValidationError('CSV has unclosed quotes.');
  if (cur.length > 1 || cur[0] !== '') lines.push(cur);
  return lines;
}

/** Throws UploadValidationError; returns { ext, kind } when the content matches the extension. */
function validateUpload(filePath, originalName) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  const stat = fs.statSync(filePath);
  if (stat.size === 0) throw new UploadValidationError('The uploaded file is empty.');
  const head = readHead(filePath);

  if (head.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))) {
    throw new UploadValidationError('This file contains an antivirus test string and was rejected.');
  }

  // Binary executables and scripts are refused regardless of extension or leading BOM / whitespace / null offsets
  const cleanHead = stripLeadingWhitespaceAndBOM(head);
  for (const [sig, what, always] of BLOCKED_SIGNATURES) {
    if (!cleanHead.subarray(0, sig.length).equals(sig)) continue;
    if (always || !['.txt', '.md', '.markdown'].includes(ext)) {
      throw new UploadValidationError(`This file looks like ${what}, not a data file, and was rejected.`);
    }
  }

  if (ext === '.pdf') {
    if (!head.subarray(0, 1024).toString('latin1').includes('%PDF-')) {
      throw new UploadValidationError('This file is named .pdf but its content is not a PDF.');
    }
    const tail = readTail(filePath, 1024).toString('latin1');
    if (stat.size > 200 && !tail.includes('%%EOF')) {
      throw new UploadValidationError('Truncated PDF: missing %%EOF marker.');
    }
    const full = head.toString('latin1') + tail;
    if (full.toLowerCase().includes('<script')) throw new UploadValidationError('PDF contains embedded script tag polyglot.');
    return { ext, kind: 'pdf' };
  }

  if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    if (head.length < 16 || head.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') {
      throw new UploadValidationError('This file is named like a SQLite database but its content is not a SQLite database.');
    }
    const tail = readTail(filePath, 8192);
    const full = head.toString('latin1') + tail.toString('latin1');
    if (full.includes('<?php') || full.toLowerCase().includes('<script') || full.includes('#!/')) {
      throw new UploadValidationError('SQLite database contains disguised script polyglot.');
    }
    if (full.includes('CREATE TRIGGER') || full.includes('CREATE VIEW') || full.includes('VIRTUAL TABLE')) {
      throw new UploadValidationError('SQLite database contains disallowed triggers, views, or virtual tables.');
    }
    if (stat.size >= 512) {
      const pageSize = head.readUInt16BE(16) === 1 ? 65536 : head.readUInt16BE(16);
      if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0 || stat.size % pageSize !== 0) {
        throw new UploadValidationError('Truncated or corrupted SQLite database: invalid page size or boundary.');
      }
      const dbPages = head.readUInt32BE(28);
      if (dbPages > 0 && stat.size < dbPages * pageSize) {
        throw new UploadValidationError('Truncated SQLite database: file size is less than declared page count.');
      }
    }
    return { ext, kind: 'sqlite' };
  }

  if (ZIP_BASED[ext]) {
    if (head.readUInt32LE(0) !== 0x04034b50) throw new UploadValidationError(`This file is named ${ext} but is not a valid Office file.`);
    const buf = fs.readFileSync(filePath);
    let zip;
    try {
      zip = readZipEntries(buf);
    } catch (e) {
      throw new UploadValidationError(`Invalid or unsafe ${ext} file: ${e.message}`);
    }
    if (!zip.names.some((n) => n.startsWith(ZIP_BASED[ext]))) {
      throw new UploadValidationError(`This file is a ZIP archive but not a real ${ext} document.`);
    }
    return { ext, kind: 'office' };
  }

  if (ext === '.xls') {
    const isCfb = head.length >= 8 && head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
    const isZip = head.length >= 4 && head.readUInt32LE(0) === 0x04034b50;
    if (!isCfb && !isZip) throw new UploadValidationError('This file is named .xls but is not a spreadsheet.');
    if (isZip) {
      const zip = readZipEntries(fs.readFileSync(filePath));
      if (!zip.names.some(n => n.startsWith('xl/'))) {
        throw new UploadValidationError('This file is named .xls but contains a different Office document.');
      }
    }
    return { ext, kind: 'office' };
  }

  if (TEXT_EXT.has(ext)) {
    if (!looksLikeText(head)) throw new UploadValidationError(`This file is named ${ext} but its content is binary, not text.`);
    if (cleanHead.toString('latin1').startsWith('%PDF-')) {
      throw new UploadValidationError(`This file is named ${ext} but its content is a PDF document.`);
    }
    const buf = fs.readFileSync(filePath);
    const str = buf.toString('utf8');

    if (ext === '.json') {
      if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
        throw new UploadValidationError('JSON files with UTF-8 BOM are not allowed.');
      }
      const t = cleanHead.toString('utf8');
      if (!/^[\[{]/.test(t)) throw new UploadValidationError('This file is named .json but does not start like JSON.');
      let depth = 0, maxDepth = 0;
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '{' || str[i] === '[') { depth++; if (depth > maxDepth) maxDepth = depth; }
        else if (str[i] === '}' || str[i] === ']') depth--;
      }
      if (maxDepth > 50) throw new UploadValidationError('JSON nesting depth exceeds maximum allowable limit (depth bomb defense).');
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed) || (parsed && Array.isArray(parsed.records))) {
          const arr = Array.isArray(parsed) ? parsed : parsed.records;
          if (arr.length > 1 && arr.every(x => x && typeof x === 'object')) {
            const k0 = Object.keys(arr[0]).sort().join(',');
            for (let i = 1; i < arr.length; i++) {
              if (Object.keys(arr[i]).sort().join(',') !== k0) throw new Error('Inconsistent schema keys');
            }
          }
        }
      } catch (e) {
        throw new UploadValidationError(`Invalid JSON syntax: ${e.message}`);
      }
      return { ext, kind: 'text' };
    }

    if (ext === '.csv') {
      if (cleanHead.toString('utf8').startsWith('{') || cleanHead.toString('utf8').startsWith('[')) {
        throw new UploadValidationError('This file is named .csv but contains JSON data.');
      }
      if (/[=+\-@|%]\s*[a-zA-Z0-9_]+\|/m.test(str) || /[=+\-@]\s*(cmd|dde|powershell)/im.test(str)) {
        throw new UploadValidationError('CSV contains dangerous DDE formula injection commands.');
      }
      if (/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(str)) {
        throw new UploadValidationError('CSV file contains forbidden binary control characters.');
      }
      if (!str.endsWith('\n')) {
        throw new UploadValidationError('CSV file is truncated (missing terminal newline).');
      }
      const rows = parseCsv(str);
      if (rows.length < 2) {
        throw new UploadValidationError('CSV must contain a header row and at least one data row.');
      }
      const cols = rows[0].length;
      if (cols < 1 || cols > 500) {
        throw new UploadValidationError('CSV column count must be between 1 and 500.');
      }
      for (let r = 1; r < rows.length; r++) {
        if (rows[r].length !== cols) {
          throw new UploadValidationError(`CSV row ${r + 1} has ${rows[r].length} columns; expected ${cols}.`);
        }
      }
      return { ext, kind: 'text' };
    }

    return { ext, kind: 'text' };
  }

  throw new UploadValidationError(`Unsupported file type "${ext || '(none)'}". Supported: CSV, Excel, JSON, SQLite, PDF, Word, PowerPoint, TXT, Markdown.`);
}

module.exports = { validateUpload, sanitizeFilename, UploadValidationError, looksLikeText };
