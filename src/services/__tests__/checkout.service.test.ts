import * as cp from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test, vi } from 'vitest';

// Real git, with every command line recorded.
const calls: string[][] = [];
const masked: string[] = [];
vi.doMock('node:child_process', () => ({
  execFileSync: (file: string, args: string[], o: cp.ExecFileSyncOptions) => {
    calls.push(args);
    return cp.execFileSync(file, args, o);
  },
}));
vi.doMock('@actions/core', () => ({ setSecret: (s: string) => masked.push(s) }));
const { checkoutHead } = await import('../checkout.service');

const git = (cwd: string, ...args: string[]) =>
  cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** The repo on GitHub: main, and PR #7 branched from main's first commit, with main moved on since. */
const dir = mkdtempSync(join(tmpdir(), 'shaft-checkout-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = join(dir, 'origin');
cp.execFileSync('git', ['init', '-q', '-b', 'main', origin]);
git(origin, 'commit', '-q', '--allow-empty', '-m', 'main 1');
git(origin, 'checkout', '-q', '-b', 'pr');
git(origin, 'commit', '-q', '--allow-empty', '-m', 'pr 1');
const head = git(origin, 'rev-parse', 'HEAD');
git(origin, 'update-ref', 'refs/pull/7/head', head);
git(origin, 'checkout', '-q', 'main');
git(origin, 'commit', '-q', '--allow-empty', '-m', 'main 2');

const token = 'ghs_grant';
const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
const leaks = (text: string) => text.includes(token) || text.includes(basic);

test("the PR's head commit is checked out detached, as deep as the checkout, with the token on the fetch's command line only", () => {
  for (const [name, clone, commits] of [
    ['shallow', ['--depth', '1'], '1'],
    ['full', [], '2'],
  ] as const) {
    const work = join(dir, name);
    cp.execFileSync('git', ['clone', '-q', ...clone, `file://${origin}`, work]);
    calls.length = 0;
    checkoutHead(work, 7, token);

    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(work, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    expect(git(work, 'rev-list', '--count', 'HEAD')).toBe(commits);
    const fetch = calls.find((args) => args.includes('fetch'))!;
    expect(fetch.slice(0, 3)).toEqual(['-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, 'fetch']);
    expect(fetch.slice(-2)).toEqual(['origin', 'refs/pull/7/head']);
    expect(leaks(calls.filter((args) => args !== fetch).join(' '))).toBe(false);
    const config = readFileSync(join(work, '.git', 'config'), 'utf8');
    expect(leaks(config) || config.includes('extraheader')).toBe(false);
  }
  expect(masked).toEqual([basic, basic]);
});
