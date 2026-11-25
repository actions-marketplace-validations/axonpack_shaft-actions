import { insideCheckout, toolDenial } from './tool-guard.util';

/**
 * What the action hands the guard plugin (`src/opencode-guard.ts`) through OpenCode's config: the
 * checkout, a task's repo commands and the sandbox prefix its Bash runs in, the OpenCode tools the
 * job may call, the file the plugin writes once it has loaded, and the file it writes when the
 * provider refuses the run (`stop`).
 */
export type GuardOptions = { cwd: string; tools: string[]; commands?: string[]; prefix?: string; mcp?: boolean; guardrails?: unknown; marker: string; stop?: string };

/** The files an `apply_patch` call touches, from its `*** Add/Update/Delete File:` and `*** Move to:` lines. */
export const patchFiles = (patch: unknown): string[] =>
  typeof patch === 'string' ? [...patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)].map((m) => m[1]!.trim()) : [];

/**
 * Why OpenCode may not make this tool call, or undefined when it may: `toolDenial`'s answer, on
 * OpenCode's tool names and arguments. Any tool the job doesn't list is refused. A task's Bash command,
 * once allowed, is rewritten in place (OpenCode runs the same `args` object) to run in the sandbox.
 */
export function opencodeDenial(tool: string, args: Record<string, unknown>, o: GuardOptions): string | undefined {
  if (o.mcp && tool.startsWith('shaft_')) return;
  if (!o.tools.includes(tool)) return `${tool} isn't one of this job's tools.`;
  const check = (name: string, input: Record<string, unknown>) => toolDenial(name, input, o.cwd, o.commands);
  switch (tool) {
    case 'read':
      return check('Read', { file_path: args.filePath });
    case 'grep':
      return check('Grep', { path: args.path, pattern: args.pattern });
    case 'glob':
      return check('Glob', { path: args.path, pattern: args.pattern });
    case 'edit':
    case 'write':
      return check(tool === 'edit' ? 'Edit' : 'Write', { file_path: args.filePath });
    case 'apply_patch': {
      const files = patchFiles(args.patchText);
      if (!files.length) return 'The patch names no file.';
      for (const f of files) {
        const why = check('Edit', { file_path: f });
        if (why) return why;
      }
      return;
    }
    case 'bash': {
      if (typeof args.workdir === 'string' && !insideCheckout(args.workdir, o.cwd)) return 'Commands run only in the checkout.';
      const why = check('Bash', { command: args.command });
      if (why || !o.commands) return why;
      if (!o.prefix) return 'This run has no sandbox, so no command runs.';
      args.command = `${o.prefix} ${String(args.command).trim()}`;
      break;
    }
    case 'task':
      return;
    default:
      return `${tool} isn't one of this job's tools.`;
  }
}

/**
 * The provider's message when OpenCode is about to retry an error no retry in this run can fix: a
 * `session.status` of type `retry` that carries an `action` (a free or Go usage limit, which OpenCode
 * then waits out for as long as the provider's retry-after says). Undefined for any other event,
 * including a plain retry of a 5xx or an overload.
 */
export function fatalRetry(event: unknown): string | undefined {
  const e = event as { type?: string; properties?: { status?: { type?: string; message?: unknown; action?: unknown } } } | undefined;
  const status = e?.type === 'session.status' ? e.properties?.status : undefined;
  if (status?.type !== 'retry' || !status.action) return;
  return typeof status.message === 'string' && status.message ? status.message : 'the provider refused the run';
}
