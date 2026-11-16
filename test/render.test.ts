import { expect, test } from 'bun:test';
import { parseReview } from '../src/features/review/services/agent.service';
import {
  diffLines,
  type Finding,
  fingerprint,
  inlineBody,
  parseState,
  place,
  redact,
  type Review,
  renderSummary,
  stateLine,
  startSummary,
  unposted,
} from '../src/features/review/utils/render.util';

const patch = '@@ -40,4 +40,5 @@ export function retry() {\n   const max = 3;\n-  let attempt = max;\n+  let attempt = max;\n+  // retry\n   while (attempt < max) {\n   }';
const files = [{ filename: 'src/retry.ts', patch }, { filename: 'src/retry.test.ts', patch: '@@ -1,1 +1,2 @@\n import x;\n+test();' }];

const finding = (f: Partial<Finding>): Finding => ({
  severity: 'should-fix',
  step: 'correctness',
  file: 'src/retry.ts',
  line: 41,
  title: 'a title',
  body: 'a body',
  ...f,
});

const review: Review = {
  verdict: 'needs-changes',
  type: 'bug-fix',
  confidence: 85,
  headline: '`retry()` never retries, so the fix this PR is for does not take effect.',
  claim: 'retry failed uploads up to 3 times.',
  impact: 'uploads that fail once still fail.',
  scope: '`packages/upload`, both platforms.',
  findings: [
    finding({ severity: 'blocking', title: 'retry loop never runs again', suggestion: 'let attempt = 0;' }),
    finding({ file: 'src/retry.test.ts', line: 2, title: 'no test for a failure followed by a success', step: 'tests' }),
    finding({ file: 'src/config.ts', line: 10, title: 'default changed from 5 to 3, not in the changeset', body: 'See `.changeset/x.md:1`.' }),
    finding({ severity: 'nit', line: 42, title: 'comment says nothing' }),
    finding({ severity: 'nit', line: 43, title: 'loop could be a for' }),
  ],
  resolved: ['aaaaaa'],
  not_checked: 'no tests or builds were run.',
};

test('diffLines maps new-side line numbers to their text', () => {
  expect([...diffLines(patch).keys()]).toEqual([40, 41, 42, 43, 44]);
  expect(diffLines(patch).get(42)).toBe('  // retry');
  expect(diffLines(undefined).size).toBe(0);
});

test('inline for lines in the diff, the summary for the rest; nits follow the nits input', () => {
  const where = (nits: string) => place(review.findings, files, nits).map((p) => `${p.severity}:${p.inline}`);
  expect(where('summary')).toEqual(['blocking:true', 'should-fix:true', 'should-fix:false', 'nit:false', 'nit:false']);
  expect(where('inline')).toEqual(['blocking:true', 'should-fix:true', 'should-fix:false', 'nit:true', 'nit:true']);
  expect(where('off')).toEqual(['blocking:true', 'should-fix:true', 'should-fix:false']);
});

test('a range goes inline only when every line of it is in the diff', () => {
  expect(place([finding({ line: 43, end_line: 44 })], files, 'summary')[0].inline).toBe(true);
  expect(place([finding({ line: 44, end_line: 46 })], files, 'summary')[0].inline).toBe(false);
});

test('the fingerprint survives the line moving, and changes with the title', () => {
  const moved = '@@ -50,2 +50,3 @@\n+\n+  let attempt = max;\n   x';
  const a = place([finding({ line: 41 })], files, 'summary')[0].fp;
  const b = place([finding({ line: 51 })], [{ filename: 'src/retry.ts', patch: moved }], 'summary')[0].fp;
  expect(a).toBe(b);
  expect(a).toMatch(/^[0-9a-f]{6}$/);
  expect(fingerprint({ file: 'src/retry.ts', title: 'other' }, '  let attempt = max;')).not.toBe(a);
});

test('dedupe: an inline finding already posted is not posted again', () => {
  const placed = place(review.findings, files, 'summary');
  const old = [{ body: inlineBody(placed[0]) }, { body: 'a human comment' }];
  expect(unposted(placed, old).map((p) => p.title)).toEqual(['no test for a failure followed by a success']);
});

test('the inline comment format', () => {
  const [p] = place(review.findings, files, 'summary');
  expect(inlineBody(p)).toBe(
    `**Blocking** · correctness\n\na body\n\n\`\`\`suggestion\nlet attempt = 0;\n\`\`\`\n\n<!-- shaft:finding ${p.fp} -->`,
  );
});

test('the summary format', () => {
  const placed = place(review.findings, files, 'summary');
  const prior = { sha: 'f00', findings: [{ fp: 'aaaaaa', file: 'src/retry.ts', line: 30, severity: 'blocking' as const, title: 'unhandled rejection' }] };
  const body = renderSummary(review, placed, prior, {
    sha: 'a1b2c3d4e5f6',
    runUrl: 'https://github.com/acme/widgets/actions/runs/1',
    models: 'claude-sonnet-5',
    effort: 'medium',
    reason: '412 lines',
  });
  const [text, state] = [body.slice(0, body.lastIndexOf('\n')), body.slice(body.lastIndexOf('\n') + 1)];
  expect(text).toBe(`<!-- shaft:summary -->
**Needs changes** · Bug fix · 85% confidence

\`retry()\` never retries, so the fix this PR is for does not take effect.

**Claim:** retry failed uploads up to 3 times.
**Impact:** uploads that fail once still fail.
**Scope:** \`packages/upload\`, both platforms.

**Findings**
- **Blocking** \`src/retry.ts:41\` retry loop never runs again (inline)
- **Should fix** \`src/retry.test.ts:2\` no test for a failure followed by a success (inline)
- **Should fix** \`src/config.ts:10\` default changed from 5 to 3, not in the changeset (outside the diff)
  See \`.changeset/x.md:1\`.
- 2 nits

**Fixed since last review:** 1 (\`src/retry.ts:30\` unhandled rejection)

**Not checked:** no tests or builds were run.

<sub>Shaft · reviewed \`a1b2c3d\` · [run](https://github.com/acme/widgets/actions/runs/1) · claude-sonnet-5 · medium · 412 lines</sub>`);
  expect(parseState(state)).toEqual({
    sha: 'a1b2c3d4e5f6',
    findings: placed.map(({ fp, file, line, severity, title }) => ({ fp, file, line, severity, title })),
  });
});

test('a looks-good review with no findings has no Findings section', () => {
  const body = renderSummary({ ...review, verdict: 'looks-good', findings: [], resolved: [] }, [], undefined, {
    sha: 'abc1234',
    models: 'claude-haiku-4',
    effort: 'low',
    reason: '3 lines, docs and config only',
  });
  expect(body).toStartWith('<!-- shaft:summary -->\n**Looks good** · Bug fix');
  expect(body).not.toContain('**Findings**');
});

test('the state line survives a title with --> in it', () => {
  const state = { sha: 'abc', findings: [{ fp: '123456', file: 'a.ts', line: 1, severity: 'nit' as const, title: 'x --> y' }] };
  expect(stateLine(state)).not.toContain('x -->');
  expect(parseState(`text\n${stateLine(state)}`)).toEqual(state);
  expect(parseState('<!-- shaft:state {broken -->')).toBeUndefined();
});

test('the start text keeps the previous state', () => {
  const prior = { sha: 'abc', findings: [] };
  expect(parseState(startSummary('a1b2c3d4e5', prior))).toEqual(prior);
  expect(startSummary('a1b2c3d4e5')).toBe('<!-- shaft:summary -->\nReviewing `a1b2c3d`…');
});

test('redact replaces every secret', () => {
  expect(redact('token sk-ant-oat-12345678 and ghs_abcdefgh', ['sk-ant-oat-12345678', 'ghs_abcdefgh', ''])).toBe('token *** and ***');
});

test('parseReview accepts the schema and rejects a bad reply', () => {
  expect(parseReview(review)).toEqual(review);
  expect(parseReview({ ...review, verdict: 'great' })).toBeUndefined();
  expect(parseReview({ ...review, findings: [{ ...review.findings[0], line: '41' }] })).toBeUndefined();
  expect(parseReview('not json')).toBeUndefined();
});
