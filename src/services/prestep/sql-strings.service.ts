import type { Facts } from '../../types/prestep.type';
import { CODE, factsText, TEST } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

/** A query call whose SQL is built from a template literal with `${}`, an f-string, `%`, `.format(` or `+`. */
const CALL = /\b(?:query|execute|executemany|exec|raw|unsafe|\$?(?:query|execute)RawUnsafe)\s*\(\s*(?:`[^`]*\$\{|f["']|["'][^"']*["']\s*(?:\+|%\s*[\w(]|\.format\()|[\w.]+\s*\+)/;
/** SQL text joined with a value outside a call: `"SELECT ... " + id` or `` `SELECT ... ${id}` ``. Tagged `sql`...`` templates escape their values, so they're left out. */
const BUILT = /\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`"']*(?:["']\s*\+|\$\{)/i;
const AROUND = 2;

/**
 * The `sql-strings` facts: each added line outside tests that builds SQL from strings, with the lines
 * around it, so the model judges only those hunks. Empty when there's none, and then the model isn't called.
 */
export const sqlStrings: Facts = async ({ files }) =>
  factsText(
    files
      .filter((f) => CODE.test(f.filename) && !TEST.test(f.filename))
      .flatMap((f) => {
        const all = diffLines(f.patch);
        return [...diffLines(f.patch, true)]
          .filter(([, text]) => (CALL.test(text) || BUILT.test(text)) && !/\bsql`/.test(text))
          .map(([line]) => {
            const near = [...all].filter(([n]) => Math.abs(n - line) <= AROUND).map(([n, t]) => `    ${n === line ? '>' : ' '} ${n}: ${t}`);
            return `- ${f.filename}:${line}\n${near.join('\n')}`;
          });
      }),
    '',
  );
