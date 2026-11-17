import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { expect, test } from 'vitest';

// GitHub loads action.yml before anything runs, so a file that doesn't parse breaks every workflow
// using the action. Nothing else checks it.
test('action.yml parses and points at the built bundle', () => {
  const action = parse(readFileSync('action.yml', 'utf8'));
  expect(action.name).toBe('Axon Shaft');
  expect(typeof action.description).toBe('string');
  expect(action.runs.using).toMatch(/^node\d+$/);
  expect(existsSync(action.runs.main)).toBe(true);
  for (const [name, input] of Object.entries(action.inputs as Record<string, { description?: unknown }>))
    expect(typeof input.description, `input ${name}`).toBe('string');
});
