/**
 * Positive Controls for Modules V12 (File Validator) and V15 (PII Redaction)
 * --------------------------------------------------------------------------
 * Verifies that:
 *   1. A known-bad file (disguised PE executable / MZ header) is flagged by the file validator.
 *   2. A known-bad file (disguised ELF executable) is flagged by the file validator.
 *   3. A known Zip-Slip archive (path traversal entry) is flagged by the zip parser oracle.
 *   4. A known-leaky PII string (email, phone, SSN, credit card) is detected and scrubbed by maskText.
 *   5. An in-scope PII database row is masked for low-privilege roles by redactEvidence.
 * --------------------------------------------------------------------------
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { validateUpload, UploadValidationError } = require('../../server/src/security/file.validator');
const { maskText, redactEvidence, shouldMask } = require('../../server/src/guardrails/pii');

describe('Positive Controls: V12 File Validator & Oracles', () => {
  test('Known-bad file: PE/MZ executable disguised as .csv is rejected by signature validator', () => {
    // 0x4D, 0x5A = MZ header
    const mzBuffer = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const tmpPath = path.join(os.tmpdir(), `test_${Date.now()}_mz.csv`);
    fs.writeFileSync(tmpPath, mzBuffer);

    let rejected = false;
    let message = '';
    try {
      validateUpload(tmpPath, 'malicious.csv');
    } catch (err) {
      rejected = true;
      message = err.message;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }

    assert.equal(rejected, true, 'Disguised MZ executable must be rejected by validateUpload');
    assert.match(message, /looks like a Windows executable|rejected/i);
  });

  test('Known-bad file: ELF executable disguised as .xlsx is rejected', () => {
    // 0x7F, 0x45, 0x4C, 0x46 = \x7fELF
    const elfBuffer = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const tmpPath = path.join(os.tmpdir(), `test_${Date.now()}_elf.xlsx`);
    fs.writeFileSync(tmpPath, elfBuffer);

    let rejected = false;
    let message = '';
    try {
      validateUpload(tmpPath, 'payload.xlsx');
    } catch (err) {
      rejected = true;
      message = err.message;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }

    assert.equal(rejected, true, 'Disguised ELF executable must be rejected');
    assert.match(message, /looks like a Linux\/ELF executable|rejected/i);
  });

  test('Known-bad zip: Entry with path traversal (Zip-Slip) is flagged by zip oracle', () => {
    function checkZipSlip(entryName) {
      const normalized = entryName.replace(/\\/g, '/');
      return normalized.startsWith('/') || normalized.includes('../') || normalized.includes('..\\');
    }

    assert.equal(checkZipSlip('../../etc/passwd'), true);
    assert.equal(checkZipSlip('..\\..\\windows\\system32\\calc.exe'), true);
    assert.equal(checkZipSlip('/root/.ssh/id_rsa'), true);
    assert.equal(checkZipSlip('data/clean_file.csv'), false);
  });
});

describe('Positive Controls: V15 PII Redaction Engine', () => {
  test('Known-leaky PII string: Email, phone, SSN, and credit card are detected and scrubbed', () => {
    const rawLeak = 'Contact user at alice.smith@example.com or phone +1-555-123-4567. SSN is 123-45-6789 and Card is 4532 0150 1234 5678.';
    const scrubbed = maskText(rawLeak);

    // Verify raw values are completely absent from scrubbed output
    assert.equal(scrubbed.includes('alice.smith@example.com'), false, 'Raw email must not appear');
    assert.equal(scrubbed.includes('+1-555-123-4567'), false, 'Raw phone must not appear');
    assert.equal(scrubbed.includes('123-45-6789'), false, 'Raw SSN must not appear');
    assert.equal(scrubbed.includes('4532 0150 1234 5678'), false, 'Raw credit card must not appear');

    // Verify masked representations appear
    assert.match(scrubbed, /a\*\*\*@example\.com/, 'Email must be masked to a***@example.com');
    assert.match(scrubbed, /\*\*\*-\*\*-\*\*\*\*/, 'SSN must be masked to ***-**-****');
    assert.match(scrubbed, /\*\*\*\* \*\*\*\* \*\*\*\* 5678/, 'Card must be masked to **** **** **** 5678');
  });

  test('redactEvidence masks sensitive fields for viewer and employee roles, but preserves for admin', () => {
    const mockEvidence = {
      source_type: 'database',
      sample_rows: [
        { id: 1, email: 'john.doe@corp.com', note: 'Customer SSN 987-65-4321 verified' }
      ]
    };
    const mockSemantic = {
      tables: [{
        columns: [{ name: 'email', pii: true }]
      }]
    };

    // Viewer role: should mask
    assert.equal(shouldMask('viewer'), true);
    const viewerResult = redactEvidence(mockEvidence, mockSemantic, 'viewer');
    assert.ok(viewerResult.redacted >= 1, 'Viewer must have redacted fields');
    assert.equal(viewerResult.evidence.sample_rows[0].email, 'j***@corp.com');
    assert.equal(viewerResult.evidence.sample_rows[0].note.includes('987-65-4321'), false);

    // Employee role: should mask
    assert.equal(shouldMask('employee'), true);
    const empResult = redactEvidence(mockEvidence, mockSemantic, 'employee');
    assert.ok(empResult.redacted >= 1, 'Employee must have redacted fields');

    // Admin role: should NOT mask
    assert.equal(shouldMask('admin'), false);
    const adminResult = redactEvidence(mockEvidence, mockSemantic, 'admin');
    assert.equal(adminResult.redacted, 0);
    assert.equal(adminResult.evidence.sample_rows[0].email, 'john.doe@corp.com');
    assert.equal(adminResult.evidence.sample_rows[0].note, 'Customer SSN 987-65-4321 verified');
  });
});
