import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

vi.doMock('@actions/core', () => ({ info: () => {} }));
const { applySuggestions, fixStart, openFindings, taskRequest } = await import('../fix.service');
type OpenFinding = import('../fix.service').OpenFinding;

const HEAD = 'abc123';
const TEXT = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n');
const checkout = (text = TEXT) => {
  const cwd = mkdtempSync(join(tmpdir(), 'shaft-fix-'));
  writeFileSync(join(cwd, 'a.ts'), text);
  return cwd;
};
/** A finding on `a.ts` whose suggestion replaces lines `start`-`end` with `text`. */
const suggested = (fp: string, start: number, end: number, text: string, sha = HEAD): OpenFinding => ({
  fp,
  file: 'a.ts',
  line: end,
  severity: 'should-fix',
  title: fp,
  suggestion: { start, end, sha, text },
});

test('several suggestions in one file land where the review put them, even when one changes the line count', () => {
  const cwd = checkout();
  // The first turns one line into three; the second still replaces the original line five.
  const out = applySuggestions(cwd, HEAD, [suggested('s1', 2, 2, 'two\ntwo and a half\ntwo and three quarters'), suggested('s2', 5, 5, 'FIVE')]);
  expect(out.applied.map((f) => f.fp)).toEqual(['s1', 's2']);
  expect(out.unapplied).toEqual([]);
  expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe(['one', 'two', 'two and a half', 'two and three quarters', 'three', 'four', 'FIVE', 'six'].join('\n'));
});

test('overlapping suggestions are both left to the model, and the others still apply', () => {
  const cwd = checkout();
  const out = applySuggestions(cwd, HEAD, [suggested('s1', 2, 3, 'X'), suggested('s2', 3, 4, 'Y'), suggested('s3', 6, 6, 'SIX'), suggested('s4', 1, 1, '')]);
  expect(out.applied.map((f) => f.fp)).toEqual(['s3', 's4']);
  expect(out.unapplied.map((u) => [u.finding.fp, u.why])).toEqual([
    ['s1', 'it overlaps another suggestion'],
    ['s2', 'it overlaps another suggestion'],
  ]);
  // An empty suggestion deletes its line.
  expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe(['two', 'three', 'four', 'five', 'SIX'].join('\n'));
});

test("a suggestion out of the file's range, from another commit, or through a link is refused", () => {
  const cwd = checkout();
  symlinkSync(join(cwd, 'a.ts'), join(cwd, 'link.ts'));
  const out = applySuggestions(cwd, HEAD, [
    suggested('zero', 0, 1, 'x'),
    suggested('backwards', 3, 2, 'x'),
    suggested('past', 6, 7, 'x'),
    suggested('moved', 1, 1, 'x', 'other'),
    { ...suggested('link', 1, 1, 'x'), file: 'link.ts' },
  ]);
  expect(out.applied).toEqual([]);
  expect(out.unapplied.map((u) => [u.finding.fp, u.why])).toEqual([
    ['moved', 'the pull request moved since the review'],
    ['zero', "its lines aren't in the file"],
    ['backwards', "its lines aren't in the file"],
    ['past', "its lines aren't in the file"],
    ['link', "the file couldn't be changed"],
  ]);
  expect(readFileSync(join(cwd, 'a.ts'), 'utf8')).toBe(TEXT);
});

test("only our own inline comment for a finding in the summary's state counts, and its suggestion only on the finding's file", () => {
  const state = (findings: object[]) => `<!-- shaft:summary -->\n<!-- shaft:state ${JSON.stringify({ sha: HEAD, findings })} -->`;
  const finding = { fp: 'f1', file: 'a.ts', line: 2, severity: 'blocking', title: 'Wrong' };
  const body = '**Blocking** · security\n\nIt leaks.\n\n```suggestion\nfixed\n```\n\n<!-- shaft:finding f1 -->';
  const comment = (o: object) => ({ id: 1, author: 'axonshaft[bot]', trusted: false, html_url: '', path: 'a.ts', line: 2, commit_id: HEAD, body, ...o });
  const ctx = (comments: object[]) => ({ summary: { body: state([finding]) }, reviewComments: comments }) as never;
  const [ours] = openFindings(ctx([comment({})]), 'axonshaft[bot]');
  expect(ours).toMatchObject({ step: 'security', body: '**Blocking** · security\n\nIt leaks.\n\n```suggestion\nfixed\n```', suggestion: { start: 2, end: 2, sha: HEAD, text: 'fixed' } });
  expect(openFindings(ctx([comment({ author: 'mallory' })]), 'axonshaft[bot]')[0]).toEqual(finding);
  expect(openFindings(ctx([comment({ path: 'b.ts' })]), 'axonshaft[bot]')[0]!.suggestion).toBeUndefined();
  expect(openFindings(ctx([comment({ line: null })]), 'axonshaft[bot]')[0]!.suggestion).toBeUndefined();
  expect(fixStart([ours!])).toEqual({ level: 'normal', reason: 'bare /fix of 1 finding, one blocking' });
  expect(taskRequest({ id: 1, text: '/fix' }, [ours!], true)).toContain('<finding>\n**Blocking** · security');
});
