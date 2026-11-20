import { expect, test } from 'vitest';
import { depsDiff, depsDiffFacts, type LockfileDiff } from '../deps-diff.service';
import { changed, input } from './fixtures/input';
import { lockInput } from './fixtures/lockfile';

/** One line per change: kind, name, the versions dropped, then the ones added with their line, `private` when not from the public registry. */
const show = (diffs: LockfileDiff[]) =>
  diffs.flatMap(({ changes }) =>
    changes.map((c) => `${c.kind} ${c.name} ${c.from.join(',') || '-'} -> ${c.to.map((p) => `${p.version}:${p.line}${p.public ? '' : ' private'}`).join(',') || '-'}`),
  );

const NPM = ['removed left-pad 1.3.0 -> -', 'changed lodash 4.17.20 -> 4.17.21', 'added @acme/ui - -> 1.0.0', 'added express - -> 4.18.2', 'added internal-kit - -> 2.0.0'];

test.each([
  // npm keeps the old lodash in a workspace's node_modules, so only the new copy is added.
  ['package-lock.json', ['changed lodash - -> 4.17.21:23', 'removed left-pad 1.3.0 -> -', 'added @acme/ui - -> 1.0.0:13', 'added express - -> 4.18.2:18', 'added internal-kit - -> 2.0.0:33 private']],
  ['bun.lock', [...NPM.slice(0, 2), 'added @acme/ui - -> 1.0.0', 'added express - -> 4.18.2', 'added internal-kit - -> 2.0.0', 'added tiny - -> github:acme/tiny#abc123']],
  ['yarn.lock', NPM],
  ['pnpm-lock.yaml', NPM],
  ['requirements.txt', ['changed requests 2.25.0 -> 2.31.0', 'removed six 1.15.0 -> -', 'added flask - -> 3.0.0']],
  ['poetry.lock', ['changed requests 2.25.0 -> 2.31.0', 'removed six 1.15.0 -> -', 'added flask - -> 3.0.0', 'added internal-kit - -> 2.0.0']],
  ['uv.lock', ['changed requests 2.25.0 -> 2.31.0', 'added internal-kit - -> 2.0.0']],
  ['Cargo.lock', ['removed libc 0.2.140 -> -', 'changed serde 1.0.100 -> 1.0.200', 'added internal-kit - -> 2.0.0', 'added tokio - -> 1.35.0']],
  ['go.sum', ['removed github.com/pkg/errors v0.9.1 -> -', 'changed golang.org/x/net v0.1.0 -> v0.17.0', 'added github.com/acme/internal - -> v1.2.0', 'added github.com/gin-gonic/gin - -> v1.9.1']],
])('%s: the packages added, removed and changed between the base copy and the head copy', async (name, expected) => {
  const got = show(await depsDiff(lockInput(name)));
  // Lines and `private` are checked on package-lock.json; elsewhere only the change itself.
  expect(name === 'package-lock.json' ? got : got.map((l) => l.replace(/:\d+( private)?/g, ''))).toEqual(expected);
});

test('a pin is private when it comes from another registry, git or a URL, and local packages are left out', async () => {
  const priv = async (name: string) => (await depsDiff(lockInput(name))).flatMap((d) => d.changes.flatMap((c) => c.to.filter((p) => !p.public).map((p) => c.name)));
  expect(await priv('bun.lock')).toEqual(['internal-kit', 'tiny']);
  for (const name of ['yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'uv.lock', 'Cargo.lock']) expect(await priv(name)).toEqual(['internal-kit']);
  expect(await priv('requirements.txt')).toEqual([]);
});

test("a registry other than npm's in the repo's config, a private index, or a Go module under the repo's owner makes pins private", async () => {
  const allPrivate = async (name: string, tree: Record<string, string>) =>
    (await depsDiff(lockInput(name, tree))).flatMap((d) => d.changes.flatMap((c) => c.to)).every((p) => !p.public);
  expect(await allPrivate('package-lock.json', { '.npmrc': 'registry=https://npm.acme.dev/\n' })).toBe(true);
  expect(await allPrivate('yarn.lock', { '.yarnrc.yml': 'npmRegistryServer: "https://npm.acme.dev"\n' })).toBe(true);
  expect(await allPrivate('bun.lock', { 'bunfig.toml': '[install]\nregistry = "https://npm.acme.dev/"\n' })).toBe(true);
  expect(await allPrivate('package-lock.json', { '.npmrc': '@acme:registry=https://npm.acme.dev/\nregistry=https://registry.npmjs.org/\n' })).toBe(false);
  const req = input([changed('requirements.txt', [])], { 'requirements.txt': '--extra-index-url https://pypi.acme.dev/simple\nrequests==2.31.0\n' });
  expect((await depsDiff(req))[0]!.changes[0]!.to[0]!.public).toBe(false);
  const go = (await depsDiff(lockInput('go.sum', { 'go.mod': 'module github.com/acme/app\n\ngo 1.22\n' })))[0]!.changes;
  expect(go.flatMap((c) => c.to.filter((p) => !p.public).map(() => c.name))).toEqual(['github.com/acme/internal']);
});

test('a new lockfile is all added, a deleted one all removed, and one the checkout can\'t read throws', async () => {
  const added = { ...changed('yarn.lock', []), status: 'added' };
  expect(show(await depsDiff(input([added], { 'yarn.lock': 'lodash@^4:\n  version "4.17.21"\n' })))).toEqual(['added lodash - -> 4.17.21:2']);
  const removed = { ...changed('Cargo.lock', []), status: 'removed' };
  expect(show(await depsDiff(lockInput('Cargo.lock', {}, { files: [removed] })))).toEqual(['removed libc 0.2.140 -> -', 'removed serde 1.0.100 -> -']);
  await expect(depsDiff(input([changed('apps/web/pnpm-lock.yaml', [])]))).rejects.toThrow("Couldn't read `apps/web/pnpm-lock.yaml` from the checkout.");
  expect(await depsDiff(input([changed('src/a.ts', ['x'])]))).toEqual([]);
});

test('the facts list each change with its versions and line, and are cut at about 4k tokens', async () => {
  expect(await depsDiffFacts(lockInput('Cargo.lock'))).toBe(
    [
      'Cargo.lock (crates.io):',
      '- removed libc 0.2.140',
      '- changed serde 1.0.100 -> 1.0.200 (line 19)',
      '- added internal-kit 2.0.0 (not from the public registry) (line 14)',
      '- added tokio 1.35.0 (line 25)',
    ].join('\n'),
  );
  expect(await depsDiffFacts(input([changed('src/a.ts', ['x'])]))).toBe('No lockfile in the pull request adds, removes or changes a package.');
  const big = Array.from({ length: 2000 }, (_, i) => `pkg-${i}==1.0.${i}`).join('\n');
  const facts = await depsDiffFacts(input([changed('requirements.txt', [])], { 'requirements.txt': big }));
  expect(facts.length).toBeLessThan(16_100);
  expect(facts).toMatch(/\.\.\. and \d+ more lines, cut to fit\.$/);
});
