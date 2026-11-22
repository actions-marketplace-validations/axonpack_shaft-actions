import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';

// A fake release: a program as a bare file, and the same program in a .tar.gz.
const dir = mkdtempSync(join(tmpdir(), 'shaft-tool-'));
const program = Buffer.from('#!/bin/sh\necho linted\n');
mkdirSync(join(dir, 'pack'));
writeFileSync(join(dir, 'pack', 'lint'), program);
execFileSync('tar', ['-czf', join(dir, 'lint.tar.gz'), '-C', join(dir, 'pack'), 'lint']);
const tarball = readFileSync(join(dir, 'lint.tar.gz'));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const asset = (url: string, bytes: Buffer) => ({ x64: { url, sha256: sha(bytes) }, arm64: { url, sha256: sha(bytes) } });

vi.mock('@actions/core', () => ({ info: () => {} }));
vi.mock('../../consts/tools.const', () => ({
  TOOLS: {
    hadolint: { version: '1.0.0', archive: 'bin', file: 'hadolint', assets: asset('https://github.com/x/hadolint/releases/download/v1.0.0/hadolint', program) },
    actionlint: { version: '2.0.0', archive: 'tar.gz', file: 'lint', assets: asset('https://github.com/x/lint/releases/download/v2.0.0/lint.tar.gz', tarball) },
    // The release records another hash than the one the download has.
    squawk: { version: '3.0.0', archive: 'bin', file: 'squawk', assets: asset('https://github.com/x/squawk/releases/download/v3.0.0/squawk', Buffer.from('the real one')) },
  },
  TOOL_MAX_BYTES: 1000,
  TOOL_DOWNLOAD_MS: 1000,
  TOOL_RUN_MS: 1000,
  TOOL_MAX_OUTPUT: 1000,
}));
/** What the fake sandbox ran: the program, its arguments, the work folder's files then, and the read-only tool folder. */
const ran: { program: string; args: string[]; files: string[]; tool?: string; env: Record<string, string> }[] = [];
let exit: { status: number; stdout: string } | undefined;
vi.mock('../sandbox.service', () => ({
  prepareSandbox: () => undefined,
  inSandbox: (cwd: string, program: string, args: string[], o: { env: Record<string, string> }, readOnly?: { tool: string }) => {
    ran.push({ program, args, files: readdirSync(cwd, { recursive: true }).map(String).sort(), tool: readOnly?.tool, env: o.env });
    if (exit) throw Object.assign(new Error('exit'), { ...exit, stderr: '' });
    return '[]';
  },
}));
const { runTool } = await import('../tool.service');

const downloads: string[] = [];
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
beforeEach(() => {
  [ran.length, downloads.length, exit] = [0, 0, undefined];
  process.env.RUNNER_TEMP = join(dir, 'temp');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  vi.stubGlobal('fetch', async (url: string) => {
    downloads.push(url);
    return new Response(url.endsWith('.tar.gz') ? tarball : url.endsWith('/squawk') ? 'something else' : program);
  });
});
afterAll(() => {
  Object.defineProperty(process, 'platform', platform);
  vi.unstubAllGlobals();
});

test('a pinned tool is downloaded from its release once a run, checked against its sha256, and run read-only in the sandbox on the given files', async () => {
  const run = await runTool('hadolint', ['--format', 'json', 'Dockerfile'], { Dockerfile: 'FROM node', 'deep/.hadolint.yaml': 'x', '../escape': 'no', '/abs': 'no' }, { EXTRA: '1' });
  expect(run).toEqual({ out: '[]', err: '', status: 0 });
  const installed = join(dir, 'temp', 'shaft-tools', 'hadolint-1.0.0', 'hadolint');
  expect(readFileSync(installed)).toEqual(program);
  expect(statSync(installed).mode & 0o777).toBe(0o755);
  expect(ran).toEqual([{ program: installed, args: ['--format', 'json', 'Dockerfile'], files: ['Dockerfile', 'deep', 'deep/.hadolint.yaml'], tool: join(dir, 'temp', 'shaft-tools', 'hadolint-1.0.0'), env: expect.objectContaining({ EXTRA: '1' }) }]);
  // The work folder is gone after the run, and a second run doesn't download again.
  expect(readdirSync(join(dir, 'temp', 'shaft-tools')).filter((d) => d.startsWith('work-'))).toEqual([]);
  await runTool('hadolint', [], {});
  expect(downloads).toEqual(['https://github.com/x/hadolint/releases/download/v1.0.0/hadolint']);
});

test("a .tar.gz is unpacked once it matches, and a linter's own non-zero exit for its findings comes back as its report", async () => {
  exit = { status: 1, stdout: '[{"line":3}]' };
  expect(await runTool('actionlint', [], {})).toEqual({ out: '[{"line":3}]', err: '', status: 1 });
  expect(readFileSync(join(dir, 'temp', 'shaft-tools', 'actionlint-2.0.0', 'lint'))).toEqual(program);
  expect(existsSync(join(dir, 'temp', 'shaft-tools', 'actionlint-2.0.0', 'download.tar.gz'))).toBe(false);
});

test("a download that doesn't match the recorded sha256 is refused: nothing is written and nothing runs", async () => {
  await expect(runTool('squawk', [], {})).rejects.toThrow("the squawk 3.0.0 download doesn't match the sha256 this release records, so it wasn't run");
  expect(existsSync(join(dir, 'temp', 'shaft-tools', 'squawk-3.0.0'))).toBe(false);
  expect(ran).toEqual([]);
  // A failed install isn't kept, so the next checklist tries again, and is refused again.
  await expect(runTool('squawk', [], {})).rejects.toThrow("doesn't match");
  expect(downloads).toHaveLength(2);
});

test('off Linux, nothing is downloaded or run', async () => {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  await expect(runTool('buf' as 'hadolint', [], {})).rejects.toThrow(/runs only on Linux runners on x64 or arm64, and this one is darwin/);
  expect(downloads).toEqual([]);
});
