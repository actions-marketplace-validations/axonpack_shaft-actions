import { beforeEach, expect, test, vi } from 'vitest';

const warnings: string[] = [];
vi.doMock('@actions/core', () => ({ warning: (s: string) => warnings.push(s), saveState: () => {} }));
const calls: Record<string, unknown>[] = [];
let refuse = false;
const call = async (p: Record<string, unknown>) => {
  if (refuse) throw new Error('Bad credentials');
  calls.push(p);
};
vi.doMock('@actions/github', () => ({ getOctokit: () => ({ rest: { checks: { update: call }, issues: { updateComment: call } } }) }));

beforeEach(() => {
  warnings.length = 0;
  calls.length = 0;
  refuse = false;
  vi.resetModules();
});

const run = { token: 'ghs_shaft', owner: 'acme', repo: 'widgets', runUrl: 'https://github.com/acme/widgets/actions/runs/9', started: Date.now(), secrets: ['ghs_shaft'] };

test('after a normal finish, a check a code path forgot is closed as neutral with a warning; a completed one is left alone', async () => {
  const t = await import('../finalize.service');
  t.trackRun(run);
  t.trackCheck(5, 'Axon Shaft / review');
  t.trackCheck(5);
  t.trackCheck(6, 'Axon Shaft / security');
  await t.finalize({ kind: 'finished' });
  expect(calls).toEqual([
    {
      owner: 'acme',
      repo: 'widgets',
      check_run_id: 6,
      status: 'completed',
      conclusion: 'neutral',
      output: { title: 'Finished without a result', summary: 'Axon Shaft finished without a result for this check.' },
    },
  ]);
  expect(warnings).toEqual(["The Axon Shaft / security check was still in progress when the run finished, so it's closed as neutral."]);
});

test('nothing left open means no call to GitHub, and it runs only once', async () => {
  const t = await import('../finalize.service');
  t.trackRun(run);
  t.trackComment(8, false);
  await t.finalize({ kind: 'finished' });
  t.trackCheck(5, 'Axon Shaft / review');
  await t.finalize({ kind: 'failed', error: new Error('late') });
  expect(calls).toEqual([]);
});

test('a refused cleanup only warns, and finalize never throws', async () => {
  const t = await import('../finalize.service');
  t.trackRun(run);
  t.trackCheck(5, 'Axon Shaft / review');
  t.trackComment(8, true);
  refuse = true;
  await expect(t.finalize({ kind: 'failed', error: new Error('boom') })).resolves.toBeUndefined();
  expect(warnings).toEqual(["Couldn't close what the run left open: Bad credentials", "Couldn't close what the run left open: Bad credentials"]);
});

test('a failure message is redacted before it reaches the check run', async () => {
  const t = await import('../finalize.service');
  t.trackRun(run);
  t.trackCheck(5, 'Axon Shaft / review');
  await t.finalize({ kind: 'failed', error: new Error('git said ghs_shaft is invalid') });
  expect(JSON.stringify(calls)).not.toContain('ghs_shaft');
  expect(calls[0]).toMatchObject({ conclusion: 'failure', output: { summary: expect.stringContaining('errors/review_failed.svg') } });
});
