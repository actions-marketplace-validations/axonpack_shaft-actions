import { expect, test } from 'vitest';
import { parseGates, parseReview, SCHEMA } from '../../services/agent.service';
import { type Gate, type Review, renderSummary } from '../render.util';

const review: Review = {
  verdict: 'looks-good',
  type: 'feature',
  confidence: 90,
  headline: 'Adds a column.',
  claim: 'add a column.',
  impact: 'none.',
  scope: '`db`',
  findings: [],
  resolved: [],
  checked: ['correctness'],
  not_checked: 'no builds were run.',
};
const gates: Gate[] = [
  { gate: 'A migration has a rollback', status: 'met', reason: 'down.sql drops the column.' },
  { gate: 'Public API changes update the docs', status: 'not_met', reason: 'docs/api.md | is unchanged.' },
  { gate: 'New endpoints have a test', status: 'not_applicable', reason: 'No endpoint changed.' },
];
const info = { sha: 'abc1234', repo: 'acme/widgets', models: { main: 'claude-haiku-4', subagents: [] }, effort: 'low', reason: '3 lines' };

test('the schema keeps gates optional, with their statuses and limit', () => {
  expect(SCHEMA.required).not.toContain('gates');
  expect(SCHEMA.properties.gates.maxItems).toBe(10);
  expect(SCHEMA.properties.gates.items.properties.status.enum).toEqual(['met', 'not_met', 'not_applicable']);
});

test('parseReview takes a reply with or without gates, and drops a malformed gate', () => {
  expect(parseReview(review)).not.toHaveProperty('gates');
  expect(parseReview({ ...review, gates })).toEqual({ ...review, gates });
  expect(parseGates([gates[0], { gate: 'x', status: 'maybe', reason: 'y' }, { gate: 'x', status: 'met' }, null])).toEqual([gates[0]]);
  expect(parseGates('met')).toBeUndefined();
});

test('the summary lists each gate with its mark and reason, right after the card', () => {
  const body = renderSummary({ ...review, gates }, [], undefined, info);
  expect(body).toContain(
    [
      '**Merge gates:** 2 of 3 met or not applicable',
      '',
      '| | Gate | Why |',
      '|---|---|---|',
      '| ✓ | A migration has a rollback | down.sql drops the column. |',
      '| ✗ | Public API changes update the docs | docs/api.md \\| is unchanged. |',
      '| – | New endpoints have a test | No endpoint changed. |',
    ].join('\n'),
  );
  expect(body.indexOf('Merge gates')).toBeLessThan(body.indexOf('What this PR does'));
});

test('without gates the summary has none', () => {
  expect(renderSummary(review, [], undefined, info)).not.toContain('Merge gates');
  expect(renderSummary({ ...review, gates: [] }, [], undefined, info)).not.toContain('Merge gates');
});
