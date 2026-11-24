import { expect, test } from 'vitest';
import { changeset } from '../changeset.service';
import { changed, input } from './fixtures/input';

const TREE = {
  '.changeset/config.json': '{}',
  'packages/ui/package.json': '{ "name": "@acme/ui", "version": "1.2.0" }',
  'packages/kit/package.json': '{ "name": "@acme/kit", "private": true }',
  'packages/docs/package.json': 'not json',
  '.changeset/brave-cats.md': "---\n'@acme/ui': minor\n\"@acme/gone\": patch\n---\n\nAdds a button.\n",
};

test('each changed package with its changesets, changelog and version, then each changeset and the packages it names', async () => {
  const files = [
    changed('packages/ui/src/button.tsx', ['export const Button = 1;']),
    changed('packages/ui/src/deep/icon.tsx', ['x']),
    changed('packages/kit/index.ts', ['x']),
    changed('packages/docs/intro.ts', ['x']),
    changed('.changeset/brave-cats.md', []),
  ];
  expect(await changeset(input(files, TREE))).toBe(
    [
      'The repo uses changesets (`.changeset/config.json`).',
      'Packages the pull request changes:',
      '- `@acme/ui` (packages/ui/package.json, version 1.2.0): 2 files; changesets: minor (.changeset/brave-cats.md); packages/ui/CHANGELOG.md not changed',
      '- `@acme/kit` (packages/kit/package.json, private): 1 file; changesets: none; packages/kit/CHANGELOG.md not changed',
      '1 changed file belongs to no package.',
      'Changesets in the pull request:',
      '- .changeset/brave-cats.md: `@acme/ui` minor, `@acme/gone` patch',
      "Changesets name packages the pull request doesn't change: `@acme/gone`",
    ].join('\n'),
  );
});

test('a changelog edit and a version bump in package.json show, and a PR with no package or changeset says so', async () => {
  const files = [
    changed('package.json', ['  "version": "2.0.0",'], ['  "version": "1.9.0",']),
    changed('CHANGELOG.md', ['## 2.0.0']),
  ];
  const facts = await changeset(input(files, { 'package.json': '{ "name": "app", "version": "2.0.0" }' }));
  expect(facts).toContain('- `app` (package.json, version 2.0.0): 2 files; changesets: none; CHANGELOG.md changed; version changed: "version": "2.0.0",');
  expect(facts).toContain('The repo has no `.changeset/config.json`.');
  expect(await changeset(input([changed('src/a.ts', ['x'])]))).toBe('');
});
