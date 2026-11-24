import { dirname, join } from 'node:path';
import type { Checkout, Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

type Pkg = { manifest: string; name: string; version?: string; private: boolean };

const CHANGESET = /(?:^|\/)\.changeset\/(?!README\.md$)[^/]+\.md$/i;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const BUMP = /^\s*["']?([^"'\s:#][^"':]*?)["']?\s*:\s*(major|minor|patch|none)\s*$/gm;

/** The nearest `package.json` above a path that names a package, each manifest parsed once. */
function owner(checkout: Checkout, path: string, read: Map<string, Pkg | null>): Pkg | undefined {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (!read.has(manifest)) {
      let pkg: Pkg | null = null;
      try {
        const json = JSON.parse(checkout.read(manifest) ?? 'null') as { name?: unknown; version?: unknown; private?: unknown } | null;
        if (typeof json?.name === 'string') pkg = { manifest, name: json.name, version: typeof json.version === 'string' ? json.version : undefined, private: json.private === true };
      } catch {
        // Not JSON: no package here.
      }
      read.set(manifest, pkg);
    }
    if (read.get(manifest)) return read.get(manifest)!;
    if (dir === '.' || dir === '/') return undefined;
  }
}

/**
 * The `changeset` facts: each package the diff changes (by its nearest `package.json`), whether it's
 * private, the changesets and bumps that name it and whether its `CHANGELOG.md` or version changed;
 * then each changeset in the pull request with the packages and bumps it names.
 */
export const changeset: Facts = async ({ files, checkout }) => {
  const sets = files
    .filter((f) => CHANGESET.test(f.filename) && f.status !== 'removed')
    .map((f) => {
      const text = checkout.read(f.filename) ?? [...diffLines(f.patch, true).values()].join('\n');
      return { file: f.filename, bumps: [...(FRONTMATTER.exec(text)?.[1] ?? '').matchAll(BUMP)].map((m) => ({ name: m[1]!, bump: m[2]! })) };
    });
  const read = new Map<string, Pkg | null>();
  const pkgs = new Map<string, { pkg: Pkg; files: string[] }>();
  let loose = 0;
  for (const f of files) {
    if (CHANGESET.test(f.filename)) continue;
    const pkg = owner(checkout, f.filename, read);
    if (!pkg) loose++;
    else (pkgs.get(pkg.manifest) ?? pkgs.set(pkg.manifest, { pkg, files: [] }).get(pkg.manifest)!).files.push(f.filename);
  }
  if (!pkgs.size && !sets.length) return '';
  const bumped = (name: string) => sets.flatMap((s) => s.bumps.filter((b) => b.name === name).map((b) => `${b.bump} (${s.file})`));
  const lines = [
    checkout.read('.changeset/config.json') === undefined ? 'The repo has no `.changeset/config.json`.' : 'The repo uses changesets (`.changeset/config.json`).',
    'Packages the pull request changes:',
    ...[...pkgs.values()].map(({ pkg, files: changed }) => {
      const changelog = join(dirname(pkg.manifest), 'CHANGELOG.md');
      const version = [...diffLines(files.find((f) => f.filename === pkg.manifest)?.patch, true).values()].find((l) => /^\s*"version"\s*:/.test(l));
      return [
        `- \`${pkg.name}\` (${pkg.manifest}${pkg.version ? `, version ${pkg.version}` : ''}${pkg.private ? ', private' : ''}): ${changed.length} file${changed.length === 1 ? '' : 's'}`,
        `changesets: ${bumped(pkg.name).join(', ') || 'none'}`,
        `${changelog} ${changed.includes(changelog) ? 'changed' : 'not changed'}`,
        ...(version ? [`version changed: ${version.trim()}`] : []),
      ].join('; ');
    }),
    ...(loose ? [`${loose} changed file${loose === 1 ? ' belongs' : 's belong'} to no package.`] : []),
    `Changesets in the pull request:${sets.length ? '' : ' none'}`,
    ...sets.map((s) => `- ${s.file}: ${s.bumps.map((b) => `\`${b.name}\` ${b.bump}`).join(', ') || 'names no package'}`),
  ];
  const named = [...new Set(sets.flatMap((s) => s.bumps.map((b) => b.name)))].filter((n) => ![...pkgs.values()].some((p) => p.pkg.name === n));
  if (named.length) lines.push(`Changesets name packages the pull request doesn't change: ${named.map((n) => `\`${n}\``).join(', ')}`);
  return factsText(lines, '');
};
