import { beforeEach, expect, test, vi } from 'vitest';

/** The job's state, as the runner hands the main step's `saveState` to the post step. */
const state = new Map<string, string>();
vi.doMock('@actions/core', () => ({
  warning: () => {},
  saveState: (k: string, v: string) => state.set(k, v),
  getState: (k: string) => state.get(k) ?? '',
  getIDToken: async () => 'oidc',
}));
const calls: Record<string, unknown>[] = [];
const call = async (p: Record<string, unknown>) => calls.push(p);
vi.doMock('@actions/github', () => ({ getOctokit: () => ({ rest: { checks: { update: call } } }) }));
let reported: unknown;

beforeEach(() => {
  state.clear();
  calls.length = 0;
  reported = undefined;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  vi.stubGlobal('fetch', async (_: string, init: RequestInit) => {
    reported = JSON.parse(init.body as string);
    return new Response(null, { status: 204 });
  });
});

/** The main step up to a review in progress, in its own module instance. */
async function mainStep() {
  vi.resetModules();
  const t = await import('../services/finalize.service');
  t.trackRun({ token: 'ghs_shaft', owner: 'acme', repo: 'widgets', runUrl: 'https://github.com/acme/widgets/actions/runs/9', started: Date.now(), secrets: [] });
  t.trackCheck(5, 'Axon Shaft / review');
  return t;
}

async function postStep() {
  vi.resetModules();
  await import('../post');
}

test("after the main step was killed, the post step closes what it left open as cancelled and reports the run", async () => {
  await mainStep();
  await postStep();
  await vi.waitFor(() => expect(reported).toBeDefined());
  const message = 'The run stopped before the review finished: the workflow was cancelled, timed out or crashed.';
  expect(calls[0]).toMatchObject({ check_run_id: 5, status: 'completed', conclusion: 'cancelled', output: { title: 'Cancelled', summary: message } });
  expect(reported).toEqual({ error: { code: 'cancelled', message }, duration_ms: expect.any(Number) });
});

test('after a normal finish the post step does nothing', async () => {
  const t = await mainStep();
  t.trackCheck(5);
  await t.finalize({ kind: 'finished' });
  await postStep();
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toEqual([]);
  expect(reported).toBeUndefined();
});

test('after the main step closed things, the post step only retries what failed and never reports twice', async () => {
  const t = await mainStep();
  t.trackCheck(5);
  await t.finalize({ kind: 'cancelled', message: 'The workflow was cancelled before the review finished.' });
  calls.length = 0;
  reported = undefined;
  // As if GitHub had refused the check's update in the main step.
  t.trackCheck(5, 'Axon Shaft / review');
  await postStep();
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]).toMatchObject({ check_run_id: 5, conclusion: 'cancelled' });
  expect(reported).toBeUndefined();
});

test('with no saved state (a skipped or dry run) the post step does nothing', async () => {
  await postStep();
  await new Promise((r) => setTimeout(r, 20));
  expect(calls).toEqual([]);
  expect(reported).toBeUndefined();
});
