import type { Facts } from '../../types/prestep.type';
import { exportNames } from '../../utils/exports.util';
import { factsText } from '../../utils/facts.util';
import { diffLines, removedLines } from '../../utils/render.util';

/** `export * from './x'` and `export * as x from './x'`, which name no single export. */
const STAR = /^\s*export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"][^'"]+['"]/;
/** The `package.json` fields that set what a package exports, and its version. */
const ENTRY = /^\s*"(?:version|main|module|types|typings|exports|bin)"\s*:/;
/** A changeset's bump line: `'pkg': major`. */
const BUMP = /^\s*['"]?[^'":]+['"]?\s*:\s*(?:major|minor|patch)\s*$/;

const short = (s: string) => {
  const t = s.trim();
  return t.length > 160 ? `${t.slice(0, 157)}...` : t;
};
/** Each exported name in the lines with the first line that exports it, plus `export *` lines under their own text. */
function exported(lines: Iterable<[line: number | undefined, text: string]>): Map<string, { line?: number; text: string }> {
  const out = new Map<string, { line?: number; text: string }>();
  for (const [line, text] of lines)
    for (const name of STAR.test(text) ? [short(text)] : exportNames(text)) if (!out.has(name)) out.set(name, { line, text: short(text) });
  return out;
}

/**
 * The `exports-diff` facts: per changed file, each exported name whose export line the pull request
 * removes, adds or changes, with the line before and after; the `version`, `main`, `types`, `exports`
 * and `bin` lines changed in a `package.json`; and the bumps in the pull request's changesets.
 */
export const exportsDiff: Facts = async ({ files }) => {
  // ponytail: an export's first line only, so a signature over several lines shows as unchanged when only its later lines change; read the whole declaration if that misses breaks.
  const lines: string[] = [];
  for (const f of files) {
    const added = diffLines(f.patch, true);
    const removed = removedLines(f.patch);
    let rows: string[];
    if (f.filename.endsWith('package.json')) {
      rows = [...removed.filter((l) => ENTRY.test(l)).map((l) => `- before: ${short(l)}`), ...[...added].filter(([, l]) => ENTRY.test(l)).map(([n, l]) => `- after (line ${n}): ${short(l)}`)];
    } else if (/(^|\/)\.changeset\/[^/]+\.md$/.test(f.filename)) {
      rows = [...added].filter(([, l]) => BUMP.test(l)).map(([, l]) => `- bump ${short(l)}`);
    } else {
      const [was, now] = [exported(removed.map((l) => [undefined, l])), exported(added)];
      rows = [
        ...[...was].filter(([n]) => !now.has(n)).map(([n, b]) => `- removed \`${n}\`: ${b.text}`),
        ...[...now].filter(([n]) => was.has(n) && was.get(n)!.text !== now.get(n)!.text).map(([n, a]) => `- changed \`${n}\` (line ${a.line}): ${was.get(n)!.text} -> ${a.text}`),
        ...[...now].filter(([n]) => !was.has(n)).map(([n, a]) => `- added \`${n}\` (line ${a.line}): ${a.text}`),
      ];
    }
    if (rows.length) lines.push(`${f.filename}:`, ...rows);
  }
  return factsText(lines, '');
};
