import type { Script } from '../../types/prestep.type';
import { TEST } from '../../utils/facts.util';
import { matches } from '../../utils/auto-pick.util';
import { diffLines } from '../../utils/render.util';

/** Where printing is the point: scripts and CLIs. The API can send its own `exclude` globs. */
export const PRINTS = ['**/scripts/**', 'scripts/**', '**/bin/**', 'bin/**', '**/cli/**', 'cli/**', '**/*.cli.*', '**/cli.*'];

/** Debug output, by the file extensions it applies to. */
const KINDS: [exts: RegExp, call: string, pattern: RegExp][] = [
  [/\.(?:[cm]?[jt]sx?|vue|svelte)$/, 'console.log', /\bconsole\.log\s*\(/],
  [/\.(?:[cm]?[jt]sx?|vue|svelte)$/, 'debugger', /^\s*debugger\s*;?\s*$/],
  [/\.py$/, 'print(', /^\s*print\s*\(/],
  [/\.rs$/, 'dbg!', /\bdbg!\s*\(/],
];

/** `console.log`, `debugger`, `print(` and `dbg!` on added lines outside tests, scripts and CLIs, as nits. */
export const debugOutput: Script = ({ files }, data) => {
  const exclude = Array.isArray(data?.exclude) && data.exclude.every((g) => typeof g === 'string') ? (data.exclude as string[]) : PRINTS;
  return files
    .filter((f) => !TEST.test(f.filename) && !matches(f.filename, exclude))
    .flatMap((f) => {
      const kinds = KINDS.filter(([exts]) => exts.test(f.filename));
      if (!kinds.length) return [];
      return [...diffLines(f.patch, true)].flatMap(([line, text]) => {
        if (/^\s*(?:\/\/|#|\*)/.test(text)) return [];
        const hit = kinds.find(([, , p]) => p.test(text));
        return hit
          ? [{ severity: 'nit' as const, file: f.filename, line, title: `Debug output: \`${hit[1]}\``, body: `This added line has \`${hit[1]}\`, which looks left over from debugging. Remove it, or use the project's logger if the output is meant to stay.` }]
          : [];
      });
    });
};
