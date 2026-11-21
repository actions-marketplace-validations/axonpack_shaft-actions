import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ACTION_CODES } from '../codes.const';

// The docs' codes page comes from ACTION_CODES, so a code the action reports and the list leaves out would have no entry.
test('every code the action reports is in ACTION_CODES', () => {
  const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts') && !f.includes('__tests__'));
  const used = new Set(
    files.flatMap((f) => [...readFileSync(join('src', f), 'utf8').matchAll(/ShaftFailure\('([a-z_]+)'|code: '([a-z_]+)'|noticeText\(.*, '([a-z_]+)'\)/g)].map((m) => m[1] ?? m[2] ?? m[3]!)),
  );
  expect(used.size).toBeGreaterThan(10);
  expect([...used].filter((c) => !(c in ACTION_CODES))).toEqual([]);
});
