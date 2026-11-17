import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** The path the file system will open: symlinks followed, so a link added by the PR can't lead out of the checkout. */
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
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

/**
 * Why the review agent may not make this tool call, or undefined when it may. The agent reads the
 * checkout and nothing else: never the runner's environment (`/proc/self/environ` holds the Claude
 * token), home, temp or tool folders. Bash runs only plain `git diff`, `git log` and `git show`.
 */
export function toolDenial(tool: string, input: Record<string, unknown>, cwd: string): string | undefined {
  const outside = (p: unknown) => typeof p === 'string' && !insideCheckout(p, cwd);
  if (tool === 'Read' && (typeof input.file_path !== 'string' || outside(input.file_path))) return 'Only files in the checkout can be read.';
  if ((tool === 'Grep' || tool === 'Glob') && outside(input.path)) return 'Only the checkout can be searched.';
  if (tool === 'Glob' && typeof input.pattern === 'string' && (isAbsolute(input.pattern) || input.pattern.includes('..') || input.pattern.startsWith('~'))) {
    return 'Glob patterns stay inside the checkout.';
  }
  if (tool !== 'Bash') return;
  const command = typeof input.command === 'string' ? input.command : '';
  if (/[;&|<>`$(){}\\\n]/.test(command)) return 'Only plain git diff, git log and git show commands run.';
  // ponytail: a whitespace split; the metacharacter check above already refuses anything that needs real shell parsing
  const args = command.trim().split(/\s+/).map((a) => a.replace(/^['"]|['"]$/g, ''));
  if (args[0] !== 'git' || !['diff', 'log', 'show'].includes(args[1])) return 'Only git diff, git log and git show run.';
  for (const arg of args.slice(2)) {
    if (GIT_DENIED.test(arg)) return `git ${arg.split('=')[0]} isn't allowed.`;
    const value = arg.startsWith('-') && arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    // A path outside the working tree makes git diff compare files outside the repo, as --no-index does.
    if (/^[/~]|\.\./.test(value) && outside(value)) return 'git may only name paths in the checkout.';
  }
}
