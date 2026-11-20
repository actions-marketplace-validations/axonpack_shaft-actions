import type { Facts, ScriptInput } from '../../types/prestep.type';
import { exportNames } from '../../utils/exports.util';
import { capFacts, removedLines } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';
import { SEARCH_MAX, search } from './search.service';

/** Where an exported name changed: the file, its line on the new side, and whether its export line was added, removed or both. */
export type ChangedExport = { file: string; line?: number; kind: 'added' | 'removed' | 'changed' };

/** Each name whose export line the pull request adds, removes or changes, at the first file it does in. */
export function changedExports(files: ScriptInput['files']): Map<string, ChangedExport> {
  const out = new Map<string, ChangedExport>();
  for (const f of files) {
    const added = new Map([...diffLines(f.patch, true)].flatMap(([line, text]) => exportNames(text).map((n) => [n, line] as const)));
    const removed = new Set(removedLines(f.patch).flatMap(exportNames));
    for (const n of new Set([...added.keys(), ...removed]))
      if (!out.has(n)) out.set(n, { file: f.filename, line: added.get(n), kind: !removed.has(n) ? 'added' : !added.has(n) ? 'removed' : 'changed' });
  }
  return out;
}

/** The note that says what a search left out, or nothing. */
export const cutNote = (cut: string[]) => (cut.length ? [`Search cut: ${cut.join('; ')}.`] : []);

/**
 * The `callers` facts: each exported name the pull request adds, removes or changes the export line
 * of, and the other code files in the checkout that name it, with their lines. A file the pull
 * request also changes is marked, since its callers may have been updated with it.
 */
export const callers: Facts = async ({ files, checkout }) => {
  const changed = changedExports(files);
  if (!changed.size) return 'The pull request adds, removes or changes no exported name.';
  const { hits, cut } = search(checkout, [...changed.keys()]);
  const inPr = new Set(files.map((f) => f.filename));
  const lines = [...hits].flatMap(([name, found]) => {
    const at = changed.get(name)!;
    const others = found.filter((h) => h.file !== at.file);
    return [
      `\`${name}\` (${at.kind} in ${at.file}${at.line ? `:${at.line}` : ''}): ${others.length ? `named in ${others.length} other file${others.length > 1 ? 's' : ''}` : 'no other code file names it'}`,
      ...others.slice(0, SEARCH_MAX.perName).map((h) => `- ${h.file}:${h.lines.slice(0, 10).join(',')}${inPr.has(h.file) ? ' (changed in this pull request)' : ''}`),
      ...(others.length > SEARCH_MAX.perName ? [`- and ${others.length - SEARCH_MAX.perName} more files`] : []),
    ];
  });
  return capFacts([...cutNote(cut), ...lines], '');
};
