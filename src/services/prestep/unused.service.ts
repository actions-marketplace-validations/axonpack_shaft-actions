import type { Facts } from '../../types/prestep.type';
import { capFacts } from '../../utils/facts.util';
import { changedExports, cutNote } from './callers.service';
import { search } from './search.service';

/** The `unused` facts: each name the pull request newly exports that no other code file in the checkout names. */
export const unused: Facts = async ({ files, checkout }) => {
  const added = new Map([...changedExports(files)].filter(([, at]) => at.kind === 'added'));
  if (!added.size) return 'The pull request exports no new name.';
  const { hits, cut } = search(checkout, [...added.keys()]);
  const lines = [...hits]
    .filter(([name, found]) => found.every((h) => h.file === added.get(name)!.file))
    .map(([name]) => {
      const { file, line } = added.get(name)!;
      return `- \`${name}\` (${file}${line ? `:${line}` : ''})`;
    });
  const head = lines.length ? `${lines.length} of the ${hits.size} new exports are named in no other code file:` : `Each of the ${hits.size} new exports is named in another code file.`;
  return capFacts([...cutNote(cut), head, ...lines], '');
};
