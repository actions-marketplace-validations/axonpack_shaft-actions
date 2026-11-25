import { dirname, join } from 'node:path';
import type { Facts } from '../../types/prestep.type';
import { CODE, factsText, isDocs, TEST } from '../../utils/facts.util';

/**
 * The `docs-touched` facts: the docs, README and `notes/` files the pull request changes, and for the
 * code it changes, the nearest README above it that it leaves alone. Changelogs and changesets are
 * left to `changeset`.
 */
export const docsTouched: Facts = async ({ files, checkout }) => {
  const docs = files.filter((f) => isDocs(f.filename));
  const code = files.filter((f) => CODE.test(f.filename) && !TEST.test(f.filename) && f.status !== 'removed');
  const readmes = new Map<string, number>();
  const has = new Map<string, boolean>();
  for (const f of code) {
    for (let dir = dirname(f.filename); ; dir = dirname(dir)) {
      const readme = join(dir, 'README.md');
      if (!has.has(readme)) has.set(readme, checkout.read(readme) !== undefined);
      if (has.get(readme)) {
        readmes.set(readme, (readmes.get(readme) ?? 0) + 1);
        break;
      }
      if (dir === '.' || dir === '/') break;
    }
  }
  const untouched = [...readmes].filter(([r]) => !docs.some((d) => d.filename === r));
  if (!docs.length && !code.length) return '';
  return factsText(
    [
      `Docs the pull request changes:${docs.length ? '' : ' none'}`,
      ...docs.map((f) => `- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`),
      `Code files changed, not counting tests: ${code.length}`,
      ...(untouched.length ? ['The nearest README above the changed code, not changed:', ...untouched.map(([r, n]) => `- ${r} (above ${n} changed file${n === 1 ? '' : 's'})`)] : []),
    ],
    '',
  );
};
