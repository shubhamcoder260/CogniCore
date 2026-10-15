'use strict';

const { toCsvBuffer, toXlsxBuffer } = require('../../server/src/tools/export.tool');
const { buildPdfReport } = require('../../server/src/tools/report.tool');

const seededRows = [
  {
    id: 1,
    name: 'Alice Johnson',
    email: 'alice.johnson@example.com',
    phone: '+1-555-123-4567',
    ssn: '123-45-6789',
    card: '4111-2222-3333-4444'
  }
];

const resultObj = {
  columns: ['id', 'name', 'email', 'phone', 'ssn', 'card'],
  rows: seededRows,
  rowCount: 1,
  truncated: false
};

// 1. CSV
const csvBuf = toCsvBuffer(resultObj);
const csvStr = csvBuf.toString('utf8');

// 2. XLSX
const xlsxBuf = toXlsxBuffer(resultObj, 'TestExport');
const xlsxStr = xlsxBuf.toString('latin1'); // contains strings in zip xml

// 3. PDF
async function testPdf() {
  const pdfBuf = await buildPdfReport({
    title: 'PII Test Report',
    columns: resultObj.columns,
    rows: resultObj.rows
  });
  const pdfStr = pdfBuf.toString('latin1');

  console.log('=== D3 PII EXPORT VERIFICATION ===');
  console.log('CSV contains email:', csvStr.includes('alice.johnson@example.com'));
  console.log('CSV contains phone:', csvStr.includes('+1-555-123-4567'));
  console.log('CSV contains SSN:', csvStr.includes('123-45-6789'));
  console.log('CSV contains card:', csvStr.includes('4111-2222-3333-4444'));

  console.log('XLSX contains email:', xlsxStr.includes('alice.johnson@example.com'));
  console.log('XLSX contains phone:', xlsxStr.includes('+1-555-123-4567'));
  console.log('XLSX contains SSN:', xlsxStr.includes('123-45-6789'));
  console.log('XLSX contains card:', xlsxStr.includes('4111-2222-3333-4444'));

  console.log('PDF contains email:', pdfStr.includes('alice.johnson@example.com'));
  console.log('PDF contains phone:', pdfStr.includes('+1-555-123-4567'));
  console.log('PDF contains SSN:', pdfStr.includes('123-45-6789'));
  console.log('PDF contains card:', pdfStr.includes('4111-2222-3333-4444'));

  // Runtime trace of redactEvidence
  let redactEvidenceCalled = false;
  const piiModule = require('../../server/src/guardrails/pii');
  const orig = piiModule.redactEvidence;
  piiModule.redactEvidence = function(...args) {
    redactEvidenceCalled = true;
    return orig.apply(this, args);
  };

  // Simulate calling export tool
  toCsvBuffer(resultObj);
  toXlsxBuffer(resultObj, 'Test');
  await buildPdfReport({ title: 'T', columns: resultObj.columns, rows: resultObj.rows });

  console.log('Was redactEvidence invoked during export/report?', redactEvidenceCalled);
  redactor.redactEvidence = orig;
}

testPdf();
