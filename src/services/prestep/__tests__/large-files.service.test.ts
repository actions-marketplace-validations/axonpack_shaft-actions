import { expect, test } from 'vitest';
import { largeFiles } from '../large-files.service';
import { changed, input } from './fixtures/input';

const added = (filename: string) => ({ filename, status: 'added', additions: 0, deletions: 0 });

test('a file over the limit, an added binary and committed node_modules are should-fix, once per folder', () => {
  const files = [added('assets/big.json'), added('logo.png'), added('node_modules/x/index.js'), added('node_modules/x/package.json')];
  const found = largeFiles(input(files, { 'assets/big.json': 'x'.repeat(50), 'logo.png': 'PNG\0\0data' }), { maxBytes: 20 });
  expect(found.map((f) => `${f.file} ${f.title}`)).toEqual(['assets/big.json Large file: 0.0 MB', 'logo.png Binary file added', 'node_modules/x/index.js Committed `node_modules/`']);
});

test('look-alikes pass: text under the limit, dist in a GitHub Action, and a folder named distance', () => {
  const files = [changed('src/a.ts', ['x']), added('dist/index.js'), added('src/distance/a.ts')];
  expect(largeFiles(input(files, { 'src/a.ts': 'x', 'action.yml': 'name: x', 'dist/index.js': 'x', 'src/distance/a.ts': 'x' }))).toEqual([]);
});

test('dist outside an action is flagged', () => {
  expect(largeFiles(input([added('dist/index.js')], { 'dist/index.js': 'x' })).map((f) => f.title)).toEqual(['Committed `dist/`']);
});
