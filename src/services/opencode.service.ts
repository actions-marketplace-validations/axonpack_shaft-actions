import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as core from '@actions/core';
import { DASHBOARD_URL } from '../consts/api.const';
import { ShaftFailure } from '../utils/failure.util';
import { runnerEnv } from '../utils/env.util';
import { guardrails, guardrailPrompt } from '../utils/guardrails.util';
import type { GuardOptions } from '../utils/opencode-guard.util';
import { addChildUsage, childUsageSql, emptyEvents, opencodePermission, opencodeTools, readEvent, replyJson, schemaPrompt } from '../utils/opencode-run.util';
import { SYSTEM_PROMPT } from '../abuse/abuse.const';
import type { OpencodeGrant } from './api.service';
import { type AgentOptions, ALLOWED, type Attempt, bashFailure, EDIT_TOOLS, READ_TOOLS, toolTarget } from './agent.service';
import { opencodeBinary } from './claude-binary.service';
import { shaftMcp } from './mcp-setup.service';
import { sandboxPrefix, which } from './sandbox.service';

let settings: OpencodeGrant | undefined;

/** The grant's OpenCode settings: once set, `runAgent` runs every session on OpenCode. */
export const opencodeSettings = () => settings;
export const setOpencode = (g: OpencodeGrant | undefined) => {
  settings = g;
};

/**
 * OpenCode's Grep and Glob run `rg`, and download ripgrep from GitHub unchecked when it isn't on the
 * PATH. So the action puts it there first, from the runner's signed Ubuntu archive as it does
 * bubblewrap, and refuses the run when it can't.
 */
function ensureRipgrep(): void {
  if (which('rg')) return;
  try {
    if (process.platform !== 'linux') throw new Error(`this ${process.platform} runner has no rg on its PATH`);
    core.info('Installing ripgrep, for OpenCode\'s search tools');
    for (const args of [['-n', 'apt-get', 'update', '-qq'], ['-n', 'env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', '-qq', '--no-install-recommends', 'ripgrep']]) {
      execFileSync('sudo', args, { stdio: 'pipe', timeout: 5 * 60_000 });
    }
    if (!which('rg')) throw new Error('rg still isn\'t on the PATH');
  } catch (e) {
    throw new ShaftFailure('opencode_unavailable', `OpenCode needs ripgrep (rg) on the runner, and it couldn't be installed: ${(e as Error).message}. Install ripgrep in the workflow before Axon Shaft runs.`);
  }
}

/**
 * The run's own OpenCode folders in RUNNER_TEMP, which the model's tools can't read: the config file
 * and the guard's marker, data, cache and state, and an empty, read-only global config folder, so
 * OpenCode finds no config or plugin of anyone else's and installs nothing there.
 */
export function runDir(): { dir: string; xdg: Record<string, string> } {
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'shaft-opencode-run');
  rmSync(dir, { recursive: true, force: true });
  const xdg = { XDG_CONFIG_HOME: join(dir, 'config'), XDG_DATA_HOME: join(dir, 'data'), XDG_CACHE_HOME: join(dir, 'cache'), XDG_STATE_HOME: join(dir, 'state') };
  for (const d of Object.values(xdg)) mkdirSync(d, { recursive: true, mode: 0o700 });
  // Read-only: OpenCode installs npm packages into these, and a provider SDK the binary doesn't carry
  // would be downloaded into `packages` and run. Without it, that provider fails instead.
  for (const d of [join(xdg.XDG_CONFIG_HOME, 'opencode'), join(xdg.XDG_CACHE_HOME, 'opencode', 'packages')]) {
    mkdirSync(d, { recursive: true });
    chmodSync(d, 0o500);
  }
  return { dir, xdg };
}

/**
 * OpenCode's environment: `runnerEnv` with the project's own names (never an `OPENCODE_` or `XDG_` one,
 * which would steer OpenCode itself), the provider keys, the run's folders, and the switches that keep
 * the PR's config, AGENTS.md, skills and Claude Code files out and stop any update, LSP or model-list download.
 */
export function opencodeEnv(g: OpencodeGrant, names: string[], xdg: Record<string, string>, config: string): Record<string, string> {
  return {
    ...runnerEnv(names.filter((n) => !/^(OPENCODE_|XDG_)/.test(n))),
    ...Object.fromEntries(g.keys.map((k) => [k.name, k.value])),
    ...Object.fromEntries(['RUNNER_TEMP', 'RUNNER_TOOL_CACHE'].flatMap((n) => (process.env[n] ? [[n, process.env[n]!]] : []))),
    ...xdg,
    OPENCODE_CONFIG: config,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
    OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    // The model list (and so each provider's npm package) from the pinned binary, never fetched.
    OPENCODE_DISABLE_MODELS_FETCH: '1',
  };
}

/** OpenCode's config for the run: the guard plugin first, the job's permissions, our agent with the system prompt and turn cap, the deep passes, and Shaft's MCP server. */
export function opencodeConfig(o: AgentOptions, g: OpencodeGrant, guard: GuardOptions, plugin: string): Record<string, unknown> {
  const deep = !!o.subagentModel && !!o.passes?.length;
  const mcp = shaftMcp();
  return {
    autoupdate: false,
    share: 'disabled',
    snapshot: false,
    formatter: false,
    lsp: false,
    instructions: [],
    plugin: [[pathToFileURL(plugin).href, guard]],
    permission: opencodePermission(guard.tools, { prefix: guard.prefix, passes: deep ? o.passes : [], mcp: !!mcp }),
    ...(mcp && { mcp: { shaft: { type: 'remote', url: mcp.url, headers: mcp.headers, oauth: false } } }),
    agent: {
      shaft: { mode: 'primary', model: g.model, prompt: SYSTEM_PROMPT + guardrailPrompt(), steps: o.maxTurns },
      ...(deep && Object.fromEntries(o.passes!.map((p) => [p.name, { mode: 'subagent', model: g.model, description: p.description, prompt: p.prompt }]))),
    },
  };
}

/** `opencode run`'s arguments: JSON events, our agent, the grant's model and its variant. The prompt goes on stdin. */
export const opencodeArgs = (g: OpencodeGrant): string[] => ['run', '--format', 'json', '--agent', 'shaft', '-m', g.model, ...(g.effort ? ['--variant', g.effort] : [])];

/**
 * One OpenCode session, as `runAgent`'s attempt: `opencode run` in the checkout, every tool call
 * checked by the guard plugin from this release, and the reply read from its last text. A run whose
 * guard never loaded is refused whatever it replied. The models are the grant's, never `o.model`.
 */
export async function runOpencode(prompt: string, o: AgentOptions, schema: Record<string, unknown>, controller: AbortController): Promise<Attempt> {
  const g = settings!;
  ensureRipgrep();
  const bin = opencodeBinary();
  const { dir, xdg } = runDir();
  const deep = !!o.subagentModel && !!o.passes?.length;
  const edit = !!o.commands;
  const claudeTools = o.tools ?? o.allowed ?? (deep ? [...ALLOWED, 'Agent'] : edit ? EDIT_TOOLS : READ_TOOLS);
  const marker = join(dir, 'guard-loaded');
  const stop = join(dir, 'provider-error');
  const guard: GuardOptions = {
    cwd: o.cwd,
    tools: opencodeTools(claudeTools, edit),
    ...(o.commands && { commands: o.commands, prefix: sandboxPrefix(o.cwd, g.keys.map((k) => k.name)) }),
    mcp: !!shaftMcp(),
    guardrails: guardrails(),
    marker,
    stop,
  };
  const config = join(dir, 'opencode.json');
  writeFileSync(config, JSON.stringify(opencodeConfig(o, g, guard, fileURLToPath(new URL('./opencode-guard.js', import.meta.url)))), { mode: 0o600 });

  const events = emptyEvents();
  const env = opencodeEnv(g, o.env ?? [], xdg, config);
  const child = spawn(bin, opencodeArgs(g), { cwd: o.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], signal: controller.signal });
  child.stdin.end(schemaPrompt(prompt, schema));
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-2000);
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  // The plugin writes `stop` when the provider refused the run in a way OpenCode would wait out: end it now.
  let refused: string | undefined;
  const watch = setInterval(() => {
    if (refused || !existsSync(stop)) return;
    refused = readFileSync(stop, 'utf8').slice(0, 500);
    child.kill('SIGKILL');
  }, 1000);
  let logged = 0;
  for await (const line of createInterface({ input: child.stdout })) {
    readEvent(line, events);
    for (const t of events.tools.slice(logged)) {
      core.info(`${t.tool} ${toolTarget(t.input)}`);
      if (t.tool === 'bash' && t.error !== undefined) core.info(bashFailure(toolTarget(t.input), t.error));
    }
    logged = events.tools.length;
  }
  const code = await exit.finally(() => clearInterval(watch));
  const providerError = (why: string) =>
    new ShaftFailure('opencode_provider_error', `OpenCode's provider refused the run, so nothing was posted: ${why.replace(/\.$/, '')}. Check the model and its keys or plan on the dashboard, then rerun the job.`, DASHBOARD_URL);
  if (refused) throw providerError(refused);
  // The deep passes' usage, from OpenCode's own database in the run's folder.
  const sql = deep ? childUsageSql(events.session) : undefined;
  if (sql) addChildUsage(spawnSync(bin, ['db', sql, '--format', 'json'], { cwd: o.cwd, env, encoding: 'utf8', timeout: 60_000 }).stdout ?? '', events);
  const spent = { models: [g.model], costUsd: events.costUsd, tokens: events.tokens };
  const output = replyJson(events.text);
  if (output && !existsSync(marker)) {
    throw new ShaftFailure('opencode_guard_missing', "OpenCode ran without Axon Shaft's tool guard loaded, so its reply wasn't used and nothing was posted. Rerun the job; the job log has OpenCode's output.");
  }
  if (output) return { spent, output };
  if (events.errors.length) throw providerError(events.errors.join('; '));
  if (code !== 0) return { spent, failed: `OpenCode exited with ${code}: ${events.errors.join('; ') || stderr.trim().split('\n').at(-1) || 'no output'}` };
  return { spent, why: 'no JSON object in its reply' };
}
