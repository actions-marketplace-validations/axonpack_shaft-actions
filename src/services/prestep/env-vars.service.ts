import type { Script } from '../../types/prestep.type';
import { diffLines } from '../../utils/render.util';

const NAME = '([A-Z_][A-Z0-9_]*)';
/** How code reads an env var: Node, Vite, Bun, Deno, Python, Go, Rust and Ruby. */
const READS = [
  `\\b(?:process|Bun)\\.env\\.${NAME}`,
  `\\bprocess\\.env\\[\\s*['"\`]${NAME}['"\`]`,
  `\\bimport\\.meta\\.env\\.${NAME}`,
  `\\bDeno\\.env\\.get\\(\\s*['"\`]${NAME}`,
  `\\bos\\.(?:environ\\.get\\(|environ\\[|getenv\\()\\s*['"]${NAME}`,
  `\\bos\\.(?:Getenv|LookupEnv)\\(\\s*"${NAME}"`,
  `\\benv::var(?:_os)?\\(\\s*"${NAME}"`,
  `\\bENV(?:\\.fetch\\(\\s*|\\[\\s*)['"]${NAME}`,
].map((r) => new RegExp(r, 'g'));
/** Names the platform, the CI runner or the bundler sets. */
const PLATFORM = /^(?:NODE_ENV|CI|HOME|PATH|PWD|USER|SHELL|TMPDIR|TEMP|TMP|TZ|LANG|TERM|HOSTNAME|MODE|BASE_URL|DEV|PROD|SSR|(?:GITHUB|RUNNER|ACTIONS)_\w+)$/;
/** Where a name counts as documented: env example files and Markdown docs. */
export const DOCUMENTED = ['**/.env.*', '**/*.env.example', '**/*.{md,mdx}'];

const names = (text: string) => READS.flatMap((r) => [...text.matchAll(r)].map((m) => m[1]!));

/**
 * Env vars read in added lines that no env example file or Markdown doc in the checkout names, one
 * finding each at the first line that reads it. A name also read in a removed line moved, so it isn't new.
 */
export const envVars: Script = ({ files, checkout }) => {
  const removed = new Set(files.flatMap((f) => names((f.patch ?? '').split('\n').filter((l) => l.startsWith('-')).join('\n'))));
  const first = new Map<string, { file: string; line: number }>();
  for (const f of files)
    for (const [line, text] of diffLines(f.patch, true))
      for (const name of names(text)) if (!PLATFORM.test(name) && !removed.has(name) && !first.has(name)) first.set(name, { file: f.filename, line });
  if (!first.size) return [];
  const docs = checkout
    .find(DOCUMENTED)
    .map((p) => checkout.read(p) ?? '')
    .join('\n');
  return [...first]
    .filter(([name]) => !new RegExp(`\\b${name}\\b`).test(docs))
    .map(([name, at]) => ({
      severity: 'should-fix' as const,
      ...at,
      title: `\`${name}\` isn't documented`,
      body: `This line reads the env var \`${name}\`, and no \`.env\` example file or Markdown doc in the repo names it. Add it to \`.env.example\` or the docs, with what it's for.`,
    }));
};
