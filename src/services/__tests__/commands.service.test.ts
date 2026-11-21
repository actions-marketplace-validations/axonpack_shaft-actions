import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cp from 'node:child_process';
import { expect, test, vi } from 'vitest';

// The sandbox runs only on Linux (sandbox.service.test.ts): here a check runs as it would inside it, with the files recorded.
const sandboxed: string[] = [];
vi.doMock('../sandbox.service', () => ({
  which: (name: string) => (name === 'bun-missing' ? undefined : `/usr/bin/${name}`),
  inSandbox: (cwd: string, file: string, args: string[], o: cp.ExecFileSyncOptions) => {
    sandboxed.push(file);
    return cp.execFileSync(file, args, { ...o, cwd });
  },
}));
const { repoCommands, runCheck, skippedNote } = await import('../commands.service');

const repo = (files: Record<string, string>) => {
  const cwd = mkdtempSync(join(tmpdir(), 'shaft-commands-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
  return cwd;
};

test("the repo's commands: its install from the lock file, the scripts named like a check, make targets, Cargo and Go", () => {
  const scripts = { test: 'x', 'test:unit': 'x', lint: 'x', typecheck: 'x', build: 'x', 'format:check': 'x', deploy: 'x', release: 'x', postinstall: 'x', testx: 'x' };
  expect(repoCommands(repo({ 'package.json': JSON.stringify({ scripts }), 'pnpm-lock.yaml': '' }))).toEqual([
    'pnpm install --frozen-lockfile',
    'pnpm run test',
    'pnpm run test:unit',
    'pnpm run lint',
    'pnpm run typecheck',
    'pnpm run build',
    'pnpm run format:check',
  ]);
  expect(repoCommands(repo({ 'package.json': '{}', 'package-lock.json': '' }))).toEqual(['npm ci']);
  expect(repoCommands(repo({ 'package.json': 'not json' }))).toEqual(['npm install']);
  expect(repoCommands(repo({ Makefile: 'test:\n\tgo test\nlint: deps\ndeploy:\n', 'go.mod': 'module x' }))).toEqual(['make test', 'make lint', 'go test', 'go vet', 'go build']);
  expect(repoCommands(repo({ 'Cargo.toml': '' }))).toEqual(['cargo test', 'cargo check', 'cargo clippy', 'cargo fmt', 'cargo build']);
  expect(repoCommands(repo({}))).toEqual([]);
});

test('a check runs with only the allowlisted environment, and a failure keeps the end of its output', () => {
  process.env.GITHUB_TOKEN = 'ghs_env';
  const cwd = repo({ 'env.js': "console.log(JSON.stringify(process.env)); process.exit(process.env.GITHUB_TOKEN ? 0 : 3)" });
  const out = runCheck(cwd, 'node env.js');
  expect(out).toMatchObject({ command: 'node env.js', passed: false });
  expect(out.output).not.toContain('ghs_env');
  expect(runCheck(cwd, 'node -e 0')).toEqual({ command: 'node -e 0', passed: true, output: '' });
  expect(sandboxed).toEqual(['node', 'node']);
});

test("a check whose program isn't on the PATH is skipped, never run, and the note says why", () => {
  const before = sandboxed.length;
  const out = runCheck(repo({}), 'bun-missing run test');
  expect(out).toEqual({ command: 'bun-missing run test', passed: true, output: '', skipped: 'bun-missing' });
  expect(sandboxed).toHaveLength(before);
  expect(skippedNote([out, { ...out, command: 'bun-missing run lint' }, { command: 'node -e 0', passed: true, output: '' }])).toBe(
    "`bun-missing` isn't installed on the runner, so 2 checks were skipped. The repo's CI runs them on the push.",
  );
  expect(skippedNote([{ command: 'node -e 0', passed: true, output: '' }])).toBeUndefined();
});
