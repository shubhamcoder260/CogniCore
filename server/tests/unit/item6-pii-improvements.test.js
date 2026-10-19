const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { classifyColumn, splitColumnName } = require('../../src/semantic/semantic.classifier');
const { maskText, passesLuhn } = require('../../src/guardrails/pii');

describe('Item 6: PII camelCase Column Matching & Luhn Verification', () => {
  test('Part 1: splitColumnName and detectPii for camelCase/PascalCase', () => {
    assert.equal(typeof splitColumnName, 'function', 'splitColumnName must be exported');

    // Positive matches: camelCase and PascalCase
    const phone1 = classifyColumn({ name: 'phoneNumber', sqlType: 'TEXT', samples: ['123', '456', '789'] });
    assert.equal(phone1.pii, 'phone', 'phoneNumber must be flagged as phone');

    const phone2 = classifyColumn({ name: 'homePhone', sqlType: 'TEXT', samples: ['123', '456', '789'] });
    assert.equal(phone2.pii, 'phone', 'homePhone must be flagged as phone');

    const phone3 = classifyColumn({ name: 'mobileNo', sqlType: 'TEXT', samples: ['123', '456', '789'] });
    assert.equal(phone3.pii, 'phone', 'mobileNo must be flagged as phone');

    const email1 = classifyColumn({ name: 'emailAddress', sqlType: 'TEXT', samples: ['a', 'b', 'c'] });
    assert.equal(email1.pii, 'email', 'emailAddress must be flagged as email');

    // Negative matches: substrings that must NOT flag
    const hotel1 = classifyColumn({ name: 'hotel', sqlType: 'TEXT', samples: ['Grand', 'Plaza', 'Hilton'] });
    assert.equal(hotel1.pii, null, 'hotel must NOT be flagged as phone');

    const hotel2 = classifyColumn({ name: 'HotelName', sqlType: 'TEXT', samples: ['Grand', 'Plaza', 'Hilton'] });
    assert.equal(hotel2.pii, null, 'HotelName must NOT be flagged as phone');
  });

  test('Part 2: passesLuhn correctly verifies card checksums', () => {
    assert.equal(typeof passesLuhn, 'function', 'passesLuhn must be exported from pii.js');

    // Valid card numbers
    assert.equal(passesLuhn('4532015112830366'), true, 'Valid Visa must pass Luhn');
    assert.equal(passesLuhn('5439-0792-7278-9177'), true, 'Valid Mastercard must pass Luhn');
    assert.equal(passesLuhn('378282246310005'), true, 'Valid Amex must pass Luhn');

    // Invalid / corrupted numbers
    assert.equal(passesLuhn('4532015112830367'), false, 'Corrupted Visa must fail Luhn');
    assert.equal(passesLuhn('8943713436960511'), false, '16-digit tracking ID must fail Luhn');
    assert.equal(passesLuhn('0383726236148078'), false, '16-digit audit record must fail Luhn');
    assert.equal(passesLuhn('12345'), false, 'Short number must fail Luhn');
  });

  test('Part 3: maskText masks credit cards but preserves non-card tracking IDs', () => {
    // Valid card masked
    const maskedCard = maskText('Customer card 4532015112830366 was charged');
    assert.match(maskedCard, /\*\*\*\* \*\*\*\* \*\*\*\* 0366/);

    // Non-card 16-digit tracking number preserved (not falsely masked)
    const trackingText = 'Audit record updated for subject with value 8943713436960511 on system.';
    const maskedTracking = maskText(trackingText);
    assert.equal(maskedTracking, trackingText, 'Non-card tracking ID must NOT be falsely masked');

    const auditRow = 'Row: [0383726236148078, "verified", 100]';
    assert.equal(maskText(auditRow), auditRow, 'Non-card audit code must NOT be falsely masked');
  });
});
