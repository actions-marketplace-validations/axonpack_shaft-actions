import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { changedFiles, readAll, report, runTool } from '../tool.service';

const OPENAPI = /(?:^|\/)openapi\.[^/]+$/;
/** The most OpenAPI files compared, and `.proto` files copied, in one run. */
const MAX_OPENAPI = 10;
const MAX_PROTO = 1000;

/** oasdiff's breaking changes between the base branch's copy of each changed OpenAPI file and the pull request's. */
async function openapi({ files, checkout, base }: Parameters<Facts>[0]): Promise<string[]> {
  const lines: string[] = [];
  for (const f of changedFiles(files, OPENAPI).slice(0, MAX_OPENAPI)) {
    const [was, now] = [await base(f), checkout.read(f)];
    if (was === undefined || now === undefined) {
      lines.push(`${f}: ${was === undefined ? 'new in this pull request, so there is nothing to compare' : "couldn't be read"}.`);
      continue;
    }
    try {
      const run = await runTool('oasdiff', ['breaking', `base/${f}`, `head/${f}`, '--format', 'json'], { [`base/${f}`]: was, [`head/${f}`]: now });
      const changes: { id: string; text: string; level: number; operation?: string; path?: string }[] = report('oasdiff', run) ?? [];
      lines.push(...changes.map((c) => `${f} ${[c.operation, c.path].filter(Boolean).join(' ')}: ${c.text} (${c.id}, ${c.level >= 3 ? 'breaking' : 'warning'})`));
      if (!changes.length) lines.push(`${f}: oasdiff found no breaking change.`);
    } catch (e) {
      lines.push(`${f}: oasdiff didn't run: ${(e as Error).message}.`);
    }
  }
  return lines;
}

/**
 * buf's breaking changes: every `.proto` file and buf config in the checkout as the pull request has
 * them, against the same tree with the changed ones as the base branch has them.
 */
async function proto({ files, checkout, base }: Parameters<Facts>[0]): Promise<string[]> {
  const changed = files.filter((f) => f.filename.endsWith('.proto'));
  if (!changed.length) return [];
  const head = readAll(checkout, checkout.find(['**/*.proto', '**/buf.yaml', '**/buf.work.yaml', '**/buf.lock']).slice(0, MAX_PROTO));
  const was = { ...head };
  for (const f of changed) {
    const text = f.status === 'added' ? undefined : await base(f.filename);
    if (text === undefined) delete was[f.filename];
    else was[f.filename] = text;
  }
  const tree = Object.fromEntries([...Object.entries(head).map(([p, t]) => [`head/${p}`, t]), ...Object.entries(was).map(([p, t]) => [`base/${p}`, t])]);
  try {
    const run = await runTool('buf', ['breaking', 'head', '--against', 'base', '--error-format', 'json'], tree);
    const found = run.out
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l) as { path: string; start_line: number; type: string; message: string });
    if (run.status && !found.length) throw new Error(run.err.trim().slice(0, 300));
    return found.length ? found.map((b) => `${b.path.replace(/^head\//, '')}:${b.start_line} ${b.type}: ${b.message}`) : ['buf found no breaking change in the .proto files.'];
  } catch (e) {
    return [`buf didn't run: ${(e as Error).message}.`];
  }
}

/**
 * The `contract-diff` facts, for `api-contract`: the breaking changes the pinned oasdiff finds in each
 * changed OpenAPI file and the pinned buf finds in the `.proto` files. GraphQL schemas have no tool
 * here, so the model reads their diff.
 */
export const contractDiff: Facts = async (input) => {
  const lines = [...(await openapi(input)), ...(await proto(input))];
  if (changedFiles(input.files, /\.graphql$/).length) lines.push('GraphQL schemas changed: no tool compares them here, so read their diff.');
  return factsText(lines, '');
};
