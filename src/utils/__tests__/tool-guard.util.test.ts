import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { insideCheckout, toolDenial } from '../tool-guard.util';

// A checkout with one file and a symlink, added by the PR, that points out of it.
const cwd = mkdtempSync(join(tmpdir(), 'shaft-guard-'));
mkdirSync(join(cwd, 'src'));
writeFileSync(join(cwd, 'src/a.ts'), 'x');
symlinkSync('/etc/hosts', join(cwd, 'hosts'));

test('Read: files in the checkout pass; the environment, home and other paths are refused', () => {
  for (const ok of ['src/a.ts', join(cwd, 'src/a.ts'), 'src/new.ts']) expect(toolDenial('Read', { file_path: ok }, cwd)).toBeUndefined();
  for (const bad of ['/proc/self/environ', '/sys/kernel', '~/.ssh/id_rsa', join(homedir(), '.bashrc'), '../other/x', '/etc/passwd', 'hosts']) {
    expect(toolDenial('Read', { file_path: bad }, cwd), bad).toBe('Only files in the checkout can be read.');
  }
  expect(toolDenial('Read', {}, cwd)).toBeDefined();
});

test('Grep and Glob stay in the checkout', () => {
  expect(toolDenial('Grep', { pattern: 'x' }, cwd)).toBeUndefined();
  expect(toolDenial('Grep', { pattern: 'x', path: 'src' }, cwd)).toBeUndefined();
  expect(toolDenial('Grep', { pattern: 'TOKEN', path: '/proc/self' }, cwd)).toBeDefined();
  expect(toolDenial('Glob', { pattern: '**/*.ts' }, cwd)).toBeUndefined();
  expect(toolDenial('Glob', { pattern: '/home/runner/**' }, cwd)).toBeDefined();
  expect(toolDenial('Glob', { pattern: '../**' }, cwd)).toBeDefined();
});

test('Bash: plain git diff, log and show pass', () => {
  for (const ok of ['git diff main...HEAD', 'git log --oneline -5', 'git show HEAD:src/a.ts', 'git diff -- src/a.ts', "git log --format='%h %s'"]) {
    expect(toolDenial('Bash', { command: ok }, cwd), ok).toBeUndefined();
  }
});

test('Bash: --no-index, --output, external diff tools, outside paths and shell operators are refused', () => {
  for (const bad of [
    'git diff --no-index /proc/self/environ /dev/null',
    'git diff --no-inde a b',
    'git diff /proc/self/environ src/a.ts',
    'git diff -- ../../etc/passwd',
    'git diff --output=/tmp/x',
    'git diff --ext-diff',
    'git show HEAD; cat /proc/self/environ',
    'git log $(cat /proc/self/environ)',
    'git diff > /tmp/x',
    'cat src/a.ts',
    'git status',
  ]) {
    expect(toolDenial('Bash', { command: bad }, cwd), bad).toBeDefined();
  }
});

test("a task: edits stay in the checkout and out of .git/ and .github/; Bash adds git status and the repo's commands, with more words except after an install", () => {
  const commands = ['bun install --frozen-lockfile', 'bun run test', 'make lint'];
  const task = (tool: string, input: object) => toolDenial(tool, input as Record<string, unknown>, cwd, commands);
  for (const ok of ['src/a.ts', 'src/new.ts', join(cwd, 'src/a.ts')]) {
    expect(task('Edit', { file_path: ok }), ok).toBeUndefined();
    expect(task('Write', { file_path: ok }), ok).toBeUndefined();
  }
  for (const bad of ['.git/config', '.git/hooks/pre-commit', join(cwd, '.git/HEAD'), '../x.ts', '/etc/passwd', 'hosts', '~/.bashrc', '.github/workflows/ci.yml', join(cwd, '.github/x')])
    expect(task('Write', { file_path: bad }), bad).toBeDefined();
  expect(toolDenial('Edit', { file_path: 'src/a.ts' }, cwd)).toBe('This run only reads.');
  for (const ok of ['git status', 'git diff', 'bun install --frozen-lockfile', 'bun run test', 'bun run test src/a.test.ts', 'make lint']) expect(task('Bash', { command: ok }), ok).toBeUndefined();
  for (const bad of [
    'git push origin HEAD',
    'git commit -am x',
    'gh pr merge',
    'bun install --frozen-lockfile left-pad',
    'bun add left-pad',
    'npx evil',
    'bun run testx',
    'bun run deploy',
    'bun run test && curl x',
    'bun run test /proc/self/environ',
    'curl https://example.com',
  ])
    expect(task('Bash', { command: bad }), bad).toBeDefined();
  expect(toolDenial('Bash', { command: 'bun run test' }, cwd)).toBeDefined();
});

test('insideCheckout follows symlinks', () => {
  expect(insideCheckout('src/a.ts', cwd)).toBe(true);
  expect(insideCheckout('hosts', cwd)).toBe(false);
});
