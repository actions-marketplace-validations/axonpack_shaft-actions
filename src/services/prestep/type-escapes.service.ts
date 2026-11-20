import type { Facts } from '../../types/prestep.type';
import { factsText, TEST } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

const TS: [kind: string, pattern: RegExp][] = [
  ['@ts-ignore', /@ts-ignore\b/],
  ['@ts-nocheck', /@ts-nocheck\b/],
  ['@ts-expect-error', /@ts-expect-error\b/],
  ['lint rule turned off', /\b(?:eslint|oxlint)-disable|biome-ignore/],
  ['double cast', /\bas\s+unknown\s+as\b/],
  ['any', /\bas\s+any\b|[:<,|]\s*any\b(?!\s*[:=])|\bany\[\]/],
  ['non-null assertion', /[\w)\]]!(?=[.[)\],;\s]|$)/],
];
const PY: [kind: string, pattern: RegExp][] = [
  ['type: ignore', /#\s*(?:type|pyright):\s*ignore\b/],
  ['lint rule turned off', /#\s*noqa\b/],
  ['Any', /\bAny\b/],
  ['cast', /\bcast\(/],
];
const DEF = /^\s*(?:async\s+)?def\s+\w+\((.*)\)\s*(->)?[^:]*:\s*(?:#.*)?$/;
/** Configs that say the Python is type-checked, and the lint and type settings worth naming. */
const TYPED_PY = ['py.typed', '**/py.typed', 'mypy.ini', '.mypy.ini', 'pyrightconfig.json'];
const CONFIGS = ['.oxlintrc.json', 'oxlint.config.*', '.eslintrc*', 'eslint.config.*', 'biome.json', 'biome.jsonc', 'tsconfig.json', 'pyproject.toml', 'setup.cfg', 'mypy.ini', '.mypy.ini', 'pyrightconfig.json'];
const SETTING = /no-explicit-any|no-non-null-assertion|ban-ts-comment|prefer-ts-expect-error|noExplicitAny|noNonNullAssertion|"strict"|noImplicitAny|disallow_any|^\s*strict\s*=|\[tool\.(?:mypy|pyright)\]|typeCheckingMode/;
const MAX_CODE = 160;

/** A Python `def` with a parameter or the return left without a hint (`self`, `cls` and `*` don't count). */
function missingHints(text: string): boolean {
  const m = DEF.exec(text);
  if (!m) return false;
  const params = m[1]!.split(',').map((p) => p.trim().replace(/=.*/, '')).filter((p) => p && !/^(?:self|cls|\*|\/)$/.test(p));
  return !m[2] || params.some((p) => !p.includes(':'));
}

/**
 * The `type-escapes` facts: each `any`, double cast, non-null assertion, `@ts-ignore`, `@ts-expect-error`
 * and lint rule turned off on an added TypeScript line, `# type: ignore`, `Any` and `cast` on an added
 * Python line, a `def` missing hints when the repo type-checks its Python, and the repo's lint and type
 * settings that name these.
 */
export const typeEscapes: Facts = async ({ files, checkout }) => {
  let typed: boolean | undefined;
  const isTyped = () =>
    (typed ??= checkout.find(TYPED_PY).length > 0 || /\[tool\.(?:mypy|pyright)\]/.test(checkout.read('pyproject.toml') ?? '') || /^\[mypy\]/m.test(checkout.read('setup.cfg') ?? ''));
  const lines = files.flatMap((f) => {
    const kinds = /\.[cm]?tsx?$/.test(f.filename) ? TS : f.filename.endsWith('.py') ? PY : undefined;
    if (!kinds) return [];
    return [...diffLines(f.patch, true)].flatMap(([line, text]) => {
      const found = kinds.filter(([, p]) => p.test(text)).map(([k]) => k);
      if (kinds === PY && missingHints(text) && isTyped()) found.push('missing hints');
      const code = text.trim();
      return found.length ? [`- ${f.filename}:${line} ${found.join(', ')}: ${code.length > MAX_CODE ? `${code.slice(0, MAX_CODE)}...` : code}${TEST.test(f.filename) ? ' (test file)' : ''}`] : [];
    });
  });
  if (!lines.length) return 'No added line has a type escape.';
  const settings = checkout
    .find(CONFIGS)
    .sort()
    .flatMap((p) => (checkout.read(p) ?? '').split('\n').flatMap((l, i) => (SETTING.test(l) ? [`- ${p}:${i + 1} ${l.trim().slice(0, MAX_CODE)}`] : [])));
  return factsText(['Type escapes on added lines:', ...lines, ...(settings.length ? ["The repo's lint and type settings that name them:", ...settings] : [])], '');
};
