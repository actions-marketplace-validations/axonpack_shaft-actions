import { type ExecFileSyncOptions, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative } from 'node:path';
import * as core from '@actions/core';
import { runnerEnv } from '../utils/env.util';

/** The oldest bubblewrap with every option below. Ubuntu 22.04 has 0.6.1, 24.04 has 0.9.0. */
const BWRAP_MIN = [0, 6];

const under = (path: string, dir: string) => !relative(dir, path).startsWith('..') && !isAbsolute(relative(dir, path));

/**
 * bubblewrap's options for a task's commands: its own PID namespace and `/proc`, so no process
 * outside it (the runner, the CLI, the action) can be seen, read or traced; no-new-privs, which
 * bubblewrap always sets, so no `sudo`; every capability dropped, for a runner that runs as root;
 * the whole system read-only, with the home folder, `/tmp`, `/run` (the Docker socket) and the
 * runner's temp folder replaced by empty ones, and the checkout the only folder it can write. A
 * tool installed under home stays on the PATH, read-only. The network stays, for the install.
 */
export function sandboxArgs(cwd: string): string[] {
  const home = process.env.HOME || homedir();
  const temp = process.env.RUNNER_TEMP;
  const hidden = temp && !under(temp, home) ? [home, temp] : [home];
  const tools = (process.env.PATH ?? '').split(':').filter((p) => isAbsolute(p) && under(p, home) && !under(p, cwd) && existsSync(p));
  return [
    '--die-with-parent',
    '--new-session',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--unshare-cgroup-try',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    '/',
    '/',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--tmpfs',
    '/run',
    ...hidden.flatMap((d) => ['--tmpfs', d]),
    ...tools.flatMap((p) => ['--ro-bind', p, p]),
    '--bind',
    cwd,
    cwd,
    '--chdir',
    cwd,
    '--setenv',
    'HOME',
    home,
    '--setenv',
    'TMPDIR',
    '/tmp',
  ];
}

/** Run `file` in the sandbox at `cwd`. Throws as `execFileSync` does. */
export const inSandbox = (cwd: string, file: string, args: string[], o: ExecFileSyncOptions & { encoding: 'utf8' }): string =>
  execFileSync('bwrap', [...sandboxArgs(cwd), '--', file, ...args], { ...o, cwd });

/**
 * What the model's Bash command is prefixed with, every word quoted for the shell. bubblewrap starts
 * without the Claude token, which the CLI already keeps out of its commands, so not even its own
 * process in the sandbox holds it.
 */
export const sandboxPrefix = (cwd: string): string =>
  ['env', '-u', 'ANTHROPIC_API_KEY', '-u', 'CLAUDE_CODE_OAUTH_TOKEN', 'bwrap', ...sandboxArgs(cwd), '--'].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');

/**
 * Make sure the sandbox starts: on Linux, install bubblewrap from the runner's Ubuntu archive when
 * it's missing (with `sudo -n`, as a hosted runner allows), check its version, and run `true` in
 * it. Why it can't, or undefined when it can. A task never runs its commands without it.
 */
export function prepareSandbox(cwd: string): string | undefined {
  if (process.platform !== 'linux') return `A change needs a Linux runner, for its sandbox. This one runs ${process.platform}.`;
  const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', timeout: 5 * 60_000 });
  try {
    try {
      run('bwrap', ['--version']);
    } catch {
      core.info('Installing bubblewrap, for the sandbox the change runs in');
      run('sudo', ['-n', 'apt-get', 'update', '-qq']);
      run('sudo', ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '-qq', '--no-install-recommends', 'bubblewrap']);
    }
    const version = /(\d+)\.(\d+)/.exec(run('bwrap', ['--version']))?.slice(1).map(Number) ?? [0, 0];
    if (version[0]! < BWRAP_MIN[0]! || (version[0] === BWRAP_MIN[0] && version[1]! < BWRAP_MIN[1]!)) {
      return `The runner has bubblewrap ${version.join('.')}, and the sandbox needs ${BWRAP_MIN.join('.')} or later.`;
    }
    inSandbox(cwd, 'true', [], { env: runnerEnv(), encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    const out = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
    return `The sandbox didn't start on this runner, so nothing was changed. Install bubblewrap 0.6 or later and allow unprivileged user namespaces: ${out}`;
  }
}
