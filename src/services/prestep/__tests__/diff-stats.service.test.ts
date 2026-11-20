import { expect, test } from 'vitest';
import { diffStats } from '../diff-stats.service';
import { changed, input } from './fixtures/input';

test('totals, then areas and kinds by size, then every file largest first', async () => {
  const files = [
    changed('packages/ui/src/button.tsx', ['a', 'b', 'c'], ['d']),
    changed('packages/ui/src/__tests__/button.test.tsx', ['a', 'b']),
    changed('apps/web/README.md', ['a']),
    changed('bun.lock', ['a', 'b', 'c', 'd', 'e', 'f']),
    { ...changed('scripts/build.sh', ['a']), status: 'added' },
  ];
  expect(await diffStats(input(files))).toBe(
    [
      '5 files changed, +13 -1.',
      'By area:',
      '- packages/ui: 2 files, +5 -1',
      '- (root): 1 file, +6 -0',
      '- apps/web: 1 file, +1 -0',
      '- scripts: 1 file, +1 -0',
      'By kind:',
      '- lockfiles: 1 file, +6 -0',
      '- code: 1 file, +3 -1',
      '- tests: 1 file, +2 -0',
      '- docs: 1 file, +1 -0',
      '- other: 1 file, +1 -0',
      'Files, largest first:',
      '- bun.lock (modified) +6 -0',
      '- packages/ui/src/button.tsx (modified) +3 -1',
      '- packages/ui/src/__tests__/button.test.tsx (modified) +2 -0',
      '- apps/web/README.md (modified) +1 -0',
      '- scripts/build.sh (added) +1 -0',
    ].join('\n'),
  );
  expect(await diffStats(input([]))).toBe('The pull request changes no files.');
});

test('a 5,000-file pull request is cut at about 4k tokens', async () => {
  const facts = await diffStats(input(Array.from({ length: 5000 }, (_, i) => changed(`src/f${i}.ts`, ['x']))));
  expect(facts.length).toBeLessThan(16_100);
  expect(facts).toMatch(/\.\.\. and \d+ more lines, cut to fit\.$/);
});
