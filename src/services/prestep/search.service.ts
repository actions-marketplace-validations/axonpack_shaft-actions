import type { Checkout } from '../../types/prestep.type';
import { matches } from '../../utils/auto-pick.util';
import { CODE } from '../../utils/facts.util';

/** Built, vendored and minified code, never searched. */
const BUILT = ['**/{dist,build,out,vendor,coverage,.next,.expo}/**', '**/*.min.*', '**/*.d.ts'];
/** The search's caps: files read, bytes read, names searched for and files listed per name. */
export const SEARCH_MAX = { files: 5000, bytes: 20_000_000, names: 50, perName: 20 };

/** A file that names a searched name, and the lines it does on. */
export type Hit = { file: string; lines: number[] };

const escape = (s: string) => s.replace(/[$]/g, '\\$');

/**
 * The code files in the checkout that name each of `names` as a whole word, with the lines, leaving
 * out built and vendored code. Searches at most `SEARCH_MAX.files` files and bytes and the first
 * `SEARCH_MAX.names` names, and `cut` says what it left out.
 */
export function search(checkout: Checkout, names: string[]): { hits: Map<string, Hit[]>; cut: string[] } {
  // ponytail: a whole-word text search, so a common name finds unrelated files and a renamed import is missed; a real module graph if that gets noisy.
  const cut: string[] = [];
  const wanted = [...new Set(names)];
  if (wanted.length > SEARCH_MAX.names) cut.push(`searched for the first ${SEARCH_MAX.names} of ${wanted.length} names`);
  const hits = new Map(wanted.slice(0, SEARCH_MAX.names).map((n) => [n, [] as Hit[]]));
  if (!hits.size) return { hits, cut };
  const any = new RegExp(`(?<![\\w$])(${[...hits.keys()].map(escape).join('|')})(?![\\w$])`, 'g');
  const files = checkout
    .find(['**/*'])
    .filter((p) => CODE.test(p) && !matches(p, BUILT))
    .sort();
  if (files.length > SEARCH_MAX.files) cut.push(`searched the first ${SEARCH_MAX.files} of ${files.length} code files`);
  let bytes = 0;
  for (const [i, file] of files.slice(0, SEARCH_MAX.files).entries()) {
    if (bytes > SEARCH_MAX.bytes) {
      cut.push(`stopped after ${SEARCH_MAX.bytes / 1e6} MB, with ${Math.min(files.length, SEARCH_MAX.files) - i} code files left`);
      break;
    }
    const text = checkout.read(file);
    if (!text) continue;
    bytes += text.length;
    if (text.search(any) < 0) continue;
    const found = new Map<string, number[]>();
    text.split('\n').forEach((l, n) => {
      for (const m of l.matchAll(any)) {
        const lines = found.get(m[1]!) ?? found.set(m[1]!, []).get(m[1]!)!;
        if (lines.at(-1) !== n + 1) lines.push(n + 1);
      }
    });
    for (const [name, lines] of found) hits.get(name)!.push({ file, lines });
  }
  return { hits, cut };
}
