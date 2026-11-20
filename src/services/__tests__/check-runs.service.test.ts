import { beforeEach, expect, test, vi } from 'vitest';
import type { Gate, Placed } from '../../utils/render.util';

const warnings: string[] = [];
beforeEach(() => {
  warnings.length = 0;
});
vi.doMock('@actions/core', () => ({ warning: (s: string) => warnings.push(s) }));
const { gateResults, gatesConclusion, postCategoryChecks, postCheck, postGatesCheck, progressSummary } = await import('../check-runs.service');

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
  const create = vi.fn(async (_: object) => ({ data: { id: 1 } }));
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

const finding: Placed = { severity: 'blocking', step: 'correctness', file: 'src/a.ts', line: 3, title: 'Wrong sum', body: 'It adds twice.', fp: 'abc123', inline: false };

test('each review check that is on gets its own run, its conclusion from its state, its findings in the summary', async () => {
  const create = vi.fn(async (_: object) => ({ data: { id: 1 } }));
  const octokit = { rest: { checks: { create } } } as any;
  const states = [
    { key: 'correctness', state: 'failed' as const },
    { key: 'standards', state: 'warned' as const },
    { key: 'tests', state: 'passed' as const },
    { key: 'docs', state: 'not_checked' as const },
    { key: 'security', state: 'off' as const },
  ];
  await postCategoryChecks(octokit, 'o', 'r', 'abc1234', states, [finding, { ...finding, severity: 'nit', step: 'standards' }], (s) => s);
  expect(create.mock.calls.map(([c]: any) => `${c.name}:${c.conclusion}`)).toEqual([
    'Axon Shaft / correctness:failure',
    'Axon Shaft / standards:neutral',
    'Axon Shaft / tests:success',
    'Axon Shaft / docs:skipped',
  ]);
  expect(create.mock.calls[0]![0]).toEqual({
    owner: 'o',
    repo: 'r',
    name: 'Axon Shaft / correctness',
    head_sha: 'abc1234',
    status: 'completed',
    conclusion: 'failure',
    output: {
      title: 'Blocking findings',
      summary:
        '| Severity | Where | Finding | Details |\n|---|---|---|---|\n| 🔴 Blocking | [`src/a.ts:3`](https://github.com/o/r/blob/abc1234/src/a.ts#L3) | Wrong sum | It adds twice. |',
    },
  });
  expect(create.mock.calls[2]![0]).toMatchObject({ output: { title: 'Checked, nothing found', summary: 'Checked, nothing found' } });
});

test("a check's details link is the page of its most severe finding that has one, and unset when none has", async () => {
  const create = vi.fn(async (_: object) => ({ data: { id: 1 } }));
  const osv = { ...finding, step: 'osv', title: 'lodash 4.17.21 has a known vulnerability (GHSA-xxxx)' };
  const found: Placed[] = [
    { ...osv, severity: 'should-fix', url: 'https://osv.dev/vulnerability/PYSEC-2026-5' },
    { ...osv, url: 'https://github.com/advisories/GHSA-xxxx' },
    // A blocking finding with no ID has no page, so it doesn't pick the link.
    { ...osv, title: 'No ID' },
  ];
  const states = [
    { key: 'osv', state: 'failed' as const },
    { key: 'correctness', state: 'failed' as const },
  ];
  await postCategoryChecks({ rest: { checks: { create } } } as any, 'o', 'r', 'abc1234', states, [...found, finding], (s) => s);
  expect(create.mock.calls[0]![0]).toMatchObject({ name: 'Axon Shaft / osv', details_url: 'https://github.com/advisories/GHSA-xxxx' });
  expect((create.mock.calls[0]![0] as any).output.summary).toContain('| [lodash 4.17.21 has a known vulnerability (GHSA-xxxx)](https://github.com/advisories/GHSA-xxxx) |');
  expect(create.mock.calls[1]![0]).not.toHaveProperty('details_url');
});

test("a checklist that didn't run is skipped with its reason as the title and summary", async () => {
  const create = vi.fn(async (_: object) => ({ data: { id: 1 } }));
  await postCategoryChecks({ rest: { checks: { create } } } as any, 'o', 'r', 'abc1234', [{ key: 'migrations', state: 'not_checked', reason: 'No matching files changed' }], [], (s) => s);
  expect(create.mock.calls[0]![0]).toMatchObject({
    name: 'Axon Shaft / migrations',
    conclusion: 'skipped',
    output: { title: 'No matching files changed', summary: 'No matching files changed' },
  });
});

test('a token without Checks write warns once and the remaining category runs are skipped', async () => {
  const create = vi.fn(async (_: object) => {
    throw new Error('Resource not accessible by integration');
  });
  const states = [
    { key: 'correctness', state: 'passed' as const },
    { key: 'tests', state: 'passed' as const },
  ];
  await postCategoryChecks({ rest: { checks: { create } } } as any, 'o', 'r', 'abc1234', states, [], (s) => s);
  expect(create).toHaveBeenCalledTimes(1);
  expect(warnings).toEqual([
    "Couldn't post the Axon Shaft / correctness check: Resource not accessible by integration. The AxonShaft GitHub App needs the Checks (write) permission, approved on the repo's installation.",
  ]);
});

test('a check run starts in progress, then the update by its id completes it; a refused start returns no id', async () => {
  const create = vi.fn(async (_: object) => ({ data: { id: 42 } }));
  const update = vi.fn(async (_: object) => ({ data: { id: 42 } }));
  const octokit = { rest: { checks: { create, update } } } as any;
  const id = await postCheck(octokit, 'o', 'r', 'abc1234', { name: 'Axon Shaft / review', title: 'Reviewing abc1234', summary: 'Running.' }, (s) => s);
  expect(id).toBe(42);
  expect(create).toHaveBeenCalledWith({ owner: 'o', repo: 'r', name: 'Axon Shaft / review', head_sha: 'abc1234', status: 'in_progress', output: { title: 'Reviewing abc1234', summary: 'Running.' } });
  await postCheck(octokit, 'o', 'r', 'abc1234', { name: 'Axon Shaft / review', id, conclusion: 'success', title: 'Reviewed', summary: 's', detailsUrl: 'https://x' }, (s) => s);
  expect(update).toHaveBeenCalledWith({
    owner: 'o',
    repo: 'r',
    name: 'Axon Shaft / review',
    check_run_id: 42,
    status: 'completed',
    conclusion: 'success',
    details_url: 'https://x',
    output: { title: 'Reviewed', summary: 's' },
  });

  create.mockRejectedValueOnce(new Error('Resource not accessible by integration'));
  expect(await postCheck(octokit, 'o', 'r', 'abc1234', { name: 'Axon Shaft / review', title: 't', summary: 's' }, (s) => s)).toBeUndefined();
  expect(warnings).toHaveLength(1);
});

test('the progress summary marks the steps done and the current one, with when it started', () => {
  expect(progressSummary('Review', 65_400)).toBe('- ✓ Read the pull request\n- ▶ **Review**\n- Post the review\n\nThis step started 1m 05s into the review.');
});
