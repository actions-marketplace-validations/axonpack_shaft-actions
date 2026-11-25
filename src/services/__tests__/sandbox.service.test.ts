import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test, vi } from 'vitest';

vi.doMock('@actions/core', () => ({ info: () => {} }));
const { endSandboxes, inSandbox, prepareSandbox, sandboxArgs, sandboxPrefix } = await import('../sandbox.service');
const { runCheck } = await import('../commands.service');
const { runnerEnv } = await import('../../utils/env.util');

const dir = mkdtempSync(join(tmpdir(), 'shaft-sandbox-'));
const home = join(dir, 'home');
const cwd = join(home, 'work', 'repo');
mkdirSync(join(home, '.tools'), { recursive: true });
mkdirSync(cwd, { recursive: true });
writeFileSync(join(home, '.credentials'), 'runner-credentials');
process.env.HOME = home;
process.env.RUNNER_TEMP = join(dir, 'runner-temp');
process.env.PATH = `${join(home, '.tools')}:${process.env.PATH}`;

test('the sandbox has its own PID namespace and /proc, dies with its parent, and writes only the checkout, over an empty home', () => {
  const args = sandboxArgs(cwd).join(' ');
  for (const opt of ['--die-with-parent', '--new-session', '--unshare-pid', '--proc /proc', '--cap-drop ALL', '--ro-bind / /', '--tmpfs /run', '--tmpfs /tmp'])
    expect(args).toContain(opt);
  expect(args).toContain(`--tmpfs ${home} --tmpfs ${process.env.RUNNER_TEMP}`);
  expect(args).toContain(`--ro-bind ${join(home, '.tools')} ${join(home, '.tools')}`);
  expect(args).toMatch(new RegExp(`--bind ${cwd} ${cwd} --chdir ${cwd}`));
  expect(sandboxPrefix(cwd)).toMatch(/^'(\/[^']+\/)?env' '-u' 'ANTHROPIC_API_KEY' '-u' 'CLAUDE_CODE_OAUTH_TOKEN' '(\/[^']+\/)?bwrap' '--die-with-parent' .* '--'$/);
});

test("a linter's sandbox has no network, reads its work folder and its own folder, and writes nothing", () => {
  const tool = join(process.env.RUNNER_TEMP!, 'shaft-tools', 'hadolint-2.15.1');
  const args = sandboxArgs(cwd, { tool }).join(' ');
  expect(args).toContain(`--tmpfs ${process.env.RUNNER_TEMP} `);
  expect(args).toMatch(new RegExp(`--unshare-net --ro-bind ${tool} ${tool} --ro-bind ${cwd} ${cwd} --chdir ${cwd}`));
  expect(args).not.toContain(`--bind ${cwd}`.replace('--bind', ' --bind'));
});

test('a PATH folder that is home itself, or holds the runner temp folder, is never bound back over the empty home', () => {
  const saved = { PATH: process.env.PATH, RUNNER_TEMP: process.env.RUNNER_TEMP };
  process.env.RUNNER_TEMP = join(home, 'work', '_temp');
  process.env.PATH = [home, join(home, 'work'), join(home, '.tools'), saved.PATH].join(':');
  const args = sandboxArgs(cwd).join(' ');
  Object.assign(process.env, saved);
  expect(args).toContain(`--ro-bind ${join(home, '.tools')} `);
  expect(args).not.toContain(`--ro-bind ${home} `);
  expect(args).not.toContain(`--ro-bind ${join(home, 'work')} `);
});

// bubblewrap runs only on Linux. These run in a Linux container (see the README's Development section) or on a runner.
const reason = process.platform !== 'linux' ? `${process.platform} has no bubblewrap` : prepareSandbox(cwd);
if (reason) console.warn(`Skipping the sandbox tests that start bubblewrap: ${reason}`);

describe.skipIf(!!reason)('in bubblewrap', () => {
  // What repo code would look for: every process's environment and command line, home, temp, sudo.
  const probe = `
    const fs = require('fs');
    const read = (f) => { try { return fs.readFileSync(f, 'utf8') } catch (e) { return e.code } };
    const pids = fs.readdirSync('/proc').filter((p) => /^\\d+$/.test(p));
    console.log(JSON.stringify({
      pids,
      environ: pids.map((p) => read('/proc/' + p + '/environ')),
      cmdline: pids.map((p) => read('/proc/' + p + '/cmdline')),
      parent: read('/proc/' + process.ppid + '/environ'),
      home: fs.readdirSync(process.env.HOME),
      temp: fs.existsSync(process.env.RUNNER_TEMP) ? fs.readdirSync(process.env.RUNNER_TEMP) : [],
      nnp: /NoNewPrivs:\\s*1/.test(read('/proc/self/status')),
      outside: (() => { try { fs.writeFileSync('/etc/shaft-test', 'x'); return 'written' } catch (e) { return e.code } })(),
    }));
    fs.writeFileSync('inside.txt', 'x');
    process.exit(1);
  `;
  writeFileSync(join(cwd, 'probe.js'), probe);
  mkdirSync(process.env.RUNNER_TEMP!, { recursive: true });
  writeFileSync(join(process.env.RUNNER_TEMP!, 'event.json'), 'runner-temp');
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'oidc-request-secret';
  process.env.GITHUB_TOKEN = 'ghs_workflow_secret';
  // A process that holds the tokens from its start, as the runner, the CLI and the action do.
  const holder = spawn('sleep', ['60'], { env: { ...process.env } });
  afterAll(() => holder.kill());

  const check = (out: string) => {
    const seen = JSON.parse(out.split('\n').find((l) => l.startsWith('{'))!);
    expect(out).not.toMatch(/oidc-request-secret|ghs_workflow_secret|sk-ant-secret|runner-credentials/);
    expect(seen.pids.length).toBeLessThan(5); // the sandbox's own few, never the runner's or the action's
    expect(seen.home.sort()).toEqual(['.tools', 'work']); // only the tools on the PATH and the way to the checkout
    expect(seen.temp).toEqual([]);
    expect(seen.nnp).toBe(true); // no sudo, no setuid
    expect(seen.outside).toMatch(/EROFS|EACCES/);
  };

  test("a check that reads /proc/1/environ or its parent's environment sees no token", () => {
    // The control: the same probe run without the sandbox finds the token in the holder's environment.
    let bare = '';
    try {
      execFileSync('node', ['probe.js'], { cwd, encoding: 'utf8', env: runnerEnv() });
    } catch (e) {
      bare = (e as { stdout: string }).stdout;
    }
    expect(bare).toContain('oidc-request-secret');
    const out = runCheck(cwd, 'node probe.js');
    expect(out.passed).toBe(false);
    check(out.output);
    expect(inSandbox(cwd, 'cat', ['inside.txt'], { encoding: 'utf8' })).toBe('x'); // the checkout is writable
  });

  // The CLI's environment (`cliEnv`), with the Claude token the CLI would already have scrubbed.
  test("the model's Bash command, prefixed, runs the same way, with the Claude token gone even from bubblewrap's own process", () => {
    let out = '';
    try {
      execFileSync('bash', ['-c', `${sandboxPrefix(cwd)} node probe.js`], { cwd, encoding: 'utf8', env: { ...runnerEnv(), ANTHROPIC_API_KEY: 'sk-ant-secret' } });
    } catch (e) {
      out = (e as { stdout: string }).stdout;
    }
    check(out);
  });

  test('bubblewrap, env and pkill are the ones found before any repo code ran, whatever the PATH holds later', () => {
    expect(sandboxPrefix(cwd)).toMatch(/^'\/[^']+\/env' .* '\/[^']+\/bwrap' /);
    // A bwrap the checkout puts first on the PATH, as a session could.
    mkdirSync(join(cwd, 'bin'), { recursive: true });
    writeFileSync(join(cwd, 'bin', 'bwrap'), `#!/bin/sh\ntouch ${join(cwd, 'planted-ran')}\n`, { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = `${join(cwd, 'bin')}:${saved}`;
    try {
      expect(inSandbox(cwd, 'echo', ['ok'], { encoding: 'utf8' })).toBe('ok\n');
      expect(sandboxPrefix(cwd)).not.toContain(join(cwd, 'bin'));
    } finally {
      process.env.PATH = saved;
    }
    expect(existsSync(join(cwd, 'planted-ran'))).toBe(false);
  });

  test('once the session ends, no sandbox outlives it: a command left running, and what it started, are killed', async () => {
    // A shell of its own process group, as the CLI starts each one, whose sandbox leaves a child behind.
    const shell = spawn('bash', ['-c', `${sandboxPrefix(cwd)} sh -c 'sleep 300 & sleep 300'`], { cwd, detached: true, stdio: 'ignore', env: runnerEnv() });
    const running = () => execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).split('\n').filter((l) => l.trim() === 'sleep 300').length;
    await expect.poll(running).toBe(2);
    endSandboxes();
    await expect.poll(running).toBe(0);
    shell.kill();
  });

  test("git runs in it as well: the session's changes are read from the checkout", async () => {
    const { head, readChanges } = await import('../push.service');
    const repo = join(home, 'work', 'git');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
    git('init', '-q');
    git('commit', '-q', '--allow-empty', '-m', 'pr 1');
    writeFileSync(join(repo, 'fix.ts'), 'x');
    expect(readChanges(repo, head(repo))).toEqual([{ path: 'fix.ts', mode: '100644', content: Buffer.from('x') }]);
  });
});

test("on OpenCode the prefix drops exactly the run's keys, and a project variable such as NPM_TOKEN still reaches the commands", () => {
  const p = sandboxPrefix('/w', ['OPENROUTER_API_KEY', 'HF_TOKEN']);
  expect(p).toContain("'-u' 'OPENROUTER_API_KEY' '-u' 'HF_TOKEN'");
  expect(p).not.toContain('NPM_TOKEN');
});
