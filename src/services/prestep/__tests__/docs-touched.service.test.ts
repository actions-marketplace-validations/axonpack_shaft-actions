import { expect, test } from 'vitest';
import { docsTouched } from '../docs-touched.service';
import { changed, input } from './fixtures/input';

test('the docs changed, and the nearest README above changed code that the PR leaves alone; changelogs and tests don\'t count', async () => {
  const files = [
    changed('docs/guide/setup.mdx', ['New step.']),
    changed('packages/ui/notes/button.md', ['x']),
    changed('packages/ui/CHANGELOG.md', ['## 1.3.0']),
    changed('.changeset/brave-cats.md', ['x']),
    changed('packages/ui/src/button.tsx', ['x']),
    changed('packages/ui/src/icon.tsx', ['x']),
    changed('packages/ui/src/__tests__/button.test.tsx', ['x']),
    changed('src/main.ts', ['x']),
  ];
  const tree = { 'README.md': '# app', 'packages/ui/README.md': '# ui' };
  expect(await docsTouched(input(files, tree))).toBe(
    [
      'Docs the pull request changes:',
      '- docs/guide/setup.mdx (modified, +1 -0)',
      '- packages/ui/notes/button.md (modified, +1 -0)',
      'Code files changed, not counting tests: 3',
      'The nearest README above the changed code, not changed:',
      '- packages/ui/README.md (above 2 changed files)',
      '- README.md (above 1 changed file)',
    ].join('\n'),
  );
});

test('a README the PR changes is left out of the untouched list, and a PR with neither docs nor code says so', async () => {
  const facts = await docsTouched(input([changed('README.md', ['x']), changed('src/a.ts', ['x'])], { 'README.md': '# app' }));
  expect(facts).toBe('Docs the pull request changes:\n- README.md (modified, +1 -0)\nCode files changed, not counting tests: 1');
  expect(await docsTouched(input([changed('bun.lock', ['x'])]))).toBe('');
});
