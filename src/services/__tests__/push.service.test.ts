import * as cp from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';

vi.doMock('@actions/core', () => ({ warning: () => {} }));
// The sandbox runs only on Linux (sandbox.service.test.ts): here git runs as it would inside it.
vi.doMock('../sandbox.service', () => ({ inSandbox: (cwd: string, file: string, args: string[], o: cp.ExecFileSyncOptions) => cp.execFileSync(file, args, { ...o, cwd }) }));
/** GitHub's Git Data API, faked: every call in order, and an `updateRef` that can be made to fail. */
const calls: [string, Record<string, unknown>][] = [];
let refFails = false;
vi.doMock('@actions/github', () => ({
  getOctokit: (token: string) => {
    const call = (name: string, data: object) => async (args: Record<string, unknown> = {}) => {
      calls.push([name, { ...args, token }]);
      if (name === 'updateRef' && refFails) throw new Error('Update is not a fast forward');
      return { data };
    };
    return {
      rest: {
        git: {
          getCommit: call('getCommit', { tree: { sha: 'base-tree' } }),
          createBlob: call('createBlob', { sha: `blob-${calls.length}` }),
          createTree: call('createTree', { sha: 'new-tree' }),
          createCommit: call('createCommit', { sha: 'c0ffee' }),
          updateRef: call('updateRef', {}),
        },
        apps: { revokeInstallationAccessToken: call('revoke', {}) },
      },
    };
  },
}));
const { pushChanges, readChanges } = await import('../push.service');

const git = (cwd: string, ...args: string[]) =>
  cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

const dir = mkdtempSync(join(tmpdir(), 'shaft-push-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let work = '';
let n = 0;
beforeEach(() => {
  work = join(dir, `work-${++n}`);
  mkdirSync(work);
  git(work, 'init', '-q', '-b', 'pr');
  writeFileSync(join(work, 'edit.ts'), 'a');
  writeFileSync(join(work, 'gone.ts'), 'a');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'pr 1');
  calls.length = 0;
  refFails = false;
});

test('the changes keep each file\'s executable bit, a link as a link, and a deletion as no mode', () => {
  writeFileSync(join(work, 'edit.ts'), 'b');
  unlinkSync(join(work, 'gone.ts'));
  mkdirSync(join(work, 'bin'));
  writeFileSync(join(work, 'bin', 'run'), '#!/bin/sh\n');
  chmodSync(join(work, 'bin', 'run'), 0o755);
  symlinkSync('../edit.ts', join(work, 'bin', 'link'));
  const changes = readChanges(work, git(work, 'rev-parse', 'HEAD'));
  expect(changes.sort((a, b) => a.path.localeCompare(b.path))).toEqual([
    { path: 'bin/link', mode: '120000', content: Buffer.from('../edit.ts') },
    { path: 'bin/run', mode: '100755', content: Buffer.from('#!/bin/sh\n') },
    { path: 'edit.ts', mode: '100644', content: Buffer.from('b') },
    { path: 'gone.ts' },
  ]);
});

test('a file is opened without following links: one swapped in for it is pushed as a link, never what it points to, and a FIFO is refused', () => {
  const secret = join(dir, `secret-${n}`);
  writeFileSync(secret, 'runner-secret');
  writeFileSync(join(work, 'edit.ts'), 'b');
  const base = git(work, 'rev-parse', 'HEAD');
  // As if the file had been swapped for a link after git status listed it: the link itself is read.
  unlinkSync(join(work, 'edit.ts'));
  symlinkSync(secret, join(work, 'edit.ts'));
  expect(readChanges(work, base)).toEqual([{ path: 'edit.ts', mode: '120000', content: Buffer.from(secret) }]);
  unlinkSync(join(work, 'edit.ts'));
  cp.execFileSync('mkfifo', [join(work, 'edit.ts')]);
  expect(() => readChanges(work, base)).toThrow(expect.objectContaining({ code: 'push_failed', message: "edit.ts isn't a file or a link, so nothing was pushed." }));
});

test('a change under .github/, or a HEAD the run moved, is refused before anything is pushed', () => {
  const base = git(work, 'rev-parse', 'HEAD');
  mkdirSync(join(work, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(work, '.github', 'workflows', 'ci.yml'), 'on: push');
  expect(() => readChanges(work, base)).toThrow(expect.objectContaining({ code: 'push_failed', message: expect.stringContaining('.github/workflows/ci.yml') }));
  rmSync(join(work, '.github'), { recursive: true });
  git(work, 'commit', '-q', '--allow-empty', '-m', 'a check committed');
  expect(() => readChanges(work, base)).toThrow(/moved HEAD/);
});

const request = {
  owner: 'acme',
  repo: 'widgets',
  branch: 'pr',
  base: 'abc123',
  message: 'Retry three times',
  author: { name: 'axonshaft[bot]', email: '4242+axonshaft[bot]@users.noreply.github.com' },
  changes: [
    { path: 'bin/run', mode: '100755' as const, content: Buffer.from('#!/bin/sh\n') },
    { path: 'bin/link', mode: '120000' as const, content: Buffer.from('../edit.ts') },
    { path: 'gone.ts' },
  ],
};

test('the push is blobs, a tree on the base commit\'s, the commit as the bot, then the ref never forced, and the token is revoked', async () => {
  expect(await pushChanges('ghs_push', request)).toBe('c0ffee');
  expect(calls.map(([name]) => name)).toEqual(['getCommit', 'createBlob', 'createBlob', 'createTree', 'createCommit', 'updateRef', 'revoke']);
  expect(calls.every(([, a]) => a.token === 'ghs_push')).toBe(true);
  expect(calls[1]![1]).toMatchObject({ content: Buffer.from('#!/bin/sh\n').toString('base64'), encoding: 'base64' });
  expect(calls[3]![1]).toMatchObject({
    base_tree: 'base-tree',
    tree: [
      { path: 'bin/run', mode: '100755', type: 'blob', sha: expect.stringMatching(/^blob-/) },
      { path: 'bin/link', mode: '120000', type: 'blob', sha: expect.stringMatching(/^blob-/) },
      { path: 'gone.ts', mode: '100644', type: 'blob', sha: null },
    ],
  });
  expect(calls[4]![1]).toMatchObject({ message: 'Retry three times', tree: 'new-tree', parents: ['abc123'], author: request.author });
  expect(calls[5]![1]).toMatchObject({ ref: 'heads/pr', sha: 'c0ffee', force: false });
});

test('a branch that moved during the run is refused by GitHub, never forced, and the token is still revoked', async () => {
  refFails = true;
  await expect(pushChanges('ghs_push', request)).rejects.toMatchObject({ code: 'push_failed', message: 'The push to pr failed: Update is not a fast forward' });
  expect(calls.at(-1)![0]).toBe('revoke');
});
