import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { type AgentDefinition, type EffortLevel, type HookCallback, type PreToolUseHookInput, query, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import pkg from '../../package.json' with { type: 'json' };
import { DASHBOARD_URL } from '../consts/api.const';
import type { ClaudeToken, Pass } from './api.service';
import { ShaftFailure } from '../utils/failure.util';
import { type Review, SEVERITIES, STEPS, TYPES, VERDICTS } from '../utils/render.util';
import { toolDenial } from '../utils/tool-guard.util';

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
  },
};

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
  return {
    ...r,
    resolved: Array.isArray(r.resolved) ? r.resolved : [],
    checked: Array.isArray(r.checked) ? r.checked.filter((c) => typeof c === 'string') : [],
    not_checked: r.not_checked ?? '',
  };
}

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'];
const ALLOWED = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)'];
/** The CLI's own deny rules, on top of the hook below. `//` makes a rule path absolute. */
const DENIED = ['Read(//proc/**)', 'Read(//sys/**)'];

/**
 * Checks every tool call, the subagents' too, before the allow rules let it through: a hook runs
 * where `canUseTool` doesn't, since that is only asked about calls no rule allows.
 */
const guard =
  (cwd: string): HookCallback =>
  async (input) => {
    const { tool_name, tool_input } = input as PreToolUseHookInput;
    const why = toolDenial(tool_name, (tool_input ?? {}) as Record<string, unknown>, cwd);
    return why ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } } : {};
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
 * The CLI's environment: only `PATH`, `HOME` and the Claude token, so nothing else the runner holds
 * (the OIDC request token, the action's inputs, GITHUB_TOKEN) is there to leak. The CLI scrubs the
 * Claude token from the environment of what it runs (git).
 */
export function cliEnv(claude: ClaudeToken): Record<string, string | undefined> {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    [claude.kind === 'oauth' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY']: claude.value,
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
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
};

export type AgentResult = { review: Review; models: string[]; costUsd: number };

async function once(prompt: string, o: AgentOptions, controller: AbortController): Promise<SDKResultMessage | undefined> {
  const deep = !!o.subagentModel && !!o.passes?.length;
  let result: SDKResultMessage | undefined;
  for await (const m of query({
    prompt,
    options: {
      cwd: o.cwd,
      model: o.model,
      effort: o.effort as EffortLevel,
      fallbackModel: o.fallbackModel,
      maxTurns: o.maxTurns,
      tools: deep ? [...READ_TOOLS, 'Agent'] : READ_TOOLS,
      allowedTools: deep ? [...ALLOWED, 'Agent'] : ALLOWED,
      disallowedTools: DENIED,
      hooks: { PreToolUse: [{ hooks: [guard(o.cwd)] }] },
      permissionMode: 'dontAsk',
      // No project or user settings: a PR could otherwise add hooks or MCP servers that run its code.
      settingSources: [],
      persistSession: false,
      outputFormat: { type: 'json_schema', schema: SCHEMA },
      agents: deep ? deepAgents(o.subagentModel!, o.effort as EffortLevel, o.passes!) : undefined,
      abortController: controller,
      env: cliEnv(o.claude),
      pathToClaudeCodeExecutable: claudeBinary(),
    },
  })) {
    if (m.type === 'result') result = m;
  }
  return result;
}

/**
 * Run the review session. A reply that doesn't match the schema is retried once, then the run fails.
 * Every failure comes out as a `ShaftFailure` with a `review_*` code.
 */
export async function runAgent(prompt: string, o: AgentOptions): Promise<AgentResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMinutes * 60_000);
  try {
    for (let attempt = 1; ; attempt++) {
      const result = await once(prompt, o, controller);
      if (result?.subtype === 'success') {
        const review = parseReview(result.structured_output);
        if (review) return { review, models: Object.keys(result.modelUsage), costUsd: result.total_cost_usd };
      } else if (result && result.subtype !== 'error_max_structured_output_retries') {
        throw new Error(`The Agent SDK run ended with ${result.subtype}: ${result.errors.join('; ')}`);
      }
      const raw = result?.subtype === 'success' ? (result.structured_output ?? result.result) : result?.errors;
      core.warning(`The reply didn't match the review schema (attempt ${attempt}):\n${JSON.stringify(raw, null, 2)}`);
      if (attempt === 2) {
        throw new ShaftFailure(
          'review_invalid_reply',
          "The model's reply didn't match the review format twice, so nothing was posted. Rerun the job; both replies are in the job log.",
        );
      }
    }
  } catch (e) {
    if (controller.signal.aborted) {
      throw new ShaftFailure('review_timed_out', `The review ran past its ${o.timeoutMinutes}-minute time limit. Raise the time limit on the dashboard, or rerun the job.`, DASHBOARD_URL);
    }
    if (e instanceof ShaftFailure) throw e;
    const why = (e instanceof Error ? e.message : String(e)).replace(/\.$/, '');
    throw new ShaftFailure('review_failed', `The review failed: ${why}. Rerun the job; the job log has the details.`);
  } finally {
    clearTimeout(timer);
  }
}
