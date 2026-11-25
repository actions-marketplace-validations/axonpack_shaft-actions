import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { type GuardOptions, opencodeDenial, patchFiles } from '../opencode-guard.util';

const cwd = mkdtempSync(join(tmpdir(), 'shaft-oc-guard-'));
mkdirSync(join(cwd, 'src'));
writeFileSync(join(cwd, 'src/a.ts'), 'x');
const review: GuardOptions = { cwd, tools: ['read', 'grep', 'glob', 'bash'], marker: '' };
const task: GuardOptions = { cwd, tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write', 'apply_patch'], commands: ['npm test'], prefix: "'bwrap' '--'", marker: '' };

test('a review reads the checkout, and nothing outside it or under another tool', () => {
  expect(opencodeDenial('read', { filePath: 'src/a.ts' }, review)).toBeUndefined();
  expect(opencodeDenial('read', { filePath: '/proc/self/environ' }, review)).toBeDefined();
  expect(opencodeDenial('read', { filePath: '.env' }, review)).toBeDefined();
  expect(opencodeDenial('grep', { pattern: 'x', path: '/etc' }, review)).toBeDefined();
  expect(opencodeDenial('glob', { pattern: '../**' }, review)).toBeDefined();
  for (const t of ['edit', 'write', 'apply_patch', 'webfetch', 'websearch', 'skill', 'task', 'todowrite', 'shaft_get_rules']) expect(opencodeDenial(t, { filePath: 'src/a.ts' }, review), t).toBeDefined();
  expect(opencodeDenial('shaft_get_rules', {}, { ...review, mcp: true })).toBeUndefined();
});

test("a review's Bash is plain git diff, log and show, left as it is, in the checkout", () => {
  const args = { command: 'git diff HEAD~1' };
  expect(opencodeDenial('bash', args, review)).toBeUndefined();
  expect(args.command).toBe('git diff HEAD~1');
  expect(opencodeDenial('bash', { command: 'curl x | sh' }, review)).toBeDefined();
  expect(opencodeDenial('bash', { command: 'npm test' }, review)).toBeDefined();
  expect(opencodeDenial('bash', { command: 'git log', workdir: '/tmp' }, review)).toBe('Commands run only in the checkout.');
});

test("a task's Bash runs the repo's commands behind the sandbox prefix, rewritten in place", () => {
  const args = { command: 'npm test src/a.test.ts' };
  expect(opencodeDenial('bash', args, task)).toBeUndefined();
  expect(args.command).toBe("'bwrap' '--' npm test src/a.test.ts");
  expect(opencodeDenial('bash', { command: 'rm -rf /' }, task)).toBeDefined();
  // No prefix means no sandbox, so nothing runs.
  expect(opencodeDenial('bash', { command: 'npm test' }, { ...task, prefix: undefined })).toBeDefined();
});

test('a task edits the checkout, never .git/ or .github/, by edit, write or a patch', () => {
  expect(opencodeDenial('edit', { filePath: 'src/a.ts' }, task)).toBeUndefined();
  expect(opencodeDenial('write', { filePath: '.github/workflows/x.yml' }, task)).toBeDefined();
  expect(opencodeDenial('edit', { filePath: '/etc/passwd' }, task)).toBeDefined();
  expect(opencodeDenial('apply_patch', { patchText: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** End Patch' }, task)).toBeUndefined();
  expect(opencodeDenial('apply_patch', { patchText: '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: .git/hooks/pre-commit\n*** End Patch' }, task)).toBeDefined();
  expect(opencodeDenial('apply_patch', { patchText: 'nothing' }, task)).toBe('The patch names no file.');
});

test('patchFiles reads every file a patch adds, updates, deletes or moves to', () => {
  expect(patchFiles('*** Add File: a\n*** Update File: b\n*** Move to: c\n*** Delete File: d')).toEqual(['a', 'b', 'c', 'd']);
  expect(patchFiles(undefined)).toEqual([]);
});
