import { type ExecFileSyncOptions, execFileSync } from 'node:child_process';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import * as core from '@actions/core';
import { runnerEnv } from '../utils/env.util';

/** The oldest bubblewrap with every option below. Ubuntu 22.04 has 0.6.1, 24.04 has 0.9.0. */
const BWRAP_MIN = [0, 6];

const under = (path: string, dir: string) => !relative(dir, path).startsWith('..') && !isAbsolute(relative(dir, path));

/**
 * The programs the sandbox needs, by absolute path: `prepareSandbox` finds them on the PATH before
 * any repo code runs, and nothing looks them up again, so a program the session or the checks put
 * on the PATH later is never the one that runs. A task never runs without `prepareSandbox`; the
 * bare names are for the tests off Linux.
 */
const bin = { bwrap: 'bwrap', env: 'env', pkill: 'pkill' };

/** The first executable file called `name` in an absolute PATH folder. */
export function which(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(':').filter((d) => isAbsolute(d))) {
    try {
      const file = join(dir, name);
      accessSync(file, constants.X_OK);
      if (statSync(file).isFile()) return file;
    } catch {}
  }
}

/**
 * bubblewrap's options for a task's commands: its own PID namespace and `/proc`, so no process
 * outside it (the runner, the CLI, the action) can be seen, read or traced; no-new-privs, which
 * bubblewrap always sets, so no `sudo`; every capability dropped, for a runner that runs as root;
 * the whole system read-only, with the home folder, `/tmp`, `/run` (the Docker socket) and the
 * runner's temp folder replaced by empty ones, and the checkout the only folder it can write. A
 * tool folder under home on the PATH stays, read-only, unless it is home or holds the temp folder.
 * The network stays, for the install.
 */
export function sandboxArgs(cwd: string): string[] {
  const home = process.env.HOME || homedir();
  const temp = process.env.RUNNER_TEMP;
  const hidden = temp && !under(temp, home) ? [home, temp] : [home];
  // Never home itself, nor a folder that holds the runner's temp folder: either would show what the tmpfs hides.
  const tools = (process.env.PATH ?? '')
    .split(':')
    .filter((p) => isAbsolute(p) && under(p, home) && relative(home, p) !== '' && !(temp && under(temp, p)) && !under(p, cwd) && existsSync(p));
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
  execFileSync(bin.bwrap, [...sandboxArgs(cwd), '--', file, ...args], { ...o, cwd });

/**
 * What the model's Bash command is prefixed with, every word quoted for the shell. bubblewrap starts
 * without the Claude token, which the CLI already keeps out of its commands, so not even its own
 * process in the sandbox holds it.
 */
export const sandboxPrefix = (cwd: string): string =>
  [bin.env, '-u', 'ANTHROPIC_API_KEY', '-u', 'CLAUDE_CODE_OAUTH_TOKEN', bin.bwrap, ...sandboxArgs(cwd), '--'].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');

/**
 * Kill every sandbox still running, and so everything in it: with `--die-with-parent` and its own
 * PID namespace, bubblewrap takes all it started down with it. The CLI starts each shell in a
 * process group of its own, so killing the CLI's group wouldn't reach them. A task runs only on a
 * GitHub-hosted runner, where every bubblewrap of this user is the action's.
 */
export function endSandboxes(): void {
  try {
    execFileSync(bin.pkill, ['-KILL', '-u', String(process.getuid?.()), '-x', 'bwrap'], { stdio: 'ignore' });
  } catch {} // pkill exits 1 when none was running
}

/**
 * Make sure the sandbox starts: on Linux, install bubblewrap from the runner's Ubuntu archive when
 * it's missing (with `sudo -n`, as a hosted runner allows), find the programs in `bin`, check
 * bubblewrap's version, and run `true` in it. Why it can't, or undefined when it can. A task never runs its commands without it.
 */
export function prepareSandbox(cwd: string): string | undefined {
  if (process.platform !== 'linux') return `A change needs a Linux runner, for its sandbox. This one runs ${process.platform}.`;
  const run = (file: string, args: string[]) => execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', timeout: 5 * 60_000 });
  try {
    if (!which('bwrap')) {
      core.info('Installing bubblewrap, for the sandbox the change runs in');
      run('sudo', ['-n', 'apt-get', 'update', '-qq']);
      run('sudo', ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '-qq', '--no-install-recommends', 'bubblewrap']);
    }
    for (const name of Object.keys(bin) as (keyof typeof bin)[]) {
      const path = which(name);
      if (!path) return `The runner has no ${name} on its PATH, and the sandbox needs it, so nothing was changed.`;
      bin[name] = path;
    }
    const version = /(\d+)\.(\d+)/.exec(run(bin.bwrap, ['--version']))?.slice(1).map(Number) ?? [0, 0];
    if (version[0]! < BWRAP_MIN[0]! || (version[0] === BWRAP_MIN[0] && version[1]! < BWRAP_MIN[1]!)) {
      return `The runner has bubblewrap ${version.join('.')}, and the sandbox needs ${BWRAP_MIN.join('.')} or later.`;
    }
    inSandbox(cwd, 'true', [], { env: runnerEnv(), encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    const out = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
    return `The sandbox didn't start on this runner, so nothing was changed. Install bubblewrap 0.6 or later and allow unprivileged user namespaces: ${out}`;
  }
}
