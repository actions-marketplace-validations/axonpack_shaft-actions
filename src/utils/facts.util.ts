/** The facts' cap: about 4k tokens at 4 characters a token. */
export const FACTS_MAX = 16_000;

/** A source file, by extension, in the languages the checklists cover. */
export const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|rb|java|kts?|swift|php|cs|vue|svelte|dart|scala|exs?|c|cc|cpp|h|hpp|m|mm)$/;
/** A test file: in a test folder, or named as one (`*.test.ts`, `test_*.py`, `*_test.go`, `FooTest.kt`). */
export const TEST = /(?:^|\/)(?:__tests__|tests?|spec|e2e)\/|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$|_test\.(?:go|py)$|Tests?\.(?:java|kt|swift|cs)$/;
/** A docs file: prose by extension, or anything under `docs/`, `doc/` or `notes/`. Changelogs and changesets aren't docs here. */
export const DOCS = /\.(?:md|mdx|markdown|rst|adoc|txt)$|(?:^|\/)(?:docs?|notes)\//i;
export const isDocs = (path: string) => DOCS.test(path) && !/(?:^|\/)(?:CHANGELOG[^/]*|\.changeset\/.*)$/i.test(path) && !/(?:^|\/)requirements[^/]*\.txt$/.test(path);

/** Facts as text: one line each, `none` when there are none, cut at about 4k tokens with a line saying how many were left out. */
export function factsText(lines: string[], none: string): string {
  if (!lines.length) return none;
  let text = '';
  for (const [i, l] of lines.entries()) {
    if (text.length + l.length > FACTS_MAX) return `${text}... and ${lines.length - i} more lines, cut to fit.`;
    text += `${l}\n`;
  }
  return text.trimEnd();
}
