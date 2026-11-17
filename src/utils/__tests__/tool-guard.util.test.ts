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

test('insideCheckout follows symlinks', () => {
  expect(insideCheckout('src/a.ts', cwd)).toBe(true);
  expect(insideCheckout('hosts', cwd)).toBe(false);
});
