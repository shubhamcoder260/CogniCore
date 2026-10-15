/**
 * Deterministic Generator for Corpus V15 (PII Redaction & Scope Verification)
 * ---------------------------------------------------------------------------
 * Generates structured test suite spanning:
 *   1. Emails (standard, plus-addressing, subdomains, uppercase, obfuscated)
 *   2. Phones (US, +91 India, international, spaces/dashes/parens, extensions)
 *   3. SSNs (valid hyphenated, unhyphenated, space-separated, dot-separated)
 *   4. Credit Cards (Luhn-valid Visa/MC/Amex spaced/dashed/raw, Luhn-invalid)
 *   5. Aadhaar (spaced 4-4-4, unspaced 12-digit, dashed) [Out of scope gap]
 *   6. PAN (Indian permanent account numbers) [Out of scope gap]
 *   7. Person Names (Western, Indian, international names) [Out of scope gap]
 *   8. Benign Numbers (order IDs, 16-digit tracking IDs, dates, currency amounts)
 *
 * Embedded across 4 embedding formats:
 *   - sentence (free text)
 *   - csv_cell (single cell value)
 *   - json_field (JSON key-value payload)
 *   - table_row (structured database row dictionary)
 *
 * Random seed: MASTER_SEED + 1500 (deterministic PRNG)
 * ---------------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MASTER_SEED } = require('../lib/config');

const V15_SEED = MASTER_SEED + 1500;

function createPrng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const prng = createPrng(V15_SEED);

function choice(arr) {
  return arr[Math.floor(prng() * arr.length)];
}

function randInt(min, max) {
  return min + Math.floor(prng() * (max - min + 1));
}

function luhnCheck(numStr) {
  const digits = numStr.replace(/\D/g, '').split('').map(Number);
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits[i];
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return (sum % 10) === 0;
}

function generateLuhnNumber(prefix, length) {
  let num = prefix;
  while (num.length < length - 1) {
    num += String(randInt(0, 9));
  }
  // calculate check digit
  for (let d = 0; d <= 9; d++) {
    if (luhnCheck(num + String(d))) {
      return num + String(d);
    }
  }
  return num + '0';
}

function generateLuhnInvalid(prefix, length) {
  const valid = generateLuhnNumber(prefix, length);
  const lastDigit = Number(valid.slice(-1));
  const newLastDigit = (lastDigit + 1) % 10;
  const invalid = valid.slice(0, -1) + String(newLastDigit);
  if (luhnCheck(invalid)) {
    // If somehow still valid, flip by 2
    return valid.slice(0, -1) + String((lastDigit + 2) % 10);
  }
  return invalid;
}

const V15_DIR = path.resolve(__dirname, '../data/v15');
fs.mkdirSync(V15_DIR, { recursive: true });

const corpusItems = [];
let itemCounter = 1;

function addItem({ category, subtype, inScope, expectedPii, piiValue, luhnValid = null, format, text, rowContext }) {
  corpusItems.push({
    id: `v15_${String(itemCounter++).padStart(4, '0')}`,
    category,
    subtype,
    in_scope: inScope,
    expected_pii: expectedPii,
    pii_value: piiValue,
    luhn_valid: luhnValid,
    format,
    text,
    row_context: rowContext
  });
}

function wrapValue(val, category, subtype, inScope, expectedPii, luhnValid = null) {
  const formats = ['sentence', 'csv_cell', 'json_field', 'table_row'];
  const fmt = choice(formats);

  let text;
  let rowContext;

  switch (fmt) {
    case 'sentence': {
      const templates = [
        `Please contact the customer at ${val} regarding case #8492.`,
        `The primary identifier for this record was recorded as ${val}.`,
        `Account verification completed with credential ${val}.`,
        `Notice: do not share ${val} outside authorized personnel.`,
        `Audit record updated for subject with value ${val} on system.`,
      ];
      text = choice(templates);
      rowContext = { id: randInt(100, 999), detail: text, note: `Recorded ${val}` };
      break;
    }
    case 'csv_cell': {
      text = String(val);
      rowContext = { id: randInt(100, 999), [category]: val, status: 'active' };
      break;
    }
    case 'json_field': {
      const obj = { record_id: randInt(1000, 9999), payload: val, timestamp: '2026-10-15T12:00:00Z' };
      text = JSON.stringify(obj);
      rowContext = { id: obj.record_id, data: text };
      break;
    }
    case 'table_row': {
      text = `Row: [${val}, "verified", 100]`;
      rowContext = { id: randInt(1000, 9999), value_field: val, verified: true };
      break;
    }
  }

  addItem({
    category,
    subtype,
    inScope,
    expectedPii,
    piiValue: val,
    luhnValid,
    format: fmt,
    text,
    rowContext
  });
}

// -------------------------------------------------------------
// 1. EMAILS (100 items: 25 standard, 25 plus, 25 subdomains, 15 uppercase, 10 obfuscated)
// -------------------------------------------------------------
const FIRST_NAMES = ['alice', 'bob', 'carol', 'david', 'elena', 'frank', 'grace', 'harold', 'irene', 'james'];
const LAST_NAMES = ['smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis', 'martinez', 'taylor'];
const DOMAINS = ['example.com', 'testcorp.org', 'acme-holdings.net', 'globalfinance.io', 'techgroup.co.uk'];

for (let i = 0; i < 25; i++) {
  const email = `${choice(FIRST_NAMES)}.${choice(LAST_NAMES)}@${choice(DOMAINS)}`;
  wrapValue(email, 'email', 'standard', true, true);
}

for (let i = 0; i < 25; i++) {
  const tag = choice(['newsletter', 'billing', 'audit2026', 'alerts', 'support', 'temp']);
  const email = `${choice(FIRST_NAMES)}+${tag}@${choice(DOMAINS)}`;
  wrapValue(email, 'email', 'plus_addressing', true, true);
}

for (let i = 0; i < 25; i++) {
  const sub = choice(['sales.emea', 'corp.internal', 'dev.cloud', 'payments.secure', 'api.prod']);
  const email = `${choice(FIRST_NAMES)}@${sub}.${choice(DOMAINS)}`;
  wrapValue(email, 'email', 'subdomain', true, true);
}

for (let i = 0; i < 15; i++) {
  const email = `${choice(FIRST_NAMES).toUpperCase()}.${choice(LAST_NAMES).toUpperCase()}@${choice(DOMAINS).toUpperCase()}`;
  wrapValue(email, 'email', 'uppercase', true, true);
}

for (let i = 0; i < 10; i++) {
  const fn = choice(FIRST_NAMES);
  const ln = choice(LAST_NAMES);
  const dom = choice(DOMAINS).replace('.', ' dot ');
  const email = `${fn}.${ln} at ${dom}`;
  wrapValue(email, 'email', 'obfuscated', true, true);
}

// -------------------------------------------------------------
// 2. PHONES (100 items: 25 US, 25 +91 India, 20 intl, 15 parens/spaces, 15 extensions)
// -------------------------------------------------------------
for (let i = 0; i < 25; i++) {
  const phone = `+1-${randInt(200, 999)}-${randInt(100, 999)}-${randInt(1000, 9999)}`;
  wrapValue(phone, 'phone', 'us_standard', true, true);
}

for (let i = 0; i < 25; i++) {
  const sep = choice([' ', '-']);
  const phone = `+91${sep}${randInt(70000, 99999)}${sep}${randInt(10000, 99999)}`;
  wrapValue(phone, 'phone', 'india_91', true, true);
}

for (let i = 0; i < 20; i++) {
  const intlPrefix = choice(['+44 20', '+49 30', '+33 1', '+61 2', '+81 3']);
  const phone = `${intlPrefix} ${randInt(1000, 9999)} ${randInt(1000, 9999)}`;
  wrapValue(phone, 'phone', 'international', true, true);
}

for (let i = 0; i < 15; i++) {
  const phone = `(${randInt(200, 999)}) ${randInt(100, 999)}-${randInt(1000, 9999)}`;
  wrapValue(phone, 'phone', 'us_parentheses', true, true);
}

for (let i = 0; i < 15; i++) {
  const ext = randInt(100, 9999);
  const phone = `+1-800-${randInt(100, 999)}-${randInt(1000, 9999)} ext ${ext}`;
  wrapValue(phone, 'phone', 'extension', true, true);
}

// -------------------------------------------------------------
// 3. SSNs (80 items: 40 valid hyphenated, 15 unhyphenated, 15 space, 10 dot)
// -------------------------------------------------------------
for (let i = 0; i < 40; i++) {
  const ssn = `${String(randInt(100, 899)).padStart(3, '0')}-${String(randInt(10, 99)).padStart(2, '0')}-${String(randInt(1000, 9999)).padStart(4, '0')}`;
  wrapValue(ssn, 'ssn', 'valid_hyphenated', true, true);
}

for (let i = 0; i < 15; i++) {
  const ssn = `${String(randInt(100, 899)).padStart(3, '0')}${String(randInt(10, 99)).padStart(2, '0')}${String(randInt(1000, 9999)).padStart(4, '0')}`;
  wrapValue(ssn, 'ssn', 'unhyphenated', true, true);
}

for (let i = 0; i < 15; i++) {
  const ssn = `${String(randInt(100, 899)).padStart(3, '0')} ${String(randInt(10, 99)).padStart(2, '0')} ${String(randInt(1000, 9999)).padStart(4, '0')}`;
  wrapValue(ssn, 'ssn', 'space_separated', true, true);
}

for (let i = 0; i < 10; i++) {
  const ssn = `${String(randInt(100, 899)).padStart(3, '0')}.${String(randInt(10, 99)).padStart(2, '0')}.${String(randInt(1000, 9999)).padStart(4, '0')}`;
  wrapValue(ssn, 'ssn', 'dot_separated', true, true);
}

// -------------------------------------------------------------
// 4. CREDIT CARDS (100 items: 50 Luhn-valid, 50 Luhn-invalid look-alikes)
// -------------------------------------------------------------
// Visa (16 digits starting with 4)
for (let i = 0; i < 20; i++) {
  const raw = generateLuhnNumber('4', 16);
  const formatted = choice([
    raw,
    `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8, 12)} ${raw.slice(12, 16)}`,
    `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
  ]);
  wrapValue(formatted, 'credit_card', 'visa_luhn_valid', true, true, true);
}

// Mastercard (16 digits starting with 51-55)
for (let i = 0; i < 15; i++) {
  const prefix = String(randInt(51, 55));
  const raw = generateLuhnNumber(prefix, 16);
  const formatted = choice([
    raw,
    `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8, 12)} ${raw.slice(12, 16)}`,
    `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`
  ]);
  wrapValue(formatted, 'credit_card', 'mastercard_luhn_valid', true, true, true);
}

// Amex (15 digits starting with 34 or 37)
for (let i = 0; i < 15; i++) {
  const prefix = choice(['34', '37']);
  const raw = generateLuhnNumber(prefix, 15);
  const formatted = choice([
    raw,
    `${raw.slice(0, 4)} ${raw.slice(4, 10)} ${raw.slice(10, 15)}`,
    `${raw.slice(0, 4)}-${raw.slice(4, 10)}-${raw.slice(10, 15)}`
  ]);
  wrapValue(formatted, 'credit_card', 'amex_luhn_valid', true, true, true);
}

// Luhn-invalid look-alikes (50 items)
for (let i = 0; i < 50; i++) {
  const brand = choice(['visa', 'mc', 'amex']);
  let raw;
  if (brand === 'visa') raw = generateLuhnInvalid('4', 16);
  else if (brand === 'mc') raw = generateLuhnInvalid(String(randInt(51, 55)), 16);
  else raw = generateLuhnInvalid(choice(['34', '37']), 15);

  const formatted = choice([
    raw,
    raw.length === 16 ? `${raw.slice(0, 4)} ${raw.slice(4, 8)} ${raw.slice(8, 12)} ${raw.slice(12, 16)}` : `${raw.slice(0, 4)} ${raw.slice(4, 10)} ${raw.slice(10, 15)}`,
    raw.length === 16 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}` : `${raw.slice(0, 4)}-${raw.slice(4, 10)}-${raw.slice(10, 15)}`
  ]);
  wrapValue(formatted, 'credit_card', 'luhn_invalid_lookalike', true, true, false);
}

// -------------------------------------------------------------
// 5. AADHAAR (40 items: 15 spaced 4-4-4, 15 unspaced 12-digit, 10 dashed) [SCOPE GAP]
// -------------------------------------------------------------
for (let i = 0; i < 15; i++) {
  const aadhaar = `${randInt(2000, 9999)} ${randInt(1000, 9999)} ${randInt(1000, 9999)}`;
  wrapValue(aadhaar, 'aadhaar', 'spaced_4_4_4', false, true);
}

for (let i = 0; i < 15; i++) {
  const aadhaar = `${randInt(2000, 9999)}${randInt(1000, 9999)}${randInt(1000, 9999)}`;
  wrapValue(aadhaar, 'aadhaar', 'unspaced_12_digit', false, true);
}

for (let i = 0; i < 10; i++) {
  const aadhaar = `${randInt(2000, 9999)}-${randInt(1000, 9999)}-${randInt(1000, 9999)}`;
  wrapValue(aadhaar, 'aadhaar', 'dashed_4_4_4', false, true);
}

// -------------------------------------------------------------
// 6. PAN (30 items: 5 uppercase letters + 4 digits + 1 uppercase letter) [SCOPE GAP]
// -------------------------------------------------------------
const ALPHAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
for (let i = 0; i < 30; i++) {
  let pan = '';
  for (let j = 0; j < 5; j++) pan += ALPHAS[randInt(0, 25)];
  pan += String(randInt(1000, 9999));
  pan += ALPHAS[randInt(0, 25)];
  wrapValue(pan, 'pan', 'indian_pan', false, true);
}

// -------------------------------------------------------------
// 7. PERSON NAMES (50 items) [SCOPE GAP]
// -------------------------------------------------------------
const FULL_NAMES = [
  'Alexander Hamilton', 'Priya Ramanathan', 'Dr. Rajesh Sharma', 'Sarah O\'Connor',
  'Jean-Luc Picard', 'Amina Al-Mansoor', 'Carlos Hernandez', 'Mei-Ling Zhou',
  'Prof. Emily Dickinson', 'Dmitri Ivanov', 'Fatima Zahra', 'Kwame Nkrumah',
  'Ingrid Bergman', 'Kenji Sato', 'Siddharth Mukherjee', 'Elena Rostova',
  'Guillermo del Toro', 'Aarav Patel', 'Chioma Okonjo', 'Hannah Arendt'
];

for (let i = 0; i < 50; i++) {
  const name = FULL_NAMES[i % FULL_NAMES.length] + (i >= FULL_NAMES.length ? ` ${i}` : '');
  wrapValue(name, 'name', 'person_name', false, true);
}

// -------------------------------------------------------------
// 8. BENIGN NUMBERS & IDENTIFIERS (120 items for precision measurement)
// -------------------------------------------------------------
// Order IDs
for (let i = 0; i < 30; i++) {
  const orderId = `ORD-${randInt(100000, 999999)}`;
  wrapValue(orderId, 'benign', 'order_id', false, false);
}

// 16-digit tracking IDs / Epoch timestamps (looks like card digit count)
for (let i = 0; i < 30; i++) {
  let trackingId = '';
  for (let j = 0; j < 16; j++) trackingId += String(randInt(0, 9));
  wrapValue(trackingId, 'benign', 'digit_16_tracking', false, false);
}

// Dates
for (let i = 0; i < 30; i++) {
  const year = randInt(2020, 2026);
  const month = String(randInt(1, 12)).padStart(2, '0');
  const day = String(randInt(1, 28)).padStart(2, '0');
  const dateStr = choice([`${year}-${month}-${day}`, `${day}/${month}/${year}`, `${month}.${day}.${year}`]);
  wrapValue(dateStr, 'benign', 'date_string', false, false);
}

// Currency Amounts
for (let i = 0; i < 30; i++) {
  const amount = choice([
    `$${randInt(10, 999)},${randInt(100, 999)}.${randInt(10, 99)}`,
    `EUR ${randInt(100, 9999)}.${randInt(10, 99)}`,
    `INR ${randInt(10, 99)},${randInt(10, 99)},${randInt(100, 999)}`
  ]);
  wrapValue(amount, 'benign', 'currency_amount', false, false);
}

// -------------------------------------------------------------
// Write corpus file and compute SHA-256
// -------------------------------------------------------------
const corpusPath = path.resolve(V15_DIR, 'v15_pii.jsonl');
const lines = corpusItems.map(item => JSON.stringify(item)).join('\n') + '\n';
fs.writeFileSync(corpusPath, lines, 'utf8');

const hash = crypto.createHash('sha256').update(lines).digest('hex');

console.log(`Corpus V15 generated:`);
console.log(`- Total items: ${corpusItems.length}`);
console.log(`- Path: ${corpusPath}`);
console.log(`- SHA-256: ${hash}`);

// Category breakdown
const breakdown = {};
for (const item of corpusItems) {
  const k = `${item.category} (${item.in_scope ? 'in-scope' : 'out-of-scope'})`;
  breakdown[k] = (breakdown[k] || 0) + 1;
}
console.log('\nBreakdown:');
for (const [k, v] of Object.entries(breakdown)) {
  console.log(`  ${k}: ${v}`);
}
