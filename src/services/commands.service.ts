import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runnerEnv } from '../utils/env.util';
import { inSandbox } from './sandbox.service';

/** The script and target names a task may run: tests, lint, type checks, builds and formatting. */
const CHECK_NAME = /^(test|lint|check|typecheck|types|tsc|build|format|fmt)([:._-][\w:.-]*)?$/;
/** The package manager a lock file names, and its install that changes nothing in the lock file. */
const LOCKS: [string, string, string][] = [
  ['bun.lock', 'bun', 'bun install --frozen-lockfile'],
  ['bun.lockb', 'bun', 'bun install --frozen-lockfile'],
  ['pnpm-lock.yaml', 'pnpm', 'pnpm install --frozen-lockfile'],
  ['yarn.lock', 'yarn', 'yarn install --frozen-lockfile'],
  ['package-lock.json', 'npm', 'npm ci'],
];

const read = (cwd: string, file: string) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), 'utf8') : undefined);

/**
 * The repo's own commands a task may run, read from the checkout before the session: the package
 * manager's install from its lock file and the `package.json` scripts named like a check, the same
 * names as `make` targets, and Cargo's and Go's own. Read once, so a script the model adds isn't one.
 */
export function repoCommands(cwd: string): string[] {
  const out: string[] = [];
  const pkg = read(cwd, 'package.json');
  if (pkg) {
    const [, pm, install] = LOCKS.find(([lock]) => existsSync(join(cwd, lock))) ?? ['', 'npm', 'npm install'];
    let scripts: Record<string, unknown> = {};
    try {
      scripts = JSON.parse(pkg).scripts ?? {};
    } catch {}
    out.push(install, ...Object.keys(scripts).filter((n) => CHECK_NAME.test(n)).map((n) => `${pm} run ${n}`));
  }
  const make = read(cwd, 'Makefile');
  if (make) out.push(...[...make.matchAll(/^([\w.-]+):/gm)].map((m) => m[1]).filter((t) => CHECK_NAME.test(t)).map((t) => `make ${t}`));
  if (read(cwd, 'Cargo.toml') !== undefined) out.push('cargo test', 'cargo check', 'cargo clippy', 'cargo fmt', 'cargo build');
  if (read(cwd, 'go.mod') !== undefined) out.push('go test', 'go vet', 'go build');
  return [...new Set(out)];
}

/** A check our code ran after the session, and the end of its output when it failed. */
export type CheckResult = { command: string; passed: boolean; output: string };

const CHECK_TIMEOUT = 10 * 60_000; // ponytail: per command; a slower suite fails its check

/**
 * Run one of the repo's commands in the checkout, in the sandbox (`inSandbox`), with only the
 * allowlisted environment and the project's own names (`runnerEnv`): no GitHub or Claude token, and
 * no other process to read one from. The caller checks the command first.
 */
export function runCheck(cwd: string, command: string, env: string[] = []): CheckResult {
  const [file, ...args] = command.split(/\s+/).map((a) => a.replace(/^['"]|['"]$/g, ''));
  try {
    inSandbox(cwd, file!, args, { env: runnerEnv(env), encoding: 'utf8', stdio: 'pipe', timeout: CHECK_TIMEOUT });
    return { command, passed: true, output: '' };
  } catch (e) {
    const { stdout = '', stderr = '', message } = e as { stdout?: string; stderr?: string; message: string };
    const output = `${stdout}${stderr}`.trim() || message;
    return { command, passed: false, output: output.split('\n').slice(-40).join('\n') };
  }
}
