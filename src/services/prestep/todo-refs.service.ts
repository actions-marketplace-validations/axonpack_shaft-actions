import type { Script } from '../../types/prestep.type';
import { diffLines } from '../../utils/render.util';
import { ISSUE_REF } from './pr-meta.service';

/** A TODO or FIXME note in a comment. */
const TODO = /(?:\/\/|#|\/\*|\*|<!--|--)\s*(TODO|FIXME)\b/;

/** A new TODO or FIXME on an added line that links no issue (`#123`, an issue URL or a tracker key such as `ENG-12`), as a nit. */
export const todoRefs: Script = ({ files }) =>
  files.flatMap((f) =>
    [...diffLines(f.patch, true)].flatMap(([line, text]) => {
      const m = TODO.exec(text);
      return m && !ISSUE_REF.test(text)
        ? [{ severity: 'nit' as const, file: f.filename, line, title: `${m[1]} with no issue`, body: `This ${m[1]} links no issue, so nobody will find it again. Add an issue link or \`#123\`, or do it now.` }]
        : [];
    }),
  );
