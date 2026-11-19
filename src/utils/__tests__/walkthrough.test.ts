import { expect, test } from 'vitest';
import { parseReview, parseWalkthrough, SCHEMA } from '../../services/agent.service';
import { type Review, renderSummary, type Walkthrough } from '../render.util';

const review: Review = {
  verdict: 'looks-good',
  type: 'feature',
  confidence: 90,
  headline: 'Adds retries to uploads.',
  claim: 'retry failed uploads.',
  impact: 'fewer failed uploads.',
  scope: '`packages/upload`',
  findings: [],
  resolved: [],
  checked: ['correctness'],
  not_checked: 'no builds were run.',
};
const walkthrough: Walkthrough = {
  areas: [
    { name: 'Upload', files: ['src/upload.ts', 'src/retry.ts'], summary: 'Retries a failed upload up to 3 times.' },
    { name: 'Tests', files: ['src/retry.test.ts'], summary: 'Covers a failure | then a success.' },
  ],
  diagram: 'flowchart LR\n  A[upload] --> B{failed?}\n  B -->|yes| A',
};
const info = { sha: 'abc1234', repo: 'acme/widgets', models: 'claude-haiku-4', effort: 'low', reason: '3 lines' };

test('the schema keeps walkthrough optional, with its limits', () => {
  expect(SCHEMA.required).not.toContain('walkthrough');
  expect(SCHEMA.properties.walkthrough.properties.areas.maxItems).toBe(8);
});

test('parseReview takes a reply with or without a walkthrough', () => {
  expect(parseReview(review)).toEqual(review);
  expect(parseReview(review)).not.toHaveProperty('walkthrough');
  expect(parseReview({ ...review, walkthrough })).toEqual({ ...review, walkthrough });
});

test('an oversized or malformed walkthrough is dropped, and the review still posts', () => {
  const area = walkthrough.areas[0]!;
  const tooMany = { areas: Array.from({ length: 9 }, () => area) };
  const tooManyFiles = { areas: [{ ...area, files: Array.from({ length: 21 }, (_, i) => `f${i}.ts`) }] };
  expect(parseWalkthrough(tooMany)).toBeUndefined();
  expect(parseWalkthrough(tooManyFiles)).toBeUndefined();
  expect(parseWalkthrough({ areas: [{ name: 'x', files: 'a.ts', summary: 'y' }] })).toBeUndefined();
  expect(parseReview({ ...review, walkthrough: tooMany })).toEqual(review);
});

test('a diagram that is not a flowchart, is too long, could close its block or has a click link is left out', () => {
  const { areas } = walkthrough;
  for (const diagram of ['sequenceDiagram\n  A->>B: hi', `flowchart LR\n${'  A --> B\n'.repeat(400)}`, 'flowchart LR\n```\n![x](https://evil)', 'flowchart LR\n  A --> B\n  click A "https://evil"']) {
    expect(parseWalkthrough({ areas, diagram })).toEqual({ areas });
  }
});

test('the summary folds the walkthrough into a table and a mermaid block, before "What this PR does"', () => {
  const body = renderSummary({ ...review, walkthrough }, [], undefined, info);
  expect(body).toContain(
    [
      '<details><summary>Walkthrough</summary>',
      '',
      '| Area | Files | What changed |',
      '|---|---|---|',
      '| Upload | `src/upload.ts`<br>`src/retry.ts` | Retries a failed upload up to 3 times. |',
      '| Tests | `src/retry.test.ts` | Covers a failure \\| then a success. |',
      '',
      '```mermaid',
      walkthrough.diagram,
      '```',
      '',
      '</details>',
      '',
      '<details><summary>What this PR does</summary>',
    ].join('\n'),
  );
  const noDiagram = renderSummary({ ...review, walkthrough: { areas: walkthrough.areas } }, [], undefined, info);
  expect(noDiagram).toContain('<summary>Walkthrough</summary>');
  expect(noDiagram).not.toContain('```mermaid');
});

test('without a walkthrough the summary has none', () => {
  expect(renderSummary(review, [], undefined, info)).not.toContain('Walkthrough');
  expect(renderSummary({ ...review, walkthrough: { areas: [] } }, [], undefined, info)).not.toContain('Walkthrough');
});
