import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { SECRET_FILES } from '../guardrails/guardrail.const';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The path the file system will open: symlinks followed, so a link added by the PR can't lead out
 * of the checkout. A file that doesn't exist yet is resolved through its nearest folder that does.
 */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const up = dirname(path);
    return up === path ? path : join(real(up), basename(path));
  }
}

/** Never readable, even if the checkout sat inside one: the runner's processes, its temp folder and its tools. */
const DENIED = ['/proc', '/sys', process.env.RUNNER_TEMP, process.env.RUNNER_TOOL_CACHE].filter((d): d is string => !!d);

const under = (path: string, dir: string) => {
  const rel = relative(dir, path);
  return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
};

/** Whether `path` (relative to the checkout, absolute, or under `~`) resolves inside the checkout at `cwd`. */
export function insideCheckout(path: string, cwd: string): boolean {
  const root = real(resolve(cwd));
  const target = real(resolve(root, path.replace(/^~(?=\/|$)/, homedir())));
  return under(target, root) && !DENIED.some((d) => under(target, real(d)));
}

/** git options that read files outside the repo or write a file. */
const GIT_DENIED = /^--(no-in|ou|ext)/;

/** An install takes no more words: a package name after it would fetch anything from the network. */
const INSTALL = / (ci|install)\b/;

/**
 * Whether `command` is one of the repo's `commands` (`repoCommands`), or one with more words after
 * it, such as a test file. An install must match exactly.
 */
export const isRepoCommand = (command: string, commands: string[]): boolean =>
  commands.some((c) => command === c || (!INSTALL.test(c) && command.startsWith(`${c} `)));

/**
 * Why the agent may not make this tool call, or undefined when it may. Nothing runs in the
 * background. The agent reads the checkout and nothing else: never the runner's environment (`/proc/self/environ` holds the Claude token),
 * home, temp or tool folders. Bash runs only plain `git diff`, `git log` and `git show`.
 *
 * A task passes the repo's `commands`: it may also edit files in the checkout (never under `.git/` or `.github/`),
 * and run `git status` and those commands, with the same checks on their words. Nothing else runs:
 * no `git commit` or `git push`, no `gh`, and no install beyond the repo's own.
 */
export function toolDenial(tool: string, input: Record<string, unknown>, cwd: string, commands?: string[]): string | undefined {
  // A background command would keep repo code running while the file tools act, racing their checks.
  if (input.run_in_background) return 'Nothing runs in the background: run it in the foreground.';
  const outside = (p: unknown) => typeof p === 'string' && !insideCheckout(p, cwd);
  if (tool === 'Read' && (typeof input.file_path !== 'string' || outside(input.file_path))) return 'Only files in the checkout can be read.';
  // ponytail: refused even when a task's request names the file; pass the request in if one ever needs it.
  if (tool === 'Read' && SECRET_FILES.test(basename(input.file_path as string))) return "Files that hold credentials (.env, keys, .npmrc) aren't read.";
  if ((tool === 'Grep' || tool === 'Glob') && outside(input.path)) return 'Only the checkout can be searched.';
  if (tool === 'Glob' && typeof input.pattern === 'string' && (isAbsolute(input.pattern) || input.pattern.includes('..') || input.pattern.startsWith('~'))) {
    return 'Glob patterns stay inside the checkout.';
  }
  if (tool === 'Edit' || tool === 'Write') {
    if (!commands) return 'This run only reads.';
    if (typeof input.file_path !== 'string' || outside(input.file_path)) return 'Only files in the checkout can be edited.';
    if (insideCheckout(resolve(cwd, input.file_path), resolve(cwd, '.git'))) return 'Nothing under .git/ can be edited.';
    // The workflows run with the repo's secrets, and the commit may not change them either (`commitDenial`).
    if (insideCheckout(resolve(cwd, input.file_path), resolve(cwd, '.github'))) return 'Nothing under .github/ can be edited.';
    return;
  }
  if (tool !== 'Bash') return;
  const allowed = commands ? 'git diff, git log, git show, git status and the repo\'s own commands' : 'git diff, git log and git show';
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (/[;&|<>`$(){}\\\n]/.test(command)) return `Only plain ${allowed} run.`;
  // ponytail: a whitespace split; the metacharacter check above already refuses anything that needs real shell parsing
  const args = command.split(/\s+/).map((a) => a.replace(/^['"]|['"]$/g, ''));
  const git = args[0] === 'git' && ['diff', 'log', 'show', ...(commands ? ['status'] : [])].includes(args[1]);
  if (!git && !(commands && isRepoCommand(command, commands))) return `Only ${allowed} run.`;
  for (const arg of args.slice(git ? 2 : 1)) {
    if (git && GIT_DENIED.test(arg)) return `git ${arg.split('=')[0]} isn't allowed.`;
    const value = arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    // A path outside the working tree makes git diff compare files outside the repo, as --no-index does.
    if (/^[/~]|\.\./.test(value) && outside(value)) return 'Commands may only name paths in the checkout.';
  }
}
