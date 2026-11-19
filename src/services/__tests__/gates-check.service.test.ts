import { expect, test, vi } from 'vitest';
import type { Gate } from '../../utils/render.util';

const warnings: string[] = [];
vi.doMock('@actions/core', () => ({ warning: (s: string) => warnings.push(s) }));
const { gateResults, gatesConclusion, postGatesCheck } = await import('../gates-check.service');

const met: Gate = { gate: 'A migration has a rollback', status: 'met', reason: 'It has one.' };
const notMet: Gate = { gate: 'Docs are updated', status: 'not_met', reason: 'They are not.' };
const skipped: Gate = { gate: 'Endpoints have a test', status: 'not_applicable', reason: 'No endpoint changed.' };

test("each of the project's gates gets the review's result, by text, else by position, else not met", () => {
  expect(gateResults(['A migration has a rollback', 'Docs are updated'], [{ ...notMet, gate: ' docs ARE updated ' }, met])).toEqual([met, notMet]);
  expect(gateResults(['Endpoints have a test'], [{ ...skipped, gate: 'Endpoints are tested' }])).toEqual([skipped]);
  expect(gateResults(['A migration has a rollback', 'Docs are updated'], [met])).toEqual([
    met,
    { gate: 'Docs are updated', status: 'not_met', reason: "The review didn't report on this gate." },
  ]);
  expect(gateResults(['Docs are updated'])[0]!.status).toBe('not_met');
});

test('the check fails when a gate is not met; a gate that does not apply passes', () => {
  expect(gatesConclusion([met, skipped])).toBe('success');
  expect(gatesConclusion([met, notMet, skipped])).toBe('failure');
});

test('the check is posted on the head commit with the gates in its summary, and a refused token only warns', async () => {
  const create = vi.fn(async (_: object) => ({}));
  const octokit = { rest: { checks: { create } } } as any;
  await postGatesCheck(octokit, 'o', 'r', 'abc1234', [met, notMet], (s) => s.replace('rollback', '***'));
  expect(create).toHaveBeenCalledWith({
    owner: 'o',
    repo: 'r',
    name: 'Axon Shaft / gates',
    head_sha: 'abc1234',
    status: 'completed',
    conclusion: 'failure',
    output: {
      title: '1 of 2 gates not met',
      summary: '| | Gate | Why |\n|---|---|---|\n| ✓ | A migration has a *** | It has one. |\n| ✗ | Docs are updated | They are not. |',
    },
  });
  await postGatesCheck(octokit, 'o', 'r', 'abc1234', [met], (s) => s);
  expect(create.mock.calls[1]![0]).toMatchObject({ conclusion: 'success', output: { title: 'Every gate met or not applicable' } });

  create.mockRejectedValueOnce(new Error('Resource not accessible by integration'));
  await postGatesCheck(octokit, 'o', 'r', 'abc1234', [met], (s) => s);
  expect(warnings).toEqual([
    "Couldn't post the Axon Shaft / gates check: Resource not accessible by integration. The AxonShaft GitHub App needs the Checks (write) permission, approved on the repo's installation.",
  ]);
});
