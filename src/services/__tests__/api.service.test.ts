import { beforeEach, expect, test, vi } from 'vitest';

const masked: string[] = [];
const warnings: string[] = [];
const audiences: unknown[] = [];
vi.doMock('@actions/core', () => ({
  setSecret: (s: string) => masked.push(s),
  getIDToken: async (aud: string) => {
    audiences.push(aud);
    return `oidc-${audiences.length}`;
  },
  warning: (s: string) => warnings.push(s),
}));
const { fetchGrant, reportRun } = await import('../api.service');

const requests: { url: string; init: RequestInit }[] = [];
const answer = (res: Response | Error) =>
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  });

beforeEach(() => {
  masked.length = 0;
  warnings.length = 0;
  audiences.length = 0;
  requests.length = 0;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
});

const review = { job: 'review', event: 'push' } as const;
const job = { type: 'review', version: 1, options: { on: ['opened', 'push'], depth: 'deep', nits: 'off' }, instructions: '1. **Verify.**' };

test('POST /v1/token sends the job and event with the OIDC token, and masks both tokens', async () => {
  const run = { run: true, github_token: 'ghs_shaft', claude_token: { kind: 'oauth', value: 'sk-ant-oat-shaft' }, settings: { model: 'opus' }, job };
  answer(Response.json(run));
  expect(await fetchGrant(review)).toEqual(run);
  expect(audiences).toEqual(['https://api-shaft.axonpack.dev']);
  expect(requests[0].url).toBe('https://api-shaft.axonpack.dev/v1/token');
  expect(requests[0].init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer oidc-1' } });
  expect(JSON.parse(requests[0].init.body as string)).toEqual(review);
  expect(masked).toEqual(['ghs_shaft', 'sk-ant-oat-shaft']);
});

test('a task sends no event, and a run with no saved Claude token masks only the GitHub token', async () => {
  answer(Response.json({ run: true, github_token: 'ghs_shaft', claude_token: null, settings: {}, job }));
  await fetchGrant({ job: 'task' });
  expect(JSON.parse(requests[0].init.body as string)).toEqual({ job: 'task' });
  expect(masked).toEqual(['ghs_shaft']);
});

test('run: false comes back with its reason, and nothing is masked', async () => {
  answer(Response.json({ run: false, reason: 'Code review is off for this repo.' }));
  expect(await fetchGrant(review)).toEqual({ run: false, reason: 'Code review is off for this repo.' });
  expect(masked).toEqual([]);
});

test('run: true without a github_token fails', async () => {
  answer(Response.json({ run: true, claude_token: null, settings: {}, job }));
  await expect(fetchGrant(review)).rejects.toThrow('sent no github_token');
});

test('a missing id-token permission says which line to add', async () => {
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  answer(Response.json({}));
  await expect(fetchGrant(review)).rejects.toThrow('Add `permissions: id-token: write` to the workflow');
  expect(requests).toEqual([]);
});

test('404 not_installed links the install page the API sends', async () => {
  answer(Response.json({ error: 'not_installed', url: 'https://github.com/apps/axonshaft/installations/new?x=1' }, { status: 404 }));
  await expect(fetchGrant(review)).rejects.toThrow("isn't installed on this repo. Install it: https://github.com/apps/axonshaft/installations/new?x=1");
});

test('404 not_a_project links the dashboard page the API sends', async () => {
  answer(Response.json({ error: 'not_a_project', url: 'https://shaft.axonpack.dev/acme' }, { status: 404 }));
  await expect(fetchGrant(review)).rejects.toThrow("This repo isn't a project on Axon Shaft yet. Add it: https://shaft.axonpack.dev/acme");
});

test('a 404 without a body still links the install page', async () => {
  answer(new Response('', { status: 404 }));
  await expect(fetchGrant(review)).rejects.toThrow('Install it: https://github.com/apps/axonshaft/installations/new');
});

test('401 and 403 say the token was refused', async () => {
  answer(new Response('bad audience', { status: 401 }));
  await expect(fetchGrant(review)).rejects.toThrow("refused this run's OIDC token (401): bad audience");
  answer(new Response('', { status: 403 }));
  await expect(fetchGrant(review)).rejects.toThrow('(403)');
});

test('429 gives the Retry-After value', async () => {
  answer(new Response('', { status: 429, headers: { 'retry-after': '42' } }));
  await expect(fetchGrant(review)).rejects.toThrow('rate-limited this repo. Retry-After: 42.');
});

test('a network error names the API', async () => {
  answer(new TypeError('fetch failed'));
  await expect(fetchGrant(review)).rejects.toThrow("Couldn't reach the Axon Shaft API at https://api-shaft.axonpack.dev: fetch failed");
});

const summary = { verdict: 'looks-good', model: 'sonnet', effort: 'medium', findings: { blocking: 0, should_fix: 1, nit: 2 }, duration_ms: 1000 };

test('POST /v1/runs sends the summary with a fresh OIDC token', async () => {
  answer(new Response(null, { status: 204 }));
  await reportRun(summary);
  expect(requests[0].url).toBe('https://api-shaft.axonpack.dev/v1/runs');
  expect(JSON.parse(requests[0].init.body as string)).toEqual(summary);
  expect(warnings).toEqual([]);
});

test('a failing /v1/runs is a warning, never an error', async () => {
  answer(new Response('', { status: 500 }));
  await expect(reportRun(summary)).resolves.toBeUndefined();
  answer(new TypeError('fetch failed'));
  await expect(reportRun(summary)).resolves.toBeUndefined();
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain("Couldn't record the run");
});
