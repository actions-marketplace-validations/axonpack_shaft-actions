import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import pkg from '../../package.json' with { type: 'json' };
import { CLAUDE_BINARIES } from '../consts/claude-binary.const';
import { ShaftFailure } from '../utils/failure.util';

const SDK_VERSION = pkg.dependencies['@anthropic-ai/claude-agent-sdk'];

/**
 * The Agent SDK runs a native Claude Code binary from a per-platform npm package. dist/index.js
 * can't carry it (about 350 MB), so on a runner we download the matching tarball into RUNNER_TEMP
 * and unpack it only once its sha512 matches the one this release recorded from bun.lock. Each call
 * starts from an empty folder, so a binary something else left there is never run.
 */
export function claudeBinary(): string {
  const name = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const file = `${name}/claude${process.platform === 'win32' ? '.exe' : ''}`;
  try {
    return createRequire(import.meta.url).resolve(file); // running from source, with node_modules
  } catch {}
  // ponytail: glibc only; a musl runner (Alpine) needs the -musl package
  const spec = `${name}@${SDK_VERSION}`;
  const integrity = CLAUDE_BINARIES[spec];
  if (!integrity) throw new ShaftFailure('claude_binary_unverified', `This release records no sha512 for ${spec}, so Claude Code can't be installed on this runner's platform.`);
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'shaft-claude');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  core.info(`Installing ${spec}`);
  const [{ filename }] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir, spec], { encoding: 'utf8' }));
  const tarball = join(dir, filename);
  if (`sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}` !== integrity) {
    throw new ShaftFailure('claude_binary_unverified', `The ${spec} tarball npm downloaded doesn't match the sha512 this release records, so it wasn't unpacked or run. Check the runner's npm registry.`);
  }
  execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--prefix', dir, tarball], { stdio: 'inherit' });
  return join(dir, 'node_modules', file);
}
