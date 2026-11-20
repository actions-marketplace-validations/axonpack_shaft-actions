import { basename } from 'node:path';
import type { Facts } from '../../types/prestep.type';
import { CODE, factsText, TEST } from '../../utils/facts.util';

/** Where tests live, for finding the ones the pull request doesn't change. */
const TEST_GLOBS = ['**/__tests__/**', '**/{test,tests,spec,e2e}/**', '**/*.{test,spec}.*', '**/test_*.py', '**/*_test.{go,py}', '**/*{Test,Tests}.{java,kt,swift,cs}'];

/** A file's name with the test markers and the last extension taken off: `button.test.tsx`, `test_button.py` and `ButtonTest.kt` are `button`. */
const stem = (path: string) =>
  basename(path)
    .replace(/\.(?:test|spec)(?=\.[^.]+$)/, '')
    .replace(/^test_|_test(?=\.[^.]+$)|Tests?(?=\.[^.]+$)/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();

/**
 * The `test-pairs` facts: each changed source file with the changed test that has its name, or, when
 * none changed, a test in the repo that has its name or none; then changed tests no changed source
 * file matches. Paired by file name, so a test named after something else doesn't count.
 */
export const testPairs: Facts = async ({ files, checkout }) => {
  // ponytail: paired by file name only; an `index.ts` or a test named after a feature won't pair, read imports if that gets noisy.
  const tests = files.filter((f) => TEST.test(f.filename) && CODE.test(f.filename));
  const sources = files.filter((f) => CODE.test(f.filename) && !TEST.test(f.filename) && !/\.d\.[cm]?ts$/.test(f.filename) && f.status !== 'removed');
  if (!sources.length && !tests.length) return 'The pull request changes no source or test files.';
  const paired = sources.map((s) => ({ file: s.filename, tests: tests.filter((t) => stem(t.filename) === stem(s.filename)).map((t) => t.filename) }));
  const unpaired = paired.filter((p) => !p.tests.length);
  const existing = new Map<string, string[]>();
  if (unpaired.length)
    for (const t of checkout.find(TEST_GLOBS).sort())
      if (TEST.test(t) && CODE.test(t)) existing.set(stem(t), [...(existing.get(stem(t)) ?? []), t]);
  const used = new Set(paired.flatMap((p) => p.tests));
  const orphans = tests.filter((t) => !used.has(t.filename));
  return factsText(
    [
      `Changed source files with a changed test:${paired.length > unpaired.length ? '' : ' none'}`,
      ...paired.filter((p) => p.tests.length).map((p) => `- ${p.file}: ${p.tests.join(', ')}`),
      `Changed source files with no changed test:${unpaired.length ? '' : ' none'}`,
      ...unpaired.map((p) => {
        const found = existing.get(stem(p.file));
        return `- ${p.file}: ${found ? `has a test the pull request doesn't change: ${found.slice(0, 3).join(', ')}` : 'no test with its name in the repo'}`;
      }),
      ...(orphans.length ? ['Changed tests no changed source file matches by name:', ...orphans.map((t) => `- ${t.filename}${t.status === 'removed' ? ' (removed)' : ''}`)] : []),
    ],
    '',
  );
};
