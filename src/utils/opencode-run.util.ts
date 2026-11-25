import type { Pass } from '../services/api.service';
import type { Tokens } from '../services/agent.service';

/** The Claude tool names a job lists, as OpenCode's tool IDs. `Bash(git diff:*)` and the like are Bash. */
export function opencodeTools(claudeTools: string[], edit: boolean): string[] {
  const map: Record<string, string[]> = { Read: ['read'], Grep: ['grep'], Glob: ['glob'], Bash: ['bash'], Edit: ['edit', 'apply_patch'], Write: ['write'], Agent: ['task'] };
  const ids = claudeTools.flatMap((t) => map[t.replace(/\(.*$/, '')] ?? []);
  return [...new Set(edit ? ids : ids.filter((t) => !['edit', 'write', 'apply_patch'].includes(t)))];
}

/**
 * OpenCode's own permission rules for the job's `tools`, under the guard plugin: anything not listed
 * is denied, nothing outside the checkout, no `.env` read, and Bash only as `git diff`, `git log` and
 * `git show`, or for a task only behind the sandbox `prefix`, which only the plugin adds. If the
 * plugin ever failed to load, these still hold, and the action refuses the reply (`opencode_guard_missing`).
 * The last matching rule wins, in this key order.
 */
export function opencodePermission(tools: string[], o: { prefix?: string; passes?: Pass[]; mcp?: boolean }): Record<string, unknown> {
  const p: Record<string, unknown> = { '*': 'deny', external_directory: 'deny' };
  if (tools.includes('read')) p.read = { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny' };
  if (tools.includes('grep')) p.grep = 'allow';
  if (tools.includes('glob')) p.glob = 'allow';
  if (tools.includes('bash')) p.bash = o.prefix ? { '*': 'deny', [`${o.prefix} *`]: 'allow' } : { '*': 'deny', 'git diff *': 'allow', 'git log *': 'allow', 'git show *': 'allow' };
  if (tools.some((t) => ['edit', 'write', 'apply_patch'].includes(t))) p.edit = { '*': 'allow', '.git/*': 'deny', '.github/*': 'deny' };
  if (tools.includes('task')) p.task = { '*': 'deny', ...Object.fromEntries((o.passes ?? []).map((x) => [x.name, 'allow'])) };
  if (o.mcp) p['shaft_*'] = 'allow';
  return p;
}

/** The prompt with the reply's schema, which OpenCode can't enforce: the action parses and checks the reply itself. */
export const schemaPrompt = (prompt: string, schema: Record<string, unknown>): string =>
  `${prompt}\n\nEnd with your reply as one JSON object and nothing else: no prose and no code fence around it. It must match this JSON schema:\n${JSON.stringify(schema)}`;

/** The JSON object in the reply's text: from its first `{` to its last `}`, so a code fence or a line around it doesn't matter. */
export function replyJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {}
}

/** What `opencode run --format json` printed, read: the last text part, tokens and cost summed over steps, the tool calls and errors. */
export type RunEvents = { text: string; tokens: Tokens; costUsd: number; tools: { tool: string; input: Record<string, unknown>; error?: string }[]; errors: string[] };

/** Read one line of `opencode run --format json`'s output into `into`. Anything else (a log line) is skipped. */
export function readEvent(line: string, into: RunEvents): void {
  let e: { type?: string; part?: Record<string, any>; error?: { name?: string; data?: { message?: string } } };
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  const part = e.part ?? {};
  if (e.type === 'text' && typeof part.text === 'string') into.text = part.text;
  if (e.type === 'step_finish') {
    const t = part.tokens ?? {};
    into.tokens.input += Number(t.input) || 0;
    into.tokens.output += (Number(t.output) || 0) + (Number(t.reasoning) || 0);
    into.tokens.cache_read += Number(t.cache?.read) || 0;
    into.tokens.cache_write += Number(t.cache?.write) || 0;
    into.costUsd += Number(part.cost) || 0;
  }
  if (e.type === 'tool_use' && typeof part.tool === 'string') {
    const state = part.state ?? {};
    into.tools.push({ tool: part.tool, input: state.input ?? {}, ...(state.status === 'error' && { error: String(state.error ?? '') }) });
  }
  if (e.type === 'error') into.errors.push(e.error?.data?.message ?? e.error?.name ?? 'unknown error');
}

export const emptyEvents = (): RunEvents => ({ text: '', tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 }, costUsd: 0, tools: [], errors: [] });
