import { expect, test } from 'vitest';
import { unused } from '../unused.service';
import { changed, input } from './fixtures/input';

const tree = {
  'src/format.ts': 'export function formatDate() {}\nexport const formatMoney = () => 1;\nexport { helper as publicHelper };',
  'src/app.tsx': "import { formatDate } from './format';",
  'README.md': 'formatMoney',
};

test('a newly exported name no other code file names is listed; a used one and an export that only changed are not', async () => {
  const f = changed('src/format.ts', ['export function formatDate() {}', 'export const formatMoney = () => 1;', 'export { helper as publicHelper };', 'export function old(a, b) {}'], ['export function old(a) {}']);
  expect((await unused(input([f], tree))).split('\n')).toEqual([
    '2 of the 3 new exports are named in no other code file:',
    '- `formatMoney` (src/format.ts:2)',
    '- `publicHelper` (src/format.ts:3)',
  ]);
});

test('Python, Go and Rust exports count, and no new export says so', async () => {
  const files = [changed('a.py', ['def load():', '    def inner():', 'def _private():']), changed('b.go', ['func Serve() {}', 'func (s *S) Close() {}', 'func local() {}']), changed('c.rs', ['pub fn run() {}'])];
  expect(await unused(input(files, { 'main.py': 'from a import load' }))).toBe('3 of the 4 new exports are named in no other code file:\n- `Serve` (b.go:1)\n- `Close` (b.go:2)\n- `run` (c.rs:1)');
  expect(await unused(input([changed('a.ts', ['const x = 1;'])]))).toBe('The pull request exports no new name.');
});
