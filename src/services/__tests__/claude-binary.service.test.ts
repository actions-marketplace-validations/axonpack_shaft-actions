import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import pkg from '../../../package.json' with { type: 'json' };

const version = pkg.dependencies['@anthropic-ai/claude-agent-sdk'];
const spec = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}@${version}`;
const sha512 = (s: string) => `sha512-${createHash('sha512').update(s).digest('base64')}`;

// npm is faked: `pack` writes a tarball holding "tarball", and every command line is recorded.
const calls: string[][] = [];
vi.doMock('node:child_process', () => ({
  execFileSync: (_file: string, args: string[]) => {
    calls.push(args);
    if (args[0] !== 'pack') return '';
    writeFileSync(join(args[args.indexOf('--pack-destination') + 1], 'claude.tgz'), 'tarball');
    return JSON.stringify([{ filename: 'claude.tgz' }]);
  },
}));
// The platform package isn't in node_modules, as on a runner.
vi.doMock('node:module', async (original) => ({
  ...(await original<typeof import('node:module')>()),
  createRequire: () => ({
    resolve: () => {
      throw new Error('Cannot find module');
    },
  }),
}));
vi.doMock('@actions/core', () => ({ info: () => {} }));
const recorded: Record<string, string> = {};
vi.doMock('../../consts/claude-binary.const', () => ({ CLAUDE_BINARIES: recorded, OPENCODE_BINARIES: recorded }));
const { claudeBinary, opencodeBinary } = await import('../claude-binary.service');

const temp = mkdtempSync(join(tmpdir(), 'shaft-claude-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));
process.env.RUNNER_TEMP = temp;
const dir = join(temp, 'shaft-claude');

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(recorded)) delete recorded[k];
});

test('a tarball that matches the recorded sha512 is installed, and the binary is returned', () => {
  recorded[spec] = sha512('tarball');
  // A binary already in the folder is thrown away, never run.
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'planted'), '');
  const bin = claudeBinary();
  expect(bin).toBe(join(dir, 'node_modules', spec.slice(0, spec.lastIndexOf('@')), process.platform === 'win32' ? 'claude.exe' : 'claude'));
  expect(existsSync(join(dir, 'planted'))).toBe(false);
  expect(calls).toEqual([
    ['pack', '--json', '--pack-destination', dir, spec],
    ['install', '--no-save', '--no-package-lock', '--prefix', dir, join(dir, 'claude.tgz')],
  ]);
});

test('a tarball that misses the recorded sha512 is claude_binary_unverified, and is never unpacked', () => {
  recorded[spec] = sha512('another tarball');
  expect(claudeBinary).toThrow(expect.objectContaining({ code: 'claude_binary_unverified' }));
  expect(calls.map((c) => c[0])).toEqual(['pack']);
});

test('a platform with no recorded sha512 is claude_binary_unverified, and npm never runs', () => {
  recorded[`${spec}0`] = sha512('tarball');
  expect(claudeBinary).toThrow(expect.objectContaining({ code: 'claude_binary_unverified', message: expect.stringContaining(spec) }));
  expect(calls).toEqual([]);
});

test('the build records a sha512 for each platform the action installs on, at the SDK version', async () => {
  const { CLAUDE_BINARIES } = await vi.importActual<typeof import('../../consts/claude-binary.const')>('../../consts/claude-binary.const');
  for (const p of ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']) {
    expect(CLAUDE_BINARIES[`@anthropic-ai/claude-agent-sdk-${p}@${version}`]).toMatch(/^sha512-[A-Za-z0-9+/]{86}==$/);
  }
});

test('OpenCode comes from its own platform package, checked against its recorded sha512 the same way', () => {
  const name = `opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const ocSpec = `${name}@${pkg.devDependencies['opencode-ai']}`;
  expect(() => opencodeBinary()).toThrow(expect.objectContaining({ code: 'opencode_binary_unverified' }));
  recorded[ocSpec] = sha512('tarball');
  const ocDir = join(temp, 'shaft-opencode');
  expect(opencodeBinary()).toBe(join(ocDir, 'node_modules', name, 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode'));
  expect(calls[0]).toEqual(['pack', '--json', '--pack-destination', ocDir, ocSpec]);
  recorded[ocSpec] = sha512('other');
  expect(() => opencodeBinary()).toThrow(expect.objectContaining({ code: 'opencode_binary_unverified' }));
});
