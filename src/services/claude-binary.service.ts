import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import pkg from '../../package.json' with { type: 'json' };
import { CLAUDE_BINARIES, OPENCODE_BINARIES } from '../consts/claude-binary.const';
import { ShaftFailure } from '../utils/failure.util';

const SDK_VERSION = pkg.dependencies['@anthropic-ai/claude-agent-sdk'];
export const OPENCODE_VERSION = pkg.devDependencies['opencode-ai'];

/**
 * A native binary from a per-platform npm package `name@version`. dist/index.js can't carry it (hundreds
 * of MB), so on a runner we download the matching tarball into RUNNER_TEMP/`folder` and unpack it only
 * once its sha512 matches the one this release recorded from bun.lock (`binaries`). Each call starts
 * from an empty folder, so a binary something else left there is never run. `file` is the binary's
 * path in the package, and a mismatch or a platform with no hash is `code`.
 */
function npmBinary(o: { name: string; version: string; file: string; binaries: Record<string, string>; folder: string; code: string; label: string }): string {
  const file = `${o.name}/${o.file}`;
  try {
    return createRequire(import.meta.url).resolve(file); // running from source, with node_modules
  } catch {}
  const spec = `${o.name}@${o.version}`;
  const integrity = o.binaries[spec];
  if (!integrity) throw new ShaftFailure(o.code, `This release records no sha512 for ${spec}, so ${o.label} can't be installed on this runner's platform.`);
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), o.folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  core.info(`Installing ${spec}`);
  const [{ filename }] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', dir, spec], { encoding: 'utf8' }));
  const tarball = join(dir, filename);
  if (`sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}` !== integrity) {
    throw new ShaftFailure(o.code, `The ${spec} tarball npm downloaded doesn't match the sha512 this release records, so it wasn't unpacked or run. Check the runner's npm registry.`);
  }
  execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--prefix', dir, tarball], { stdio: 'inherit' });
  return join(dir, 'node_modules', file);
}

/** The Claude Code binary the Agent SDK runs. */
// ponytail: glibc only; a musl runner (Alpine) needs the -musl package
export const claudeBinary = (): string =>
  npmBinary({
    name: `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`,
    version: SDK_VERSION,
    file: `claude${process.platform === 'win32' ? '.exe' : ''}`,
    binaries: CLAUDE_BINARIES,
    folder: 'shaft-claude',
    code: 'claude_binary_unverified',
    label: 'Claude Code',
  });

/** The OpenCode binary, for a project on the OpenCode provider. */
// ponytail: glibc and AVX2 only; a musl or pre-AVX2 runner needs the -musl or -baseline package
export const opencodeBinary = (): string =>
  npmBinary({
    name: `opencode-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`,
    version: OPENCODE_VERSION,
    file: `bin/opencode${process.platform === 'win32' ? '.exe' : ''}`,
    binaries: OPENCODE_BINARIES,
    folder: 'shaft-opencode',
    code: 'opencode_binary_unverified',
    label: 'OpenCode',
  });

let configDir: string | undefined;

/** Claude Code's config folder for this run, once the action has written one (`addShaftMcp`); until then the CLI loads no settings at all. */
export const claudeConfigDir = () => configDir;
export const setClaudeConfigDir = (dir: string | undefined) => {
  configDir = dir;
};
