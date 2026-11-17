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

test('POST /v1/token with the OIDC token, and both tokens masked', async () => {
  answer(Response.json({ github_token: 'ghs_shaft', claude_token: { kind: 'oauth', value: 'sk-ant-oat-shaft' }, settings: {} }));
  const g = await fetchGrant();
  expect(g.github_token).toBe('ghs_shaft');
  expect(audiences).toEqual(['https://api-shaft.axonpack.dev']);
  expect(requests[0].url).toBe('https://api-shaft.axonpack.dev/v1/token');
  expect(requests[0].init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer oidc-1' } });
  expect(masked).toEqual(['ghs_shaft', 'sk-ant-oat-shaft']);
});

test('a missing id-token permission says which line to add', async () => {
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  answer(Response.json({}));
  await expect(fetchGrant()).rejects.toThrow('Add `permissions: id-token: write` to the workflow');
  expect(requests).toEqual([]);
});

test('404 links the app install page', async () => {
  answer(new Response('', { status: 404 }));
  await expect(fetchGrant()).rejects.toThrow("isn't installed on this repo. Install it: https://github.com/apps/axonshaft/installations/new");
});

test('401 and 403 say the token was refused', async () => {
  answer(new Response('bad audience', { status: 401 }));
  await expect(fetchGrant()).rejects.toThrow("refused this run's OIDC token (401): bad audience");
  answer(new Response('', { status: 403 }));
  await expect(fetchGrant()).rejects.toThrow('(403)');
});

test('429 gives the Retry-After value', async () => {
  answer(new Response('', { status: 429, headers: { 'retry-after': '42' } }));
  await expect(fetchGrant()).rejects.toThrow('rate-limited this repo. Retry-After: 42.');
});

test('a network error names the API', async () => {
  answer(new TypeError('fetch failed'));
  await expect(fetchGrant()).rejects.toThrow("Couldn't reach the Axon Shaft API at https://api-shaft.axonpack.dev: fetch failed");
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
