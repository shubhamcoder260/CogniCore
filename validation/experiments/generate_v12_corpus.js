/**
 * Deterministic Generator for Corpus V12 (File Validation Evaluation)
 * --------------------------------------------------------------------
 * Generates valid files, malicious files, and adversarial filenames
 * testing CogniCore's file upload security controls.
 * Uses MASTER_SEED + 1200 for all pseudo-random selections.
 * --------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const Database = require('../../server/node_modules/better-sqlite3');
const { MASTER_SEED } = require('../lib/config');

const V12_SEED = MASTER_SEED + 1200;

// Deterministic LCG PRNG
function createPrng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const prng = createPrng(V12_SEED);

const V12_DIR = path.resolve(__dirname, '../data/v12');
const FILES_DIR = path.join(V12_DIR, 'files');
fs.mkdirSync(FILES_DIR, { recursive: true });

function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Pure-JS ZIP Builder for valid and pathological zip structures.
 */
function buildZip(entries, options = {}) {
  const parts = [];
  const cdEntries = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
    const method = entry.method !== undefined ? entry.method : 0; // 0=store, 8=deflate
    let compData = dataBuf;
    if (method === 8) {
      compData = zlib.deflateRawSync(dataBuf);
    }
    const csize = entry.csize !== undefined ? entry.csize : compData.length;
    const usize = entry.usize !== undefined ? entry.usize : dataBuf.length;
    const lho = entry.lho !== undefined ? entry.lho : offset;

    // Local file header (30 bytes + name + compData)
    if (!options.skipLocalHeaders) {
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4);
      lh.writeUInt16LE(0, 6);
      lh.writeUInt16LE(method, 8);
      lh.writeUInt16LE(0, 10);
      lh.writeUInt16LE(0, 12);
      lh.writeUInt32LE(0, 14); // crc
      lh.writeUInt32LE(csize, 18);
      lh.writeUInt32LE(usize, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);
      parts.push(lh, nameBuf, compData);
    }

    // Central directory header (46 bytes + name)
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(0, 16);
    cd.writeUInt32LE(csize, 20);
    cd.writeUInt32LE(usize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(lho, 42);

    cdEntries.push(Buffer.concat([cd, nameBuf]));
    offset += 30 + nameBuf.length + compData.length;
  }

  const cdBuf = Buffer.concat(cdEntries);
  const totalEntries = options.totalEntries !== undefined ? options.totalEntries : entries.length;
  const cdOffset = options.cdOffset !== undefined ? options.cdOffset : offset;
  const cdSize = options.cdSize !== undefined ? options.cdSize : cdBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(totalEntries > 65535 ? 65535 : totalEntries, 8);
  eocd.writeUInt16LE(totalEntries > 65535 ? 65535 : totalEntries, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  if (options.corruptEocd) {
    return Buffer.concat([...parts, cdBuf]); // missing EOCD
  }

  return Buffer.concat([...parts, cdBuf, eocd]);
}

const corpusItems = [];
let itemCounter = 1;

function addItem({ category, subcategory, claimedFilename, fileRelPath, contentBuf, expectedDecision, description, provenance = 'agent-authored' }) {
  const safeBase = String(fileRelPath || claimedFilename || 'file').slice(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  const diskFilename = `v12_${String(itemCounter).padStart(4, '0')}_${safeBase || 'payload'}.bin`;
  const diskPath = path.join(FILES_DIR, diskFilename);
  fs.writeFileSync(diskPath, contentBuf);
  const hash = sha256Buf(contentBuf);

  corpusItems.push({
    id: `v12_${String(itemCounter).padStart(4, '0')}`,
    category,
    subcategory,
    claimed_filename: claimedFilename,
    disk_filename: diskFilename,
    size_bytes: contentBuf.length,
    sha256: hash,
    expected_decision: expectedDecision,
    description,
    provenance,
  });

  itemCounter++;
}

console.log('Generating Corpus V12...');

// =========================================================================
// 1. VALID FILES
// =========================================================================

// 1.1 XLSX (valid zip with xl/workbook.xml)
const validXlsxBuf = buildZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>' },
  { name: 'xl/worksheets/sheet1.xml', data: '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>' }
]);
addItem({
  category: 'valid',
  subcategory: 'valid_xlsx',
  claimedFilename: 'financial_report_2026.xlsx',
  contentBuf: validXlsxBuf,
  expectedDecision: 'accept',
  description: 'Standard valid Office OpenXML Excel workbook containing xl/workbook.xml'
});

// 1.2 DOCX (valid zip with word/document.xml)
const validDocxBuf = buildZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  { name: 'word/document.xml', data: '<?xml version="1.0" encoding="UTF-8"?><document xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>' }
]);
addItem({
  category: 'valid',
  subcategory: 'valid_docx',
  claimedFilename: 'project_brief.docx',
  contentBuf: validDocxBuf,
  expectedDecision: 'accept',
  description: 'Standard valid Word document containing word/document.xml'
});

// 1.3 PPTX (valid zip with ppt/presentation.xml)
const validPptxBuf = buildZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
  { name: 'ppt/presentation.xml', data: '<?xml version="1.0" encoding="UTF-8"?><presentation xmlns="http://schemas.openxmlformats.org/presentationml/2006/main"/>' }
]);
addItem({
  category: 'valid',
  subcategory: 'valid_pptx',
  claimedFilename: 'quarterly_deck.pptx',
  contentBuf: validPptxBuf,
  expectedDecision: 'accept',
  description: 'Standard valid PowerPoint presentation containing ppt/presentation.xml'
});

// 1.4 SQLite Database via better-sqlite3
const tempDbPath = path.join(FILES_DIR, '__temp_valid.db');
if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
const tmpDb = new Database(tempDbPath);
tmpDb.exec(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, balance REAL);
  INSERT INTO customers VALUES (1, 'Alice', 1250.50), (2, 'Bob', 450.00);
`);
tmpDb.close();
const validSqliteBuf = fs.readFileSync(tempDbPath);
fs.unlinkSync(tempDbPath);

addItem({
  category: 'valid',
  subcategory: 'valid_sqlite',
  claimedFilename: 'analytics_dump.sqlite',
  contentBuf: validSqliteBuf,
  expectedDecision: 'accept',
  description: 'Valid SQLite database with schema and rows created via better-sqlite3'
});

addItem({
  category: 'valid',
  subcategory: 'valid_sqlite',
  claimedFilename: 'analytics_dump.db',
  contentBuf: validSqliteBuf,
  expectedDecision: 'accept',
  description: 'Valid SQLite database with .db extension'
});

addItem({
  category: 'valid',
  subcategory: 'valid_sqlite',
  claimedFilename: 'analytics_dump.sqlite3',
  contentBuf: validSqliteBuf,
  expectedDecision: 'accept',
  description: 'Valid SQLite database with .sqlite3 extension'
});

// 1.5 CSV (sample data & synthetic)
const sampleCsvPath = path.resolve(__dirname, '../../sample-data/finance_expenses.csv');
const validCsvBuf = fs.readFileSync(sampleCsvPath);
addItem({
  category: 'valid',
  subcategory: 'valid_csv',
  claimedFilename: 'finance_expenses.csv',
  contentBuf: validCsvBuf,
  expectedDecision: 'accept',
  description: 'Valid CSV from production sample-data directory',
  provenance: 'sample-data:finance_expenses.csv'
});

// 1.6 JSON
const validJsonObjBuf = Buffer.from(JSON.stringify({ dataset: "sales", records: [{ id: 1, amount: 99.5 }, { id: 2, amount: 150.0 }] }, null, 2), 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_json',
  claimedFilename: 'sales_metrics.json',
  contentBuf: validJsonObjBuf,
  expectedDecision: 'accept',
  description: 'Valid JSON object payload'
});

const validJsonArrBuf = Buffer.from(JSON.stringify([{ id: 101, status: "active" }, { id: 102, status: "pending" }], null, 2), 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_json',
  claimedFilename: 'user_roster.json',
  contentBuf: validJsonArrBuf,
  expectedDecision: 'accept',
  description: 'Valid JSON array payload'
});

// 1.7 PDF
const validPdfBuf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\nxref\n0 3\n0000000000 65535 f \n0000000010 00000 n \n0000000060 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n115\n%%EOF\n', 'latin1');
addItem({
  category: 'valid',
  subcategory: 'valid_pdf',
  claimedFilename: 'audit_summary.pdf',
  contentBuf: validPdfBuf,
  expectedDecision: 'accept',
  description: 'Valid minimal PDF 1.4 document structure'
});

// 1.8 TXT & Markdown
const validTxtBuf = Buffer.from('CogniCore System Note\nAll analytical operations performed under read-only verification.\n', 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_txt',
  claimedFilename: 'readme_notes.txt',
  contentBuf: validTxtBuf,
  expectedDecision: 'accept',
  description: 'Valid plain UTF-8 text file'
});

const validMdBuf = Buffer.from('# Documentation\n\n- Point 1: Valid markdown\n- Point 2: Architecture\n', 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_md',
  claimedFilename: 'guide.md',
  contentBuf: validMdBuf,
  expectedDecision: 'accept',
  description: 'Valid UTF-8 markdown file'
});

// 1.9 Unicode filenames
addItem({
  category: 'valid',
  subcategory: 'valid_unicode',
  claimedFilename: 'données_財務_2026.csv',
  contentBuf: validCsvBuf,
  expectedDecision: 'accept',
  description: 'Valid CSV with French and CJK UTF-8 characters in filename'
});

addItem({
  category: 'valid',
  subcategory: 'valid_unicode',
  claimedFilename: 'résumé_équipe.xlsx',
  contentBuf: validXlsxBuf,
  expectedDecision: 'accept',
  description: 'Valid XLSX with accented Latin characters in filename'
});

addItem({
  category: 'valid',
  subcategory: 'valid_unicode',
  claimedFilename: 'данные_отчет.json',
  contentBuf: validJsonArrBuf,
  expectedDecision: 'accept',
  description: 'Valid JSON with Cyrillic characters in filename'
});

// 1.10 Boundary-size legit files (e.g. 5 MB CSV)
const largeCsvLines = ['id,timestamp,metric_val,status\n'];
for (let i = 0; i < 75000; i++) {
  largeCsvLines.push(`${i},2026-10-15T12:00:00Z,${(i * 1.5).toFixed(2)},OK\n`);
}
const largeCsvBuf = Buffer.from(largeCsvLines.join(''), 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_boundary_size',
  claimedFilename: 'telemetry_stream_large.csv',
  contentBuf: largeCsvBuf,
  expectedDecision: 'accept',
  description: `Legitimate large CSV file (${(largeCsvBuf.length / (1024 * 1024)).toFixed(2)} MB)`
});

// 1.11 CSV/JSON cells containing tokens like <script, #!, <?php, and MZ inside cell values
const cellTokenCsvBuf = Buffer.from(`id,payload_note,user_agent
1,"User asked for <script>alert(1)</script> demo","Mozilla/5.0"
2,"Server shebang starts with #!/bin/bash","curl/7.68.0"
3,"Legacy code contained <?php echo 'hi'; ?>","PostmanRuntime"
4,"MZ header observed in telemetry dump MZ90","Wireshark"
`, 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_cells_with_script_tokens',
  claimedFilename: 'security_telemetry.csv',
  contentBuf: cellTokenCsvBuf,
  expectedDecision: 'accept',
  description: 'Valid CSV file containing script/executable tokens inside cell data (offset > 0)'
});

const cellTokenJsonBuf = Buffer.from(JSON.stringify({
  logs: [
    { rule: "xss", snippet: "<script>alert('xss')</script>" },
    { rule: "shebang", command: "#!/usr/bin/env python3" },
    { rule: "php", snippet: "<?php phpinfo(); ?>" },
    { rule: "pe", pattern: "MZ executable indicator" }
  ]
}, null, 2), 'utf8');
addItem({
  category: 'valid',
  subcategory: 'valid_cells_with_script_tokens',
  claimedFilename: 'incident_reports.json',
  contentBuf: cellTokenJsonBuf,
  expectedDecision: 'accept',
  description: 'Valid JSON containing script/executable tokens inside string properties'
});

// 1.12 Legacy .xls with CFB header
const legacyXlsBuf = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(504) // standard CFB sector
]);
addItem({
  category: 'valid',
  subcategory: 'valid_xls',
  claimedFilename: 'legacy_sheets.xls',
  contentBuf: legacyXlsBuf,
  expectedDecision: 'accept',
  description: 'Valid legacy Excel compound file binary (D0CF11E0) spreadsheet'
});


// =========================================================================
// 2. MALICIOUS FILES: EXTENSION x CONTENT MATRIX
// =========================================================================

const ALLOWED_EXTS = ['.csv', '.txt', '.md', '.json', '.sqlite', '.db', '.pdf', '.xlsx', '.docx', '.pptx', '.xls'];

const CONTENT_PAYLOADS = [
  { name: 'pdf', buf: validPdfBuf, validExts: ['.pdf'] },
  { name: 'sqlite', buf: validSqliteBuf, validExts: ['.sqlite', '.db', '.sqlite3'] },
  { name: 'xlsx', buf: validXlsxBuf, validExts: ['.xlsx', '.xls'] },
  { name: 'docx', buf: validDocxBuf, validExts: ['.docx'] },
  { name: 'pptx', buf: validPptxBuf, validExts: ['.pptx'] },
  { name: 'csv_text', buf: validCsvBuf, validExts: ['.csv', '.txt', '.md'] },
  { name: 'json_text', buf: validJsonObjBuf, validExts: ['.json', '.txt', '.md'] },
  { name: 'pe_mz', buf: Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'latin1'), validExts: [] },
  { name: 'elf', buf: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), validExts: [] },
  { name: 'mach_o_cafebabe', buf: Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x02]), validExts: [] },
  { name: 'shebang', buf: Buffer.from('#!/bin/bash\necho "exploit"\n', 'utf8'), validExts: ['.txt', '.md'] },
  { name: 'php', buf: Buffer.from('<?php phpinfo(); ?>\n', 'utf8'), validExts: ['.txt', '.md'] },
  { name: 'html_script', buf: Buffer.from('<script>alert("pwned")</script>\n', 'utf8'), validExts: ['.txt', '.md'] },
  { name: 'png_binary', buf: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]), validExts: [] },
];

for (const ext of ALLOWED_EXTS) {
  for (const c of CONTENT_PAYLOADS) {
    if (c.validExts.includes(ext)) continue; // skip valid combinations
    addItem({
      category: 'malicious',
      subcategory: 'extension_content_mismatch',
      claimedFilename: `test_payload_${c.name}${ext}`,
      contentBuf: c.buf,
      expectedDecision: 'reject',
      description: `Disguised payload: content type ${c.name} with incompatible extension ${ext}`
    });
  }
}

// =========================================================================
// 3. EICAR STANDARD ANTI-VIRUS TEST STRING
// =========================================================================
const EICAR_STR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const eicarBuf = Buffer.from(EICAR_STR, 'utf8');

const EICAR_EXTS = ['.txt', '.csv', '.json', '.pdf', '.xlsx', '.db'];
for (const ext of EICAR_EXTS) {
  addItem({
    category: 'malicious',
    subcategory: 'eicar_string',
    claimedFilename: `eicar_standard_test${ext}`,
    contentBuf: eicarBuf,
    expectedDecision: 'reject',
    description: `Standard EICAR antivirus test file with extension ${ext}`
  });
}

// =========================================================================
// 4. OFFSET BYPASS: EXECUTABLE HEADERS POST BOM & WHITESPACE
// =========================================================================
const RAW_EXEC_HEADERS = [
  { name: 'mz_windows', buf: Buffer.from('MZ\x90\x00\x03\x00\x00\x00', 'latin1') },
  { name: 'elf_linux', buf: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x01]) },
  { name: 'cafebabe_macho', buf: Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x01]) },
  { name: 'shebang_script', buf: Buffer.from('#!/bin/sh\nrm -rf /', 'utf8') },
  { name: 'php_code', buf: Buffer.from('<?php system($_GET["c"]); ?>', 'utf8') },
  { name: 'html_script', buf: Buffer.from('<script>document.location="http://evil.com"</script>', 'utf8') }
];

const PREFIX_TRICKS = [
  { name: 'utf8_bom', prefix: Buffer.from([0xef, 0xbb, 0xbf]) },
  { name: 'utf16le_bom', prefix: Buffer.from([0xff, 0xfe]) },
  { name: 'leading_spaces', prefix: Buffer.from('    ', 'utf8') },
  { name: 'leading_tabs', prefix: Buffer.from('\t\t\t', 'utf8') },
  { name: 'leading_newlines', prefix: Buffer.from('\r\n\r\n', 'utf8') },
  { name: 'leading_nulls', prefix: Buffer.from([0x00, 0x00, 0x00, 0x00]) }
];

for (const hdr of RAW_EXEC_HEADERS) {
  for (const pfx of PREFIX_TRICKS) {
    addItem({
      category: 'malicious',
      subcategory: 'offset_signature_bypass',
      claimedFilename: `exec_${hdr.name}_with_${pfx.name}.csv`,
      contentBuf: Buffer.concat([pfx.prefix, hdr.buf]),
      expectedDecision: 'reject',
      description: `Executable signature ${hdr.name} obscured by ${pfx.name} prefix`
    });
  }
}

// =========================================================================
// 5. ZIP BOMBS & ARCHIVE VULNERABILITIES
// =========================================================================

// 5.1 High compression ratio (10MB zeros deflated to tiny)
const zeroBuf = Buffer.alloc(10 * 1024 * 1024, 0); // 10MB
const deflatedZero = zlib.deflateRawSync(zeroBuf);
const highRatioZipBuf = buildZip([
  { name: 'xl/workbook.xml', data: deflatedZero, method: 8, usize: 10 * 1024 * 1024, csize: deflatedZero.length }
]);
addItem({
  category: 'malicious',
  subcategory: 'zip_bomb_high_ratio',
  claimedFilename: 'high_ratio_bomb.xlsx',
  contentBuf: highRatioZipBuf,
  expectedDecision: 'reject',
  description: `Zip bomb with 10MB deflated to ${deflatedZero.length} bytes (high compression ratio)`
});

// 5.2 Declared uncompressed size exceeding 200MB limit (e.g. 250MB)
const declaredOversizeZipBuf = buildZip([
  { name: 'xl/workbook.xml', data: Buffer.from('<xml/>'), method: 0, usize: 250 * 1024 * 1024, csize: 7 }
]);
addItem({
  category: 'malicious',
  subcategory: 'zip_bomb_declared_size',
  claimedFilename: 'declared_250mb_bomb.xlsx',
  contentBuf: declaredOversizeZipBuf,
  expectedDecision: 'reject',
  description: 'ZIP central directory claims 250MB uncompressed size (exceeds 200MB limit)'
});

// 5.3 Excessive entry count (> 5000 entries)
const manyEntries = [];
for (let i = 0; i < 5005; i++) {
  manyEntries.push({ name: `xl/sheet_${i}.xml`, data: '', method: 0, usize: 0, csize: 0 });
}
const manyEntriesZipBuf = buildZip(manyEntries, { skipLocalHeaders: true, totalEntries: 5005 });
addItem({
  category: 'malicious',
  subcategory: 'zip_bomb_many_entries',
  claimedFilename: 'many_entries_5005.xlsx',
  contentBuf: manyEntriesZipBuf,
  expectedDecision: 'reject',
  description: 'ZIP archive containing 5,005 entries in central directory (exceeds 5000 entry limit)'
});

// 5.4 Overlapping entries (multiple entries pointing to identical local header offset)
const overlappingZipBuf = buildZip([
  { name: 'xl/workbook.xml', data: '<workbook/>', method: 0, lho: 0 },
  { name: 'xl/sheet1.xml', data: '', method: 0, lho: 0 } // overlapping offset 0
]);
addItem({
  category: 'malicious',
  subcategory: 'zip_bomb_overlapping',
  claimedFilename: 'overlapping_entries.xlsx',
  contentBuf: overlappingZipBuf,
  expectedDecision: 'reject',
  description: 'ZIP archive with overlapping central directory entry local header offsets'
});

// 5.5 Missing central directory (corrupted / truncated EOCD)
const corruptEocdZipBuf = buildZip([
  { name: 'xl/workbook.xml', data: '<workbook/>' }
], { corruptEocd: true });
addItem({
  category: 'malicious',
  subcategory: 'zip_corrupt_eocd',
  claimedFilename: 'missing_eocd.xlsx',
  contentBuf: corruptEocdZipBuf,
  expectedDecision: 'reject',
  description: 'ZIP file with truncated / missing end-of-central-directory record'
});

// 5.6 Nested ZIP
const nestedInnerZip = buildZip([{ name: 'inner.txt', data: 'nested' }]);
const nestedZipBuf = buildZip([
  { name: 'xl/workbook.xml', data: '<xml/>' },
  { name: 'xl/embedded.zip', data: nestedInnerZip }
]);
addItem({
  category: 'malicious',
  subcategory: 'zip_nested_archive',
  claimedFilename: 'nested_archive.xlsx',
  contentBuf: nestedZipBuf,
  expectedDecision: 'reject',
  description: 'Office XLSX file with embedded nested zip archive'
});

// 5.7 Zip64 locator / extra field simulation
const zip64Buf = Buffer.concat([
  validXlsxBuf,
  Buffer.from([0x50, 0x4b, 0x06, 0x06]), // ZIP64 EOCD signature
  Buffer.alloc(52)
]);
addItem({
  category: 'malicious',
  subcategory: 'zip64_archive',
  claimedFilename: 'zip64_archive.xlsx',
  contentBuf: zip64Buf,
  expectedDecision: 'reject',
  description: 'ZIP archive containing trailing Zip64 EOCD signature'
});


// =========================================================================
// 6. ZIP-SLIP PATH TRAVERSAL IN ARCHIVE ENTRIES
// =========================================================================
const ZIP_SLIP_ENTRIES = [
  { name: '../../evil.sh', desc: 'Dot-dot Unix traversal' },
  { name: '..\\..\\evil.bat', desc: 'Dot-dot Windows backslash traversal' },
  { name: '/etc/passwd', desc: 'Absolute root Unix path' },
  { name: 'C:\\Windows\\System32\\calc.exe', desc: 'Windows absolute drive path' },
  { name: 'xl/../../outside.txt', desc: 'Mid-path dot-dot escape from xl/' },
  { name: '....//....//escape.txt', desc: 'Double slash dot-dot evasion' },
  { name: 'xl/..\\..\\windows.ini', desc: 'Mixed slash traversal' },
  { name: 'D:\\cognicore\\leak.txt', desc: 'Alternative drive letter' },
];

for (const zs of ZIP_SLIP_ENTRIES) {
  const slipZip = buildZip([
    { name: 'xl/workbook.xml', data: '<workbook/>' },
    { name: zs.name, data: 'MALICIOUS_PAYLOAD' }
  ]);
  addItem({
    category: 'malicious',
    subcategory: 'zip_slip',
    claimedFilename: `zip_slip_${path.basename(zs.name.replace(/[^a-zA-Z0-9]/g, '_'))}.xlsx`,
    contentBuf: slipZip,
    expectedDecision: 'reject',
    description: `Zip-Slip entry: ${zs.desc} (${zs.name})`
  });
}


// =========================================================================
// 7. POLYGLOTS & EMBEDDED DUAL-FORMAT PAYLOADS
// =========================================================================

// 7.1 GIF / JavaScript polyglot
const gifJsPolyglot = Buffer.from('GIF89a/*=1; alert("XSS polyglot"); /*', 'utf8');
addItem({
  category: 'malicious',
  subcategory: 'polyglot',
  claimedFilename: 'avatar_image.csv',
  contentBuf: gifJsPolyglot,
  expectedDecision: 'reject',
  description: 'GIF89a / JavaScript comment polyglot disguised as CSV'
});

// 7.2 PDF / HTML polyglot
const pdfHtmlPolyglot = Buffer.concat([
  validPdfBuf,
  Buffer.from('\n<html><body><script>alert("PDF-HTML Polyglot")</script></body></html>\n', 'utf8')
]);
addItem({
  category: 'malicious',
  subcategory: 'polyglot',
  claimedFilename: 'invoice_polyglot.pdf',
  contentBuf: pdfHtmlPolyglot,
  expectedDecision: 'reject',
  description: 'PDF file with trailing HTML/JavaScript script tag payload'
});

// 7.3 SQLite with trailing PHP script
const sqlitePhpPolyglot = Buffer.concat([
  validSqliteBuf,
  Buffer.from('\n<?php echo shell_exec($_GET["cmd"]); ?>\n', 'utf8')
]);
addItem({
  category: 'malicious',
  subcategory: 'polyglot',
  claimedFilename: 'embedded_script.sqlite',
  contentBuf: sqlitePhpPolyglot,
  expectedDecision: 'reject',
  description: 'SQLite database with trailing PHP webshell payload'
});

// 7.4 ZIP / JAR executable polyglot
const zipJarPolyglot = buildZip([
  { name: 'xl/workbook.xml', data: '<workbook/>' },
  { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\nMain-Class: Exploit\n' },
  { name: 'Exploit.class', data: Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34]) }
]);
addItem({
  category: 'malicious',
  subcategory: 'polyglot',
  claimedFilename: 'report_executable.xlsx',
  contentBuf: zipJarPolyglot,
  expectedDecision: 'reject',
  description: 'Valid XLSX archive with embedded Java JAR executable manifest and bytecode'
});


// =========================================================================
// 8. SQLITE ENGINE ATTACKS: TRIGGERS, VIEWS, VIRTUAL TABLES
// =========================================================================

// 8.1 SQLite with Triggers
const trigDbPath = path.join(FILES_DIR, '__temp_trigger.db');
if (fs.existsSync(trigDbPath)) fs.unlinkSync(trigDbPath);
const trigDb = new Database(trigDbPath);
trigDb.exec(`
  CREATE TABLE sensitive_data (id INT, secret TEXT);
  CREATE TABLE audit_log (id INT, msg TEXT);
  CREATE TRIGGER exfiltrate_trig AFTER INSERT ON sensitive_data
  BEGIN
    INSERT INTO audit_log VALUES (NEW.id, 'Trigger fired: ' || NEW.secret);
  END;
`);
trigDb.close();
const trigDbBuf = fs.readFileSync(trigDbPath);
fs.unlinkSync(trigDbPath);

addItem({
  category: 'malicious',
  subcategory: 'sqlite_trigger',
  claimedFilename: 'trigger_payload.sqlite',
  contentBuf: trigDbBuf,
  expectedDecision: 'reject',
  description: 'SQLite database file containing active DML trigger'
});

// 8.2 SQLite with Views
const viewDbPath = path.join(FILES_DIR, '__temp_view.db');
if (fs.existsSync(viewDbPath)) fs.unlinkSync(viewDbPath);
const viewDb = new Database(viewDbPath);
viewDb.exec(`
  CREATE TABLE base_table (x INT, y TEXT);
  CREATE VIEW privileged_view AS SELECT x, y, 'SECRET_KEY_EXPOSURE' AS leaked FROM base_table;
`);
viewDb.close();
const viewDbBuf = fs.readFileSync(viewDbPath);
fs.unlinkSync(viewDbPath);

addItem({
  category: 'malicious',
  subcategory: 'sqlite_view',
  claimedFilename: 'view_payload.sqlite',
  contentBuf: viewDbBuf,
  expectedDecision: 'reject',
  description: 'SQLite database file containing stored SQL VIEW'
});

// 8.3 SQLite with Virtual Tables (FTS5)
const ftsDbPath = path.join(FILES_DIR, '__temp_fts.db');
if (fs.existsSync(ftsDbPath)) fs.unlinkSync(ftsDbPath);
const ftsDb = new Database(ftsDbPath);
ftsDb.exec(`
  CREATE VIRTUAL TABLE fts_corpus USING fts5(content, tokenize='porter');
  INSERT INTO fts_corpus VALUES ('Full text search record');
`);
ftsDb.close();
const ftsDbBuf = fs.readFileSync(ftsDbPath);
fs.unlinkSync(ftsDbPath);

addItem({
  category: 'malicious',
  subcategory: 'sqlite_virtual_table',
  claimedFilename: 'fts_virtual_table.sqlite',
  contentBuf: ftsDbBuf,
  expectedDecision: 'reject',
  description: 'SQLite database containing FTS5 virtual table extension'
});


// =========================================================================
// 9. JSON & CSV EXPLOITS: BOM, UTF-16, DEPTH BOMBS, FORMULA INJECTION
// =========================================================================

// 9.1 JSON Depth Bomb (1,000 nested brackets)
let depthBomb = '';
for (let i = 0; i < 1000; i++) depthBomb += '[';
depthBomb += '1';
for (let i = 0; i < 1000; i++) depthBomb += ']';
addItem({
  category: 'malicious',
  subcategory: 'json_depth_bomb',
  claimedFilename: 'nested_depth_bomb.json',
  contentBuf: Buffer.from(depthBomb, 'utf8'),
  expectedDecision: 'reject',
  description: 'JSON document nested 1,000 arrays deep (stack exhaustion)'
});

// 9.2 JSON with UTF-8 BOM
const jsonWithBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"key": "value"}', 'utf8')]);
addItem({
  category: 'malicious',
  subcategory: 'json_bom',
  claimedFilename: 'bom_prefixed.json',
  contentBuf: jsonWithBom,
  expectedDecision: 'reject',
  description: 'JSON payload with leading UTF-8 BOM bytes (testing /^[\\\[{]/ regex)'
});

// 9.3 JSON in UTF-16 LE
const jsonUtf16Le = Buffer.from('{"utf16": "payload"}', 'utf16le');
addItem({
  category: 'malicious',
  subcategory: 'json_utf16',
  claimedFilename: 'unicode_utf16le.json',
  contentBuf: jsonUtf16Le,
  expectedDecision: 'reject',
  description: 'JSON payload encoded in UTF-16 LE (null bytes in head)'
});

// 9.4 CSV containing embedded NUL bytes (binary detection)
const csvWithNulls = Buffer.concat([
  Buffer.from('id,name,role\n1,Alice,Engineer\n2,Bo', 'utf8'),
  Buffer.from([0x00]),
  Buffer.from('b,Admin\n', 'utf8')
]);
addItem({
  category: 'malicious',
  subcategory: 'csv_null_bytes',
  claimedFilename: 'null_byte_embedded.csv',
  contentBuf: csvWithNulls,
  expectedDecision: 'reject',
  description: 'CSV file containing embedded NUL byte 0x00'
});

// 9.5 CSV with Formula Injection (DDE / CSV Injection)
const csvFormulaInjection = Buffer.from(`id,formula_payload,comment
1,"=cmd|' /C calc'!A0","DDE exec"
2,"@SUM(1+1)*cmd|' /C calc'!A0","At formula exec"
3,"-2+3+cmd|' /C calc'!A0","Minus formula exec"
4,"+cmd|' /C notepad'!A0","Plus formula exec"
`, 'utf8');
addItem({
  category: 'malicious',
  subcategory: 'csv_formula_injection',
  claimedFilename: 'spreadsheet_formulas.csv',
  contentBuf: csvFormulaInjection,
  expectedDecision: 'reject',
  description: 'CSV document containing Excel DDE command execution formulas'
});

// 9.6 CSV with 1,000 columns (denial of service)
const thousandCols = Array.from({ length: 1000 }, (_, i) => `col_${i}`).join(',') + '\n' +
  Array.from({ length: 1000 }, (_, i) => `${i}`).join(',') + '\n';
addItem({
  category: 'malicious',
  subcategory: 'csv_excessive_columns',
  claimedFilename: 'thousand_columns.csv',
  contentBuf: Buffer.from(thousandCols, 'utf8'),
  expectedDecision: 'reject',
  description: 'CSV file with 1,000 horizontal columns'
});


// =========================================================================
// 10. 500 SEEDED TRUNCATIONS AND BIT-FLIPS OF VALID FILES
// =========================================================================
const BASE_VALID_BUFS = [
  { ext: '.xlsx', buf: validXlsxBuf },
  { ext: '.docx', buf: validDocxBuf },
  { ext: '.pptx', buf: validPptxBuf },
  { ext: '.sqlite', buf: validSqliteBuf },
  { ext: '.pdf', buf: validPdfBuf },
  { ext: '.csv', buf: validCsvBuf },
  { ext: '.json', buf: validJsonObjBuf },
];

for (let i = 0; i < 500; i++) {
  const baseObj = BASE_VALID_BUFS[i % BASE_VALID_BUFS.length];
  const origBuf = baseObj.buf;
  const isTruncation = i < 250;

  let mutatedBuf;
  let mutDesc;

  if (isTruncation) {
    // Truncate at deterministic lengths: 1, 2, 4, 8, 16, 22, 50, or fraction
    const truncLen = Math.max(1, Math.floor(prng() * Math.min(origBuf.length - 1, 512)));
    mutatedBuf = origBuf.subarray(0, truncLen);
    mutDesc = `Truncation to ${truncLen} bytes`;
  } else {
    // Bit flip at deterministic positions
    mutatedBuf = Buffer.from(origBuf);
    const numFlips = 1 + Math.floor(prng() * 4);
    for (let f = 0; f < numFlips; f++) {
      const pos = Math.floor(prng() * Math.min(mutatedBuf.length, 1024));
      const bit = 1 << Math.floor(prng() * 8);
      mutatedBuf[pos] ^= bit;
    }
    mutDesc = `Bit-flip corruption (${numFlips} bits flipped within first 1KB)`;
  }

  addItem({
    category: 'malicious',
    subcategory: isTruncation ? 'seeded_truncation' : 'seeded_bit_flip',
    claimedFilename: `fuzz_${String(i).padStart(3, '0')}${baseObj.ext}`,
    contentBuf: mutatedBuf,
    expectedDecision: 'reject',
    description: `Seeded ${mutDesc} of valid ${baseObj.ext} file`,
    provenance: `mutation-of:${baseObj.ext}:seed_${V12_SEED}`
  });
}


// =========================================================================
// 11. MALICIOUS / ADVERSARIAL FILENAMES MATRIX
// =========================================================================
const FILENAME_CASES = [
  // Path traversal
  { name: '../data.csv', desc: 'Single dot-dot Unix traversal' },
  { name: '..\\data.csv', desc: 'Single dot-dot Windows backslash traversal' },
  { name: '../../etc/passwd.csv', desc: 'Nested dot-dot Unix traversal' },
  { name: '..\\..\\windows\\system.ini.csv', desc: 'Nested dot-dot Windows traversal' },
  { name: '%2e%2e%2fdata.csv', desc: 'URL single-encoded dot-dot traversal' },
  { name: '%252e%252e%252fdata.csv', desc: 'URL double-encoded dot-dot traversal' },
  // Unicode dot leaders
  { name: '‥/data.csv', desc: 'Unicode two-dot leader (U+2025) traversal' },
  { name: '。/data.csv', desc: 'CJK fullwidth dot traversal' },
  // NUL byte poisoning
  { name: 'data.csv\x00.exe', desc: 'Embedded NUL byte extension spoofing' },
  { name: 'data.csv\x00', desc: 'Trailing NUL byte' },
  // Windows reserved device names
  { name: 'CON.csv', desc: 'Windows reserved device name CON' },
  { name: 'NUL.csv', desc: 'Windows reserved device name NUL' },
  { name: 'COM1.csv', desc: 'Windows reserved device name COM1' },
  { name: 'LPT1.csv', desc: 'Windows reserved device name LPT1' },
  { name: 'AUX.csv', desc: 'Windows reserved device name AUX' },
  { name: 'PRN.csv', desc: 'Windows reserved device name PRN' },
  { name: 'CON', desc: 'Windows reserved device name without extension' },
  { name: 'NUL', desc: 'Windows reserved device name NUL without extension' },
  // Trailing dots and spaces (NTFS stripping vulnerabilities)
  { name: 'data.csv...', desc: 'Filename with multiple trailing dots' },
  { name: 'data.csv   ', desc: 'Filename with multiple trailing spaces' },
  { name: 'data.csv. . .', desc: 'Filename with alternating trailing dots and spaces' },
  // NTFS Alternate Data Streams (ADS)
  { name: 'file.csv:stream', desc: 'NTFS alternate data stream payload' },
  { name: 'file.csv::$DATA', desc: 'NTFS explicit ::$DATA stream specification' },
  // 255+ characters (buffer overflow / path limit)
  { name: 'a'.repeat(260) + '.csv', desc: 'Filename exceeding 255 characters (264 chars)' },
  // Right-to-Left Override (RTLO)
  { name: 'report_\u202Ecod.csv', desc: 'Right-to-Left Override character spoofing' },
  // Edge-case empties and punctuation
  { name: '', desc: 'Empty filename string' },
  { name: '   ', desc: 'Whitespace-only filename' },
  { name: '.', desc: 'Single dot filename' },
  { name: '..', desc: 'Double dot filename' },
  { name: '.csv', desc: 'Extension-only filename (.csv)' },
  { name: '.xlsx', desc: 'Extension-only filename (.xlsx)' },
  // Double extensions
  { name: 'report.php.csv', desc: 'Double extension with executable middle token (.php.csv)' },
  { name: 'report.csv.exe', desc: 'Double extension trailing executable (.csv.exe)' },
  { name: 'payload.exe.xlsx', desc: 'Double extension leading executable (.exe.xlsx)' },
  // Case variants
  { name: 'analytics.CSV', desc: 'Uppercase .CSV extension' },
  { name: 'model_weights.Sqlite', desc: 'Mixed-case .Sqlite extension' },
  { name: 'workbook.xLsX', desc: 'Mixed-case .xLsX extension' },
];

for (const fn of FILENAME_CASES) {
  addItem({
    category: 'filename',
    subcategory: 'filename_sanitization',
    claimedFilename: fn.name,
    contentBuf: validCsvBuf,
    expectedDecision: fn.name.toLowerCase().endsWith('.csv') || fn.name.toLowerCase().endsWith('.xlsx') || fn.name.toLowerCase().endsWith('.sqlite') ? 'sanitize_and_accept' : 'reject',
    description: `Filename security check: ${fn.desc} (${JSON.stringify(fn.name)})`
  });
}

// =========================================================================
// WRITE OUTPUT MANIFEST & JSONL
// =========================================================================

const jsonlPath = path.join(V12_DIR, 'v12_files.jsonl');
const lines = corpusItems.map(item => JSON.stringify(item));
fs.writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf8');

const finalHash = crypto.createHash('sha256').update(fs.readFileSync(jsonlPath)).digest('hex');

console.log(`\n======================================================`);
console.log(`Corpus V12 generation complete!`);
console.log(`Total generated items: ${corpusItems.length}`);
console.log(`JSONL File: ${jsonlPath}`);
console.log(`SHA-256 Checksum: ${finalHash}`);
console.log(`======================================================\n`);

const catCounts = {};
for (const it of corpusItems) {
  catCounts[it.category] = (catCounts[it.category] || 0) + 1;
}
console.log('Breakdown by Category:');
for (const [k, v] of Object.entries(catCounts)) {
  console.log(`  - ${k}: ${v} items`);
}
