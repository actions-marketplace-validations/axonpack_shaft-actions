import * as cp from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';

// Real git, with every command line, its folder and its environment recorded.
const runs: { cwd: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
vi.doMock('node:child_process', () => ({
  execFileSync: (file: string, args: string[], o: cp.ExecFileSyncOptions) => {
    runs.push({ cwd: String(o.cwd), args, env: o.env });
    return cp.execFileSync(file, args, o);
  },
}));
vi.doMock('@actions/core', () => ({ setSecret: () => {} }));
const { pushBranch } = await import('../push.service');

const git = (cwd: string, ...args: string[]) =>
  cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** The repo on GitHub: main, and the pull request's branch `pr`. */
const dir = mkdtempSync(join(tmpdir(), 'shaft-push-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = join(dir, 'origin');
cp.execFileSync('git', ['init', '-q', '-b', 'main', origin]);
git(origin, 'commit', '-q', '--allow-empty', '-m', 'main 1');
git(origin, 'checkout', '-q', '-b', 'pr');
git(origin, 'commit', '-q', '--allow-empty', '-m', 'pr 1');
git(origin, 'checkout', '-q', 'main');

const token = 'ghs_grant';
const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
const leaks = (text: string) => text.includes(token) || text.includes(basic);

test("a push copies HEAD into a repo the action made and pushes from there, so the checkout's hooks and config never see the token", () => {
  for (const [name, clone] of [
    ['push-full', []],
    ['push-shallow', ['--depth', '1', '--branch', 'pr']],
  ] as const) {
    const work = join(dir, name);
    cp.execFileSync('git', ['clone', '-q', ...clone, `file://${origin}`, work]);
    git(work, 'checkout', '-q', '-B', 'pr', 'origin/pr');
    git(work, 'commit', '-q', '--allow-empty', '-m', `${name} fix`);
    // What the model could leave behind: a hook in .git/hooks and one in a hooksPath of its own.
    const marker = join(dir, `${name}-hook-ran`);
    const hook = `#!/bin/sh\nenv > ${marker}\n`;
    for (const hooks of [join(work, '.git', 'hooks'), join(work, 'evil-hooks')]) {
      mkdirSync(hooks, { recursive: true });
      writeFileSync(join(hooks, 'pre-push'), hook);
      chmodSync(join(hooks, 'pre-push'), 0o755);
    }
    git(work, 'config', 'core.hooksPath', join(work, 'evil-hooks'));
    const temp = join(dir, `${name}-temp`);
    mkdirSync(temp);
    process.env.RUNNER_TEMP = temp;
    runs.length = 0;

    pushBranch(work, token, 'restricted', { branch: 'pr', pullBranch: 'pr', defaultBranch: 'main' }, `file://${origin}`);

    expect(git(origin, 'rev-parse', 'refs/heads/pr')).toBe(git(work, 'rev-parse', 'HEAD'));
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(temp)).toEqual([]); // the action's repo is removed
    // The token is on one command line, run in the action's repo, never in the checkout or its config.
    const withToken = runs.filter((r) => leaks(r.args.join(' ')));
    expect(withToken.map((r) => r.args.slice(2, 3).concat(r.args.slice(-1)))).toEqual([['push', 'refs/heads/pr:refs/heads/pr']]);
    expect(withToken[0]!.cwd).not.toBe(work);
    const fromCheckout = runs.filter((r) => r.cwd === work);
    expect(fromCheckout).toHaveLength(1);
    expect(fromCheckout[0]!.args.slice(0, 2)).toEqual(['-c', 'core.hooksPath=/dev/null']);
    expect(Object.keys(fromCheckout[0]!.env!).every((k) => !/TOKEN|ACTIONS_|INPUT_/.test(k))).toBe(true);
    expect(leaks(readFileSync(join(work, '.git', 'config'), 'utf8'))).toBe(false);
  }
});

test('a rewritten history is refused, never forced, and a push the mode forbids runs no git at all', () => {
  const work = join(dir, 'push-full');
  const before = git(origin, 'rev-parse', 'refs/heads/pr');
  git(work, 'commit', '-q', '--amend', '--allow-empty', '-m', 'rewritten');
  expect(() => pushBranch(work, token, 'enabled', { branch: 'pr', pullBranch: 'pr', defaultBranch: 'main' }, `file://${origin}`)).toThrow(
    expect.objectContaining({ code: 'push_failed', message: expect.stringMatching(/The push to pr failed: .*rejected/s) }),
  );
  expect(git(origin, 'rev-parse', 'refs/heads/pr')).toBe(before);
  expect(runs.some((r) => r.args.some((a) => a === '--force' || a.startsWith('+')))).toBe(false);

  runs.length = 0;
  expect(() => pushBranch(work, token, 'restricted', { branch: 'main', pullBranch: 'pr', defaultBranch: 'main' }, `file://${origin}`)).toThrow(/default branch/);
  expect(() => pushBranch(work, token, 'disabled', { branch: 'pr', pullBranch: 'pr', defaultBranch: 'main' }, `file://${origin}`)).toThrow(/turned off/);
  expect(runs).toEqual([]);
});
