import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { type AgentDefinition, type EffortLevel, type HookCallback, type ModelUsage, type PreToolUseHookInput, query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import pkg from '../../package.json' with { type: 'json' };
import { DASHBOARD_URL } from '../consts/api.const';
import type { ClaudeToken, Pass } from './api.service';
import { ShaftFailure } from '../utils/failure.util';
import { type Gate, GATE_STATUSES, GATES_MAX, type Review, SEVERITIES, STEPS, TYPES, VERDICTS, type Walkthrough, WALKTHROUGH_MAX } from '../utils/render.util';
import { runnerEnv } from '../utils/env.util';
import { toolDenial } from '../utils/tool-guard.util';
import { sandboxPrefix } from './sandbox.service';

/** The JSON schema the model's reply must match (the plan's output). */
export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'type', 'confidence', 'headline', 'claim', 'impact', 'scope', 'findings', 'resolved', 'checked', 'not_checked'],
  properties: {
    verdict: { enum: VERDICTS },
    type: { enum: TYPES },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    headline: { type: 'string' },
    claim: { type: 'string' },
    impact: { type: 'string' },
    scope: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'step', 'file', 'line', 'title', 'body'],
        properties: {
          severity: { enum: SEVERITIES },
          step: { enum: STEPS },
          file: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          end_line: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          body: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    resolved: { type: 'array', items: { type: 'string' } },
    checked: { type: 'array', items: { enum: STEPS } },
    not_checked: { type: 'string' },
    walkthrough: {
      type: 'object',
      additionalProperties: false,
      required: ['areas'],
      properties: {
        areas: {
          type: 'array',
          maxItems: WALKTHROUGH_MAX.areas,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'files', 'summary'],
            properties: {
              name: { type: 'string' },
              files: { type: 'array', maxItems: WALKTHROUGH_MAX.files, items: { type: 'string' } },
              summary: { type: 'string' },
            },
          },
        },
        diagram: { type: 'string', maxLength: WALKTHROUGH_MAX.diagram },
      },
    },
    gates: {
      type: 'array',
      maxItems: GATES_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gate', 'status', 'reason'],
        properties: { gate: { type: 'string' }, status: { enum: GATE_STATUSES }, reason: { type: 'string' } },
      },
    },
  },
};

/**
 * `SCHEMA` with `steps` as the step keys the reply may use, for a job with checklists. With none (a run
 * for the merge gates alone), `step` is any string: an empty `enum` isn't a schema.
 */
export function reviewSchema(steps: string[]) {
  const step = steps.length ? { enum: steps } : { type: 'string' };
  const { findings, checked } = SCHEMA.properties;
  return {
    ...SCHEMA,
    properties: {
      ...SCHEMA.properties,
      findings: { ...findings, items: { ...findings.items, properties: { ...findings.items.properties, step } } },
      checked: { ...checked, items: step },
    },
  };
}

/**
 * The walkthrough as it may be posted, or nothing when it's malformed or over the limits: it's
 * extra, so a bad one never fails the review. A diagram that isn't a flowchart, could close its
 * code block, or has a `click` link is left out.
 */
export function parseWalkthrough(x: unknown): Walkthrough | undefined {
  const w = x as Walkthrough;
  const str = (s: unknown) => typeof s === 'string';
  const ok =
    Array.isArray(w?.areas) &&
    w.areas.length <= WALKTHROUGH_MAX.areas &&
    w.areas.every((a) => str(a?.name) && str(a.summary) && Array.isArray(a.files) && a.files.length <= WALKTHROUGH_MAX.files && a.files.every(str));
  if (!ok) return;
  const d = w.diagram;
  const diagram = str(d) && d!.length <= WALKTHROUGH_MAX.diagram && /^\s*(flowchart|graph)\b/.test(d!) && !d!.includes('```') && !/^\s*click\b/m.test(d!);
  return { areas: w.areas.map(({ name, files, summary }) => ({ name, files, summary })), ...(diagram && { diagram: d }) };
}

/** The well-formed gates of the reply; a malformed one is dropped, and the gates check counts it as not reported. */
export function parseGates(x: unknown): Gate[] | undefined {
  if (!Array.isArray(x)) return;
  return x
    .filter((g) => typeof g?.gate === 'string' && GATE_STATUSES.includes(g.status) && typeof g.reason === 'string')
    .map(({ gate, status, reason }) => ({ gate, status, reason }));
}

/** Our own check of the reply, so a bad one is retried instead of posted. */
export function parseReview(x: unknown): Review | undefined {
  const r = x as Review;
  if (!r || !VERDICTS.includes(r.verdict) || typeof r.headline !== 'string' || !Array.isArray(r.findings)) return;
  const ok = r.findings.every(
    (f) =>
      SEVERITIES.includes(f?.severity) &&
      typeof f.file === 'string' &&
      Number.isInteger(f.line) &&
      typeof f.title === 'string' &&
      typeof f.body === 'string',
  );
  if (!ok) return;
  const { walkthrough: _, gates: __, ...rest } = r;
  const walkthrough = parseWalkthrough(r.walkthrough);
  const gates = parseGates(r.gates);
  return {
    ...rest,
    ...(walkthrough && { walkthrough }),
    ...(gates && { gates }),
    // Only a script links a finding to a page; the model's text never picks where a link goes.
    findings: r.findings.map(({ url: _, ...f }) => f),
    resolved: Array.isArray(r.resolved) ? r.resolved : [],
    checked: Array.isArray(r.checked) ? r.checked.filter((c) => typeof c === 'string') : [],
    not_checked: r.not_checked ?? '',
  };
}

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const EDIT_TOOLS = [...READ_TOOLS, 'Edit', 'Write'];
const ALLOWED = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)'];
/** The CLI's own deny rules, on top of the hook below. `//` makes a rule path absolute. */
const DENIED = ['Read(//proc/**)', 'Read(//sys/**)'];

/**
 * Checks every tool call, the subagents' too, before the allow rules let it through: a hook runs
 * where `canUseTool` doesn't, since that is only asked about calls no rule allows. A task's Bash
 * command, once allowed, runs in the sandbox (`sandboxPrefix`), as the checks do.
 */
export const guard =
  (cwd: string, commands?: string[]): HookCallback =>
  async (input) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput;
    const args = (tool_input ?? {}) as Record<string, unknown>;
    const why = toolDenial(tool_name, args, cwd, commands);
    if (why) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } };
    if (!commands || tool_name !== 'Bash') return {};
    const updatedInput = { ...args, command: `${sandboxPrefix(cwd)} ${String(args.command).trim()}` };
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } };
  };
const SDK_VERSION = pkg.dependencies['@anthropic-ai/claude-agent-sdk'];

/**
 * The Agent SDK runs a native Claude Code binary from a per-platform npm package. dist/index.js
 * can't carry it (about 350 MB), so on a runner we install the matching one into RUNNER_TEMP.
 */
function claudeBinary(): string | undefined {
  const name = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
  const file = `${name}/claude${process.platform === 'win32' ? '.exe' : ''}`;
  try {
    return createRequire(import.meta.url).resolve(file); // running from source, with node_modules
  } catch {}
  // ponytail: glibc only; a musl runner (Alpine) needs the -musl package
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'shaft-claude');
  const bin = join(dir, 'node_modules', file);
  if (!existsSync(bin)) {
    core.info(`Installing ${name}@${SDK_VERSION}`);
    execFileSync('npm', ['install', '--no-save', '--no-package-lock', '--prefix', dir, `${name}@${SDK_VERSION}`], { stdio: 'inherit' });
  }
  return bin;
}

/**
 * The CLI's environment, which every command the model runs inherits: `ENV_ALLOW`, the project's own
 * `names` (never one `ENV_DENIED` matches) and the Claude token. Nothing else the runner holds (the
 * OIDC request token, the action's inputs, GITHUB_TOKEN) and no GitHub token of ours is there to
 * leak. The CLI scrubs the Claude token from the environment of what it runs. Background commands
 * are off, including the CLI's own move of a slow command to the background and its hand-off of
 * running ones at exit: repo code must never run while the CLI's file tools act.
 */
export function cliEnv(claude: ClaudeToken, names: string[] = []): Record<string, string | undefined> {
  return {
    ...runnerEnv(names),
    [claude.kind === 'oauth' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY']: claude.value,
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
    CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF: '1',
    CLAUDE_AGENT_SDK_CLIENT_APP: `shaft/${pkg.version}`,
  };
}

/** The deep review's subagents, one per pass from the dashboard: read-only tools, on the subagent model. */
export const deepAgents = (model: string, effort: EffortLevel, passes: Pass[]): Record<string, AgentDefinition> =>
  Object.fromEntries(passes.map(({ name, description, prompt }) => [name, { description, prompt, tools: ['Read', 'Grep', 'Glob'], model, effort }]));

export type AgentOptions = {
  claude: ClaudeToken;
  model: string;
  effort: string;
  /** Tried in order when the model is unavailable to this account. */
  fallbackModel?: string;
  subagentModel?: string;
  /** With `subagentModel`: the deep passes to run as subagents. */
  passes?: Pass[];
  maxTurns: number;
  timeoutMinutes: number;
  cwd: string;
  /** The project's own variables to pass through, by name. */
  env?: string[];
  /**
   * A task's: the repo's own commands (`repoCommands`). The session may then edit files in the
   * checkout and run these, each call still checked by the guard. No token is added for them.
   */
  commands?: string[];
};

/** What a run used, summed over its models, as `POST /v1/runs` takes it. */
export type Tokens = { input: number; output: number; cache_read: number; cache_write: number };
export type AgentResult<T> = { reply: T; models: string[]; costUsd: number; tokens: Tokens };

/** What the session must reply with: the JSON schema, our own check of it, and the job's name for the failure messages. */
export type ReplyFormat<T> = { name: string; schema: Record<string, unknown>; parse: (x: unknown) => T | undefined };
export const REVIEW_FORMAT: ReplyFormat<Review> = { name: 'review', schema: SCHEMA, parse: parseReview };

/** The SDK's per-model usage, added up. */
export const sumTokens = (usage: Record<string, ModelUsage>): Tokens =>
  Object.values(usage).reduce(
    (t, u) => ({
      input: t.input + u.inputTokens,
      output: t.output + u.outputTokens,
      cache_read: t.cache_read + u.cacheReadInputTokens,
      cache_write: t.cache_write + u.cacheCreationInputTokens,
    }),
    { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  );

/** What a tool call works on, for the log: the file, pattern, command or task, on one line. */
export function toolTarget(input: Record<string, unknown>): string {
  const v = input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.description ?? input.url ?? '';
  const line = String(v).replace(/\s+/g, ' ').trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

async function once(prompt: string, o: AgentOptions, schema: Record<string, unknown>, controller: AbortController): Promise<SDKResultMessage | undefined> {
  const deep = !!o.subagentModel && !!o.passes?.length;
  const edit = !!o.commands;
  let result: SDKResultMessage | undefined;
  // A deep pass's own tool calls name the pass, by the call that started it.
  const passes = new Map<string, string>();
  for await (const m of query({
    prompt,
    options: {
      cwd: o.cwd,
      model: o.model,
      effort: o.effort as EffortLevel,
      fallbackModel: o.fallbackModel,
      maxTurns: o.maxTurns,
      tools: deep ? [...READ_TOOLS, 'Agent'] : edit ? EDIT_TOOLS : READ_TOOLS,
      // A task's Bash runs the repo's commands, which no allow rule can list ahead, so no rule allows it:
      // only the guard's own allow lets a call through, and if the guard doesn't answer, dontAsk denies it.
      allowedTools: deep ? [...ALLOWED, 'Agent'] : edit ? EDIT_TOOLS.filter((t) => t !== 'Bash') : ALLOWED,
      disallowedTools: DENIED,
      hooks: { PreToolUse: [{ hooks: [guard(o.cwd, o.commands)] }] },
      permissionMode: 'dontAsk',
      // No project or user settings: a PR could otherwise add hooks or MCP servers that run its code.
      settingSources: [],
      persistSession: false,
      outputFormat: { type: 'json_schema', schema },
      agents: deep ? deepAgents(o.subagentModel!, o.effort as EffortLevel, o.passes!) : undefined,
      abortController: controller,
      env: cliEnv(o.claude, o.env),
      pathToClaudeCodeExecutable: claudeBinary(),
    },
  })) {
    if (m.type === 'result') result = m;
    if (m.type !== 'assistant') continue;
    for (const b of m.message.content) {
      if (b.type !== 'tool_use') continue;
      const input = (b.input ?? {}) as Record<string, unknown>;
      if (typeof input.subagent_type === 'string') passes.set(b.id, input.subagent_type);
      const who = m.parent_tool_use_id ? `[${passes.get(m.parent_tool_use_id) ?? 'pass'}] ` : '';
      core.info(`${who}${b.name} ${toolTarget(input)}`);
    }
  }
  return result;
}

/**
 * Run the session with read-only tools (a task's also edit and run the repo's commands), for a reply in `format`: the review's, or a job's own. A
 * reply that doesn't match the schema is retried once, then the run fails. Every failure comes out
 * as a `ShaftFailure` with a `review_*` code, whatever the job.
 */
export async function runAgent<T>(prompt: string, o: AgentOptions, format: ReplyFormat<T>): Promise<AgentResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMinutes * 60_000);
  try {
    for (let attempt = 1; ; attempt++) {
      const result = await once(prompt, o, format.schema, controller);
      if (result?.subtype === 'success') {
        const reply = format.parse(result.structured_output);
        if (reply) return { reply, models: Object.keys(result.modelUsage), costUsd: result.total_cost_usd, tokens: sumTokens(result.modelUsage) };
      } else if (result && result.subtype !== 'error_max_structured_output_retries') {
        throw new Error(`The Agent SDK run ended with ${result.subtype}: ${result.errors.join('; ')}`);
      }
      // Only the reply's field names: the job log is public on a public repo, and a finding's text mustn't reach it.
      const out = result?.subtype === 'success' ? result.structured_output : undefined;
      const what = result?.subtype === 'success' ? `its fields: ${Object.keys(out && typeof out === 'object' ? out : {}).join(', ') || 'none'}` : (result?.errors.join('; ') ?? 'no result');
      core.warning(`The reply didn't match the ${format.name} schema (attempt ${attempt}), ${what}`);
      if (attempt === 2) {
        throw new ShaftFailure('review_invalid_reply', `The model's reply didn't match the ${format.name} format twice, so nothing was posted. Rerun the job.`);
      }
    }
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ShaftFailure('review_timed_out', `The ${format.name} ran past its ${o.timeoutMinutes}-minute time limit. Raise the time limit on the dashboard, or rerun the job.`, DASHBOARD_URL);
    }
    if (e instanceof ShaftFailure) throw e;
    const why = (e instanceof Error ? e.message : String(e)).replace(/\.$/, '');
    throw new ShaftFailure('review_failed', `The ${format.name} failed: ${why}. Rerun the job; the job log has the details.`);
  } finally {
    clearTimeout(timer);
  }
}
