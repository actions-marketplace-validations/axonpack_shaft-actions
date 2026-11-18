import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { expect, test } from 'vitest';

// GitHub loads action.yml before anything runs, so a file that doesn't parse breaks every workflow
// using the action. Nothing else checks it.
test('action.yml parses, points at the built bundle and has only the dry_run input', () => {
  const action = parse(readFileSync('action.yml', 'utf8'));
  expect(action.name).toBe('Axon Shaft');
  expect(typeof action.description).toBe('string');
  expect(action.runs.using).toMatch(/^node\d+$/);
  expect(existsSync(action.runs.main)).toBe(true);
  // Everything else comes from the dashboard.
  expect(Object.keys(action.inputs)).toEqual(['dry_run']);
  expect(typeof action.inputs.dry_run.description).toBe('string');
});
