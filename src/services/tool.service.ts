import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import * as core from '@actions/core';
import { TOOL_DOWNLOAD_MS, TOOL_MAX_BYTES, TOOL_MAX_OUTPUT, TOOL_RUN_MS, TOOLS, type Tool, type ToolName } from '../consts/tools.const';
import { runnerEnv } from '../utils/env.util';
import { inSandbox, prepareSandbox } from './sandbox.service';

const root = () => join(process.env.RUNNER_TEMP ?? tmpdir(), 'shaft-tools');

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'user-agent': 'axon-shaft-action' }, signal: AbortSignal.timeout(TOOL_DOWNLOAD_MS) });
  if (!res.ok || !res.body) throw new Error(`the download answered ${res.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > TOOL_MAX_BYTES) throw new Error('the download is bigger than any of these tools');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Download one of `TOOLS` from its own release into an empty folder under RUNNER_TEMP, and unpack
 * it only once its sha256 matches the one this release records. A mismatch throws before anything
 * is written, so it never runs. The program's path.
 */
async function install(name: ToolName): Promise<string> {
  const tool: Tool = TOOLS[name];
  const arch = process.arch as keyof Tool['assets'];
  if (process.platform !== 'linux' || !tool.assets[arch]) throw new Error(`${name} runs only on Linux runners on x64 or arm64, and this one is ${process.platform} ${process.arch}`);
  const { url, sha256 } = tool.assets[arch];
  core.info(`Installing ${name} ${tool.version}`);
  let bytes: Buffer;
  try {
    bytes = await download(url);
  } catch (e) {
    throw new Error(`${name} ${tool.version} couldn't be downloaded (${(e as Error).message})`);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(`the ${name} ${tool.version} download doesn't match the sha256 this release records, so it wasn't run`);
  }
  const dir = join(root(), `${name}-${tool.version}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const program = join(dir, tool.file);
  if (tool.archive === 'bin') writeFileSync(program, bytes);
  else {
    const archive = join(dir, `download.${tool.archive}`);
    writeFileSync(archive, bytes);
    execFileSync(tool.archive === 'zip' ? 'unzip' : 'tar', tool.archive === 'zip' ? ['-o', '-q', archive, tool.file, '-d', dir] : ['-xzf', archive, '-C', dir, tool.file], {
      stdio: 'pipe',
    });
    rmSync(archive);
  }
  chmodSync(program, 0o755);
  return program;
}

// Each tool is installed once a run, and the sandbox checked once.
const installed = new Map<ToolName, Promise<string>>();
let sandbox: string | undefined | null = null;

/**
 * Run a pinned linter on `files` (path to text): they're written to an empty work folder, and the
 * linter runs there in the sandbox, with no network, nothing it can write but its own temp folders,
 * the runner's allowed environment plus `env`, and a time and output cap. Its output and exit code;
 * a linter's own non-zero exit for its findings doesn't throw. Throws when it can't be installed,
 * the sandbox doesn't start, or it's killed.
 */
export async function runTool(name: ToolName, args: string[], files: Record<string, string>, env: Record<string, string> = {}) {
  if (!installed.has(name)) installed.set(name, install(name));
  const program = await installed.get(name)!.catch((e: Error) => {
    installed.delete(name);
    throw e;
  });
  mkdirSync(root(), { recursive: true });
  if (sandbox === null) sandbox = prepareSandbox(root());
  if (sandbox) throw new Error(`the sandbox the linters run in didn't start: ${sandbox}`);
  const work = mkdtempSync(join(root(), 'work-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      // Paths come from the diff and the checkout, always relative; anything else is never written.
      if (isAbsolute(path) || normalize(path).startsWith('..')) continue;
      mkdirSync(dirname(join(work, path)), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    try {
      const out = inSandbox(work, program, args, { encoding: 'utf8', env: { ...runnerEnv(), ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: TOOL_RUN_MS, maxBuffer: TOOL_MAX_OUTPUT }, { tool: dirname(program) });
      return { out, err: '', status: 0 };
    } catch (e) {
      const { status, stdout, stderr, signal } = e as { status: number | null; stdout?: string; stderr?: string; signal?: string };
      if (status === null || signal) throw new Error(`${name} was stopped (${signal ?? 'no exit code'}), after ${TOOL_RUN_MS / 1000} seconds or ${TOOL_MAX_OUTPUT / 1e6} MB of output at most`);
      return { out: stdout ?? '', err: stderr ?? '', status };
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The changed files (not removed) whose path matches `test`. */
export const changedFiles = (files: { filename: string; status: string }[], test: RegExp) => files.filter((f) => f.status !== 'removed' && test.test(f.filename)).map((f) => f.filename);

/** Each path's text from the checkout, leaving out what it can't read. */
export const readAll = (checkout: { read: (path: string) => string | undefined }, paths: string[]) =>
  Object.fromEntries(paths.flatMap((p) => (checkout.read(p) === undefined ? [] : [[p, checkout.read(p)!]])));

/** A linter's JSON report, or an error with what it printed instead. */
export function report(name: string, run: { out: string; err: string }): any {
  try {
    return JSON.parse(run.out.trim() || 'null');
  } catch {
    throw new Error(`${name} gave no report: ${(run.err.trim() || run.out.trim()).slice(0, 300)}`);
  }
}
