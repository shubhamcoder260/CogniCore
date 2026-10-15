# V12 Code Facts: File Validation, Zip Handling, Filename Sanitization, and Upload Route

This document records the exact codebase facts, line numbers, and verbatim quotes for CogniCore's file upload security controls: `server/src/security/file.validator.js`, `server/src/documents/zip.reader.js`, and `server/src/api/routes/upload.js`.

---

## 1. Magic Signatures and Blocked Executable Signatures

### File: `server/src/security/file.validator.js`
- **Lines 14-21**: `BLOCKED_SIGNATURES` table:
```javascript
const BLOCKED_SIGNATURES = [
  [Buffer.from('MZ'), 'a Windows executable', true],
  [Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'a Linux executable', true],
  [Buffer.from('#!'), 'a script'],
  [Buffer.from([0xca, 0xfe, 0xba, 0xbe]), 'a compiled program', true],
  [Buffer.from('<?php'), 'PHP code'],
  [Buffer.from('<script', 'utf8'), 'HTML/JavaScript'],
];
```
- **Lines 23-26**: Head reader buffer size:
```javascript
function readHead(file, n = 8192) {
  const fd = fs.openSync(file, 'r');
  try { const b = Buffer.alloc(n); const r = fs.readSync(fd, b, 0, n, 0); return b.subarray(0, r); } finally { fs.closeSync(fd); }
}
```
- **Lines 48-51**: Signature matching logic:
```javascript
  for (const [sig, what, always] of BLOCKED_SIGNATURES) {
    if (!head.subarray(0, sig.length).equals(sig)) continue;
    if (always || !['.txt', '.md', '.markdown'].includes(ext)) throw new UploadValidationError(`This file looks like ${what}, not a data file, and was rejected.`);
  }
```
*Note on Blocked Signatures*:
Signatures with `always === true` (`MZ`, ELF `0x7f454c46`, CAFEBABE `0xcafe_babe`) are refused across all extensions. Signatures with `always === undefined` (`#!`, `<?php`, `<script`) are rejected unless the extension is `.txt`, `.md`, or `.markdown`. Notice that matching is performed strictly at offset 0 (`head.subarray(0, sig.length)`).

---

## 2. Format-Specific Magic Signatures and Structural Checks

### File: `server/src/security/file.validator.js`
- **Lines 12-13**: Supported format sets:
```javascript
const ZIP_BASED = { '.xlsx': 'xl/', '.docx': 'word/', '.pptx': 'ppt/' };
const TEXT_EXT = new Set(['.csv', '.txt', '.md', '.markdown', '.json']);
```
- **Line 43**: Empty file check:
```javascript
if (stat.size === 0) throw new UploadValidationError('The uploaded file is empty.');
```
- **Lines 53-56**: PDF format verification:
```javascript
  if (ext === '.pdf') {
    if (!head.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw new UploadValidationError('This file is named .pdf but its content is not a PDF.');
    return { ext, kind: 'pdf' };
  }
```
- **Lines 57-60**: SQLite database verification:
```javascript
  if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
    if (head.subarray(0, 16).toString('latin1') !== 'SQLite format 3\u0000') throw new UploadValidationError('This file is named like a SQLite database but its content is not a SQLite database.');
    return { ext, kind: 'sqlite' };
  }
```
- **Lines 61-67**: ZIP-based Office document verification:
```javascript
  if (ZIP_BASED[ext]) {
    if (head.readUInt32LE(0) !== 0x04034b50) throw new UploadValidationError(`This file is named ${ext} but is not a valid Office file.`);
    let zip;
    try { zip = require('../documents/zip.reader').readZipEntries(fs.readFileSync(filePath)); } catch (e) { throw new UploadValidationError(`Invalid or unsafe ${ext} file: ${e.message}`); }
    if (!zip.names.some((n) => n.startsWith(ZIP_BASED[ext]))) throw new UploadValidationError(`This file is a ZIP archive but not a real ${ext} document.`);
    return { ext, kind: 'office' };
  }
```
- **Lines 68-71**: Legacy Excel (.xls) verification:
```javascript
  if (ext === '.xls') {
    if (!(head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) || head.readUInt32LE(0) === 0x04034b50)) throw new UploadValidationError('This file is named .xls but is not a spreadsheet.');
    return { ext, kind: 'office' };
  }
```
- **Lines 28-33 & 72-79**: Text, CSV, and JSON validation:
```javascript
function looksLikeText(head) {
  if (head.includes(0)) return false;                       // NUL byte => binary
  const s = head.toString('utf8');
  const bad = (s.match(/\uFFFD/g) || []).length;           // replacement chars => not UTF-8 text
  return bad / Math.max(s.length, 1) < 0.02;
}

  if (TEXT_EXT.has(ext)) {
    if (!looksLikeText(head)) throw new UploadValidationError(`This file is named ${ext} but its content is binary, not text.`);
    if (ext === '.json') {
      const t = head.toString('utf8').trimStart();
      if (!/^[\[{]/.test(t)) throw new UploadValidationError('This file is named .json but does not start like JSON.');
    }
    return { ext, kind: 'text' };
  }
```
- **Lines 80-81**: Fails closed on unsupported extensions:
```javascript
throw new UploadValidationError(`Unsupported file type "${ext || '(none)'}". Supported: CSV, Excel, JSON, SQLite, PDF, Word, PowerPoint, TXT, Markdown.`);
```

---

## 3. ZIP Archive Limits and Ratio Defense

### File: `server/src/documents/zip.reader.js`
- **Lines 7-8**: Function signature, entry limit (5,000), and uncompressed size ceiling (200 MB):
```javascript
function readZipEntries(buf, { maxEntries = 5000, maxUncompressed = 200 * 1024 * 1024 } = {}) {
  if (buf.length < 22) throw new Error('Not a valid ZIP file.');
```
- **Lines 9-14**: End of Central Directory (EOCD) search and entry count guard:
```javascript
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid ZIP file (no central directory).');
  const total = buf.readUInt16LE(eocd + 10);
  if (total > maxEntries) throw new Error('ZIP has too many entries.');
```
- **Lines 15-29**: Central directory parsing, entry header verification (`0x02014b50`), and cumulative uncompressed size cap:
```javascript
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let uncompressedTotal = 0;
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28), elen = buf.readUInt16LE(off + 30), clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nlen);
    uncompressedTotal += usize;
    if (uncompressedTotal > maxUncompressed) throw new Error('ZIP expands beyond the allowed size (possible zip bomb).');
    entries.set(name, { method, csize, usize, lho });
    off += 46 + nlen + elen + clen;
  }
```

---

## 4. Filename Sanitization and Upload Route Call Site

### File: `server/src/security/file.validator.js`
- **Lines 35-37**: Sanitizer implementation:
```javascript
function sanitizeFilename(name) {
  return path.basename(String(name || 'upload')).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').slice(0, 150) || 'upload';
}
```

### File: `server/src/api/routes/upload.js`
- **Lines 17-28**: Multer storage configuration and upload size limit:
```javascript
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.paths.uploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSizeMb * 1024 * 1024 },
});
```
- **Lines 30-47**: Route handler, middleware chain, validation call site, rollback on validation failure, and ingestion call:
```javascript
// POST /api/upload  (multipart/form-data, field name: "file")
router.post('/', requireAuth, requireCapability('upload'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'No file uploaded. Use multipart field name "file".' });
  }

  // Content must match the claimed type BEFORE anything parses it (blueprint #17).
  try { validateUpload(req.file.path, req.file.originalname); } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    AuthRegistry.appendAudit({ userId: req.user.user_id, action: 'dataset.upload', success: false, details: { reason: err.message, name: sanitizeFilename(req.file.originalname) } });
    return res.status(err.status || 400).json({ error: true, message: err.message });
  }

  const dataset = await ingestFile({
    filePath: req.file.path,
    originalFilename: sanitizeFilename(req.file.originalname),
    ownerId: req.user.user_id,
  });
```
