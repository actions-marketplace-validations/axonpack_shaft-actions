import { builtinModules } from 'node:module';
import { basename, dirname } from 'node:path';
import type { Checkout, Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

const JS = /\.(?:[mc]?[jt]sx?|vue|svelte|astro)$/;
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;
const PY_IMPORT = /^\s*(?:from\s+([A-Za-z_]\w*)[\w.]*\s+import\b|import\s+([\w., ]+))/;
const PY_MANIFESTS = ['**/requirements*.txt', '**/pyproject.toml', '**/Pipfile', '**/setup.py', '**/setup.cfg'];
const DEPS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
/** The most manifests read of each kind. */
const MANIFESTS_MAX = 200;

/** The npm package a specifier names, or undefined for a relative path, a URL, a `node:`-style scheme or a `#`, `~/`, `@/` or `$` alias. */
const npmPackage = (spec: string) => {
  const s = spec.replace(/^npm:/, '');
  if (/^(?:[./#$~]|@\/|[\w-]+:)/.test(s)) return undefined;
  return s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/');
};
/** A Python name as pip compares names: lowercase, with `-`, `_` and `.` the same. */
const pyNorm = (s: string) => s.toLowerCase().replace(/[-_.]+/g, '-');

/** The packages the checkout's `package.json` files list or are, and its `paths` aliases from `tsconfig` and `jsconfig` files. */
function npmKnown(checkout: Checkout): { names: Set<string>; aliases: string[]; read: number } {
  const names = new Set<string>(builtinModules);
  const manifests = checkout.find(['**/package.json']).slice(0, MANIFESTS_MAX);
  for (const p of manifests) {
    try {
      const pkg = JSON.parse(checkout.read(p) ?? '{}');
      if (typeof pkg.name === 'string') names.add(pkg.name);
      for (const d of DEPS) for (const n of Object.keys(pkg[d] ?? {})) names.add(n);
    } catch {
      // ponytail: a package.json that isn't JSON lists nothing; its imports show as missing.
    }
  }
  const aliases = checkout
    .find(['**/{tsconfig,jsconfig}*.json'])
    .slice(0, MANIFESTS_MAX)
    .flatMap((p) => [.../"paths"\s*:\s*\{([^}]*)\}/.exec(checkout.read(p) ?? '')?.[1]?.matchAll(/"([^"*]+)\*?"\s*:/g) ?? []].map((m) => m[1]!));
  return { names, aliases, read: manifests.length };
}

/**
 * The `imports` facts: each package an added line imports, in JS, TS or Python, that no manifest in
 * the checkout lists. npm names come from every `package.json` (its dependencies and its own name),
 * Node's built-in modules and `tsconfig` `paths` aliases; Python names from requirements, `pyproject`,
 * Pipfile and setup files, and modules in the checkout.
 */
export const imports: Facts = async ({ files, checkout }) => {
  const js: { at: string; name: string }[] = [];
  const py: { at: string; name: string }[] = [];
  for (const f of files)
    for (const [line, text] of diffLines(f.patch, true)) {
      const at = `${f.filename}:${line}`;
      if (JS.test(f.filename)) for (const m of text.matchAll(JS_IMPORT)) js.push(...[npmPackage(m[1]!)].filter((n) => n !== undefined).map((name) => ({ at, name })));
      if (f.filename.endsWith('.py')) {
        const m = PY_IMPORT.exec(text);
        const names = m?.[1] ? [m[1]] : (m?.[2]?.split(',').map((s) => s.trim().split(/[.\s]/)[0]!) ?? []);
        py.push(...names.filter(Boolean).map((name) => ({ at, name })));
      }
    }
  if (!js.length && !py.length) return '';
  const lines: string[] = [];
  if (js.length) {
    const { names, aliases, read } = npmKnown(checkout);
    lines.push(`Read ${read} package.json file${read === 1 ? '' : 's'}.`);
    for (const { at, name } of js) if (!names.has(name) && !aliases.some((a) => name.startsWith(a) || `${name}/`.startsWith(a))) lines.push(`- ${at} \`${name}\`: no package.json lists it`);
  }
  if (py.length) {
    const manifests = checkout.find(PY_MANIFESTS).slice(0, MANIFESTS_MAX);
    const text = pyNorm(manifests.map((p) => checkout.read(p) ?? '').join('\n'));
    const local = new Set(checkout.find(['**/*.py']).flatMap((p) => [basename(p, '.py'), basename(dirname(p))]));
    lines.push(`Read ${manifests.length} Python manifest${manifests.length === 1 ? '' : 's'}.`);
    for (const { at, name } of py)
      if (!local.has(name) && !new RegExp(`(?<![\\w-])${pyNorm(name)}(?![\\w-])`).test(text))
        lines.push(`- ${at} \`${name}\`: no Python manifest names it, and no module in the repo has the name; it may be in the standard library or published under another name`);
  }
  return lines.some((l) => l.startsWith('- ')) ? factsText(lines, '') : '';
};
