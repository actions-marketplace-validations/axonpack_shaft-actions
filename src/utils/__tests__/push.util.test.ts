import { expect, test } from 'vitest';
import { commitDenial, pushDenial, runsCode } from '../push.util';

const pr = { defaultBranch: 'main', pullBranch: 'fix-login' };

test.each([
  ['disabled', { ...pr, branch: 'fix-login' }, /turned off/],
  ['', { ...pr, branch: 'fix-login' }, /turned off/],
  ['always', { ...pr, branch: 'fix-login' }, /turned off/],
  ['restricted', { ...pr, branch: 'fix-login' }, undefined],
  ['restricted', { ...pr, branch: 'main' }, /default branch/],
  ['restricted', { ...pr, branch: 'other' }, /only to the pull request's branch, fix-login, not other/],
  ['restricted', { defaultBranch: 'main', branch: 'shaft/issue-3-x' }, /own branch/],
  ['restricted', { ...pr, branch: 'fix-login', fork: true }, /own branch/],
  ['enabled', { ...pr, branch: 'fix-login' }, undefined],
  ['enabled', { defaultBranch: 'main', branch: 'shaft/issue-3-x' }, undefined],
  ['enabled', { ...pr, branch: 'main' }, /default branch/],
])('%s push to %o', (mode, target, why) => {
  const out = pushDenial(mode, target);
  if (why) expect(out).toMatch(why);
  else expect(out).toBeUndefined();
});

test('a commit may not touch .github/, .git/ or a path out of the checkout; package scripts, Makefiles and lock files are flagged', () => {
  expect(commitDenial(['src/a.ts', 'docs/.github.md', 'pkg/.github/x'])).toBeUndefined();
  expect(commitDenial(['src/a.ts', '.github/workflows/ci.yml'])).toMatch(/touches \.github\/workflows\/ci\.yml, and Axon Shaft never commits anything under \.github\//);
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', '.git/config', 'sub/.git/hooks/pre-push']) expect(commitDenial([bad]), bad).toMatch(/outside the files a commit can hold/);
  expect(runsCode(['package.json', 'apps/web/package.json', 'Makefile', 'bun.lock', 'yarn.lock', 'src/makefile.ts', 'package.json.md'])).toEqual([
    'package.json',
    'apps/web/package.json',
    'Makefile',
    'bun.lock',
    'yarn.lock',
  ]);
});
