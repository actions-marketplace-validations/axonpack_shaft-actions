import { beforeEach, expect, test, vi } from 'vitest';
import { answers, asked } from './fixtures/linters';
import { changed, input } from './fixtures/input';

vi.mock('../../tool.service', async (real) => (await import('./fixtures/linters')).fakeLinters(await real()));
const { migrationLint } = await import('../migration-lint.service');

beforeEach(() => {
  asked.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

test("squawk's report on the changed SQL files, its 0-based lines counted from 1", async () => {
  answers.squawk = {
    out: '[{"file":"db/002.sql","line":2,"level":"Warning","message":"missing `set lock_timeout` before potentially slow `access exclusive` lock operations","help":"configure a `lock_timeout` before this statement","rule_name":"require-lock-timeout"}]',
    status: 1,
  };
  const tree = { 'db/002.sql': 'SELECT 1;\n\nALTER TABLE x ADD COLUMN y int NOT NULL;', '.squawk.toml': '' };
  expect(await migrationLint(input([changed('db/002.sql', ['SELECT 1;'])], tree))).toBe(
    'db/002.sql:3 require-lock-timeout (warning): missing `set lock_timeout` before potentially slow `access exclusive` lock operations configure a `lock_timeout` before this statement.',
  );
  expect(asked).toEqual([{ name: 'squawk', args: ['--reporter', 'json', 'db/002.sql'], files: tree }]);
  expect(await migrationLint(input([changed('src/schema.ts', ['x'])], {}))).toBe('No SQL file changed, so squawk had nothing to read.');
});
