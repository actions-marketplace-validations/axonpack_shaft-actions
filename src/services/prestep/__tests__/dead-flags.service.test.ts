import { expect, test } from 'vitest';
import { deadFlags } from '../dead-flags.service';
import { changed, input } from './fixtures/input';

test('a flag the change stops reading but the repo still names is a candidate; none means empty facts', async () => {
  const file = changed('src/a.ts', ['const on = true;'], ["const on = useFlag('new-checkout');"]);
  expect(await deadFlags(input([file], { 'src/flags.ts': "export const DEFAULTS = { 'new-checkout': false };" }))).toContain('`new-checkout` (was in src/a.ts); still named in src/flags.ts');
  expect(await deadFlags(input([file], { 'src/a.ts': 'const on = true;' }))).toBe('');
});
