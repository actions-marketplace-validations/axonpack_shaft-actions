import { basename, dirname } from 'node:path';
import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

/** How a name is written, by its part before the first dot. */
const CASES: [name: string, test: RegExp][] = [
  ['kebab-case', /^[a-z0-9]+(?:-[a-z0-9]+)+$/],
  ['snake_case', /^[a-z0-9]+(?:_[a-z0-9]+)+$/],
  ['PascalCase', /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*$/],
  ['camelCase', /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/],
  ['lowercase', /^[a-z0-9]+$/],
  ['UPPERCASE', /^[A-Z0-9_]+$/],
];
/** A React component an added line exports: `export function Name`, `export const Name =`, `export default function Name`. */
const COMPONENT = /^\s*export\s+(?:default\s+)?(?:function\s+|const\s+|class\s+)([A-Z]\w*)/;

/**
 * The `new-files` facts: each added or moved path with its folder, its suffix (everything after the
 * name's first dot, such as `.service.ts`) and how its name is written; a `.tsx` or `.jsx` file that
 * exports more than one component says how many.
 */
export const newFiles: Facts = async ({ files }) => {
  // ponytail: a moved file shows its new path only; the context doesn't keep `previous_filename`.
  const lines = files
    .filter((f) => f.status === 'added' || f.status === 'renamed')
    .map((f) => {
      const name = basename(f.filename);
      const dot = name.indexOf('.', 1);
      const [stem, suffix] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      const style = CASES.find(([, t]) => t.test(stem))?.[0] ?? 'mixed';
      const components = /\.[jt]sx$/.test(name) ? [...diffLines(f.patch, true).values()].filter((l) => COMPONENT.test(l)).length : 0;
      return `- ${f.filename} (${f.status === 'added' ? 'added' : 'moved here'}): folder ${dirname(f.filename)}/, suffix ${suffix || 'none'}, ${style}${components > 1 ? `, exports ${components} components` : ''}`;
    });
  return factsText(lines.length ? ['Added and moved files:', ...lines] : [], '');
};
