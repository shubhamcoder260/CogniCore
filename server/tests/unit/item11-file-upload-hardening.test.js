const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateUpload, sanitizeFilename } = require('../../src/security/file.validator');

describe('Item 11: File Upload Hardening (V12-01 / V12-02)', () => {
  const tmpDir = path.join(os.tmpdir(), 'item11_test_' + Date.now());

  test('beforeAll: create temp dir', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  test('Part 1: Content-based screening rejects disguised scripts independent of extension', () => {
    // 1. Shebang in disguised .csv
    const csvShebang = path.join(tmpDir, 'disguised_shebang.csv');
    fs.writeFileSync(csvShebang, '#!/bin/bash\nrm -rf /');
    assert.throws(() => validateUpload(csvShebang, 'disguised_shebang.csv'), /script|executable|rejected/i);

    // 2. PHP in disguised .json
    const jsonPhp = path.join(tmpDir, 'disguised_php.json');
    fs.writeFileSync(jsonPhp, '<?php phpinfo(); ?>');
    assert.throws(() => validateUpload(jsonPhp, 'disguised_php.json'), /PHP|script|rejected/i);

    // 3. HTML/script in disguised .csv
    const csvScript = path.join(tmpDir, 'disguised_script.csv');
    fs.writeFileSync(csvScript, '<script>alert(1)</script>');
    assert.throws(() => validateUpload(csvScript, 'disguised_script.csv'), /script|HTML|rejected/i);

    // 4. Windows PE executable in disguised .txt
    const txtExe = path.join(tmpDir, 'disguised_pe.txt');
    fs.writeFileSync(txtExe, Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00')]));
    assert.throws(() => validateUpload(txtExe, 'disguised_pe.txt'), /Windows executable|rejected/i);

    // 5. Linux ELF in disguised .md
    const mdElf = path.join(tmpDir, 'disguised_elf.md');
    fs.writeFileSync(mdElf, Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01])]));
    assert.throws(() => validateUpload(mdElf, 'disguised_elf.md'), /Linux executable|rejected/i);
  });

  test('Part 2: Magic-byte checks not limited to offset 0 (BOM / whitespace / null prefixes)', () => {
    // 1. UTF-8 BOM before MZ
    const bomMz = path.join(tmpDir, 'bom_mz.csv');
    fs.writeFileSync(bomMz, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('MZ\x90\x00\x03\x00\x00\x00')]));
    assert.throws(() => validateUpload(bomMz, 'bom_mz.csv'), /Windows executable|rejected/i);

    // 2. Leading whitespace before PHP
    const wsPhp = path.join(tmpDir, 'ws_php.csv');
    fs.writeFileSync(wsPhp, '   \t\r\n<?php echo "evil"; ?>');
    assert.throws(() => validateUpload(wsPhp, 'ws_php.csv'), /PHP|script|rejected/i);

    // 3. Leading whitespace before shebang
    const wsShebang = path.join(tmpDir, 'ws_shebang.csv');
    fs.writeFileSync(wsShebang, '   \n#!/bin/sh\necho evil');
    assert.throws(() => validateUpload(wsShebang, 'ws_shebang.csv'), /script|executable|rejected/i);

    // 4. Leading whitespace before script tag
    const wsScript = path.join(tmpDir, 'ws_script.csv');
    fs.writeFileSync(wsScript, '\r\n\t  <script>evil()</script>');
    assert.throws(() => validateUpload(wsScript, 'ws_script.csv'), /HTML|script|rejected/i);

    // 5. UTF-16LE BOM before ELF
    const bomElf = path.join(tmpDir, 'bom_elf.csv');
    fs.writeFileSync(bomElf, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from([0x7f, 0x45, 0x4c, 0x46])]));
    assert.throws(() => validateUpload(bomElf, 'bom_elf.csv'), /Linux executable|rejected/i);
  });

  test('Part 3: Path-traversal and control character sanitization in sanitizeFilename', () => {
    // 1. Unix directory traversal
    assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');

    // 2. Windows directory traversal
    assert.equal(sanitizeFilename('..\\..\\windows\\system32\\cmd.exe'), 'cmd.exe');

    // 3. Control characters
    assert.equal(sanitizeFilename('report\x00test\x1fname.csv'), 'report_test_name.csv');

    // 4. Leading dots
    assert.equal(sanitizeFilename('...hidden_file.csv'), 'hidden_file.csv');

    // 5. URL-encoded traversal
    assert.equal(sanitizeFilename('%2e%2e%2fevil.csv'), 'evil.csv');
  });

  test('Part 4: Valid analytical files with cell-embedded script tokens are accepted', () => {
    // A legitimate telemetry CSV containing a script tag inside a cell (row 2)
    const validCsv = path.join(tmpDir, 'valid_telemetry.csv');
    fs.writeFileSync(validCsv, 'id,note,agent\n1,"Requested <script>alert(1)</script> demo","Mozilla/5.0"\n');
    const res = validateUpload(validCsv, 'valid_telemetry.csv');
    assert.equal(res.kind, 'text');

    // A legitimate JSON with script command in field
    const validJson = path.join(tmpDir, 'valid_incident.json');
    fs.writeFileSync(validJson, JSON.stringify({ logs: [{ rule: 'xss', snippet: '<script>alert(1)</script>' }] }));
    const jsonRes = validateUpload(validJson, 'valid_incident.json');
    assert.equal(jsonRes.kind, 'text');
  });

  test('afterAll: clean up temp dir', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
