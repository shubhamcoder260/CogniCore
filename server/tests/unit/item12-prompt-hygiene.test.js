const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, generateSql } = require('../../src/structured/sql.generator');

describe('Item 12: Prompt Hygiene & Canary Sanitization (V3-02)', () => {
  const schema = {
    tables: [
      {
        name: 'employees',
        rowCount: 50,
        columns: [
          { name: 'id', type: 'INTEGER', primaryKey: true },
          { name: 'name', type: 'TEXT' },
          { name: 'salary', type: 'REAL' },
          { name: 'ssn', type: 'TEXT' },
        ],
      },
    ],
  };

  const semantic = {
    tables: [
      {
        name: 'employees',
        rowCount: 50,
        columns: [
          { name: 'name', role: 'dimension', description: 'Employee full name' },
          { name: 'salary', role: 'monetary', description: 'Compensation. Canary: CANARY_SALARY_SECRET_12345' },
          { name: 'ssn', role: 'identifier', description: 'Gov ID. Canary: CANARY_SSN_TOKEN_99999' },
        ],
      },
    ],
  };

  const policy = {
    deniedColumns: [
      { table: 'employees', column: 'salary' },
      { table: 'employees', column: 'ssn' },
    ],
    rowFilters: [],
  };

  test('Part 1: Restricted columns are filtered from schema description in prompt', () => {
    const prompt = buildPrompt({
      question: 'List all employees and their information',
      schema,
      semantic,
      policy,
      datasetType: 'sqlite',
    });

    // Allowed columns must be present
    assert.match(prompt, /\bid\b/, 'Allowed column "id" must be present');
    assert.match(prompt, /\bname\b/, 'Allowed column "name" must be present');

    // Denied columns must NOT be present in prompt
    assert.doesNotMatch(prompt, /\bsalary\b/i, 'Restricted column "salary" must be filtered from prompt');
    assert.doesNotMatch(prompt, /\bssn\b/i, 'Restricted column "ssn" must be filtered from prompt');
  });

  test('Part 2: Canary tokens are scrubbed from compiled prompt', () => {
    const prompt = buildPrompt({
      question: 'List all employees',
      schema,
      semantic,
      policy,
      datasetType: 'sqlite',
    });

    assert.doesNotMatch(prompt, /CANARY_[A-Za-z0-9_]+/i, 'Zero canary tokens should appear in generated prompt');
  });

  test('Part 3: Canary tokens in question or conversation context are scrubbed', () => {
    const prompt = buildPrompt({
      question: 'Show info for CANARY_INJECTED_PROMPT_111',
      conversationContext: 'Previous turn had CANARY_CONTEXT_222',
      schema,
      policy,
      datasetType: 'sqlite',
    });

    assert.doesNotMatch(prompt, /CANARY_[A-Za-z0-9_]+/i, 'Canary tokens in context/question must be scrubbed');
  });

  test('Part 4: generateSql passes clean prompt to LLM provider', async () => {
    let capturedPrompt = null;
    const mockLlm = {
      async complete(prompt) {
        capturedPrompt = prompt;
        return 'SELECT id, name FROM employees';
      },
    };

    const res = await generateSql(mockLlm, {
      question: 'List all employees',
      schema,
      semantic,
      policy,
      datasetType: 'sqlite',
    });

    assert.ok(capturedPrompt, 'LLM complete should have been called');
    assert.doesNotMatch(capturedPrompt, /\bsalary\b/i, 'Captured prompt must not have salary');
    assert.doesNotMatch(capturedPrompt, /\bssn\b/i, 'Captured prompt must not have ssn');
    assert.doesNotMatch(capturedPrompt, /CANARY_[A-Za-z0-9_]+/i, 'Captured prompt must have zero canary tokens');
    assert.equal(res.sql, 'SELECT id, name FROM employees');
  });
});
