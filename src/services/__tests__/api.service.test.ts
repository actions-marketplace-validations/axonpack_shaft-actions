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
const { fetchGrant, fetchPushToken, keyNameAllowed, reportRun } = await import('../api.service');
const { version } = await import('../../../package.json');

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
  process.env.GITHUB_ACTION_REF = 'v1.5.0';
});

/** What every POST /v1/token also sends: this build's version and the ref the workflow runs it at. */
const action = { version, ref: 'v1.5.0' };

const review = { job: 'review', event: 'push' } as const;
const job = {
  type: 'review',
  version: 2,
  options: { on: ['opened', 'push'], depth: 'deep', nits: 'off' },
  checks: ['correctness'],
  prompt: { template: '# Review {{repo}}', passes: [{ name: 'correctness', description: 'd', prompt: 'p' }] },
};
const run = { run: true, github_token: 'ghs_shaft', claude_token: { kind: 'oauth', value: 'sk-ant-oat-shaft' }, settings: { model: 'opus' }, job };
/** The failure `fetchGrant` threw, as its code, message and url. */
const failure = (p: Promise<unknown>) => p.then(
  () => expect.unreachable(),
  (e) => ({ code: e.code, message: e.message, url: e.url }),
);

test("POST /v1/token sends the job and event, and the action's version and ref, with the OIDC token, and masks both tokens", async () => {
  answer(Response.json(run));
  expect(await fetchGrant(review)).toEqual(run);
  expect(audiences).toEqual(['https://api-shaft.axonpack.dev']);
  expect(requests[0].url).toBe('https://api-shaft.axonpack.dev/v1/token');
  expect(requests[0].init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer oidc-1' } });
  expect(JSON.parse(requests[0].init.body as string)).toEqual({ ...review, action });
  expect(masked).toEqual(['ghs_shaft', 'sk-ant-oat-shaft']);
});

test('a review sends whether the PR comes from a fork; one started from a comment has no event', async () => {
  answer(Response.json(run));
  await fetchGrant({ job: 'review', event: 'opened', fork: true });
  answer(Response.json(run));
  await fetchGrant({ job: 'review', fork: false });
  expect(requests.map((r) => JSON.parse(r.init.body as string))).toEqual([
    { job: 'review', event: 'opened', fork: true, action },
    { job: 'review', fork: false, action },
  ]);
});

test('a task sends no event', async () => {
  answer(Response.json(run));
  await fetchGrant({ job: 'task' });
  expect(JSON.parse(requests[0].init.body as string)).toEqual({ job: 'task', action });
});

test("POST /v1/push-token sends a fresh OIDC token and masks the push token; the API's refusal keeps its code", async () => {
  answer(Response.json({ push_token: 'ghs_push', branch: 'fix-login' }));
  expect(await fetchPushToken()).toEqual({ push_token: 'ghs_push', branch: 'fix-login' });
  expect(requests[0]).toMatchObject({ url: 'https://api-shaft.axonpack.dev/v1/push-token', init: { method: 'POST', headers: { authorization: 'Bearer oidc-1' } } });
  expect(masked).toEqual(['ghs_push']);
  answer(Response.json({ error: 'push_failed', message: 'The pull request comes from a fork.' }, { status: 403 }));
  expect(await failure(fetchPushToken())).toEqual({ code: 'push_failed', message: 'The pull request comes from a fork.', url: undefined });
  answer(Response.json({ branch: 'fix-login' }));
  expect(await failure(fetchPushToken())).toMatchObject({ code: 'api_error' });
});

test('run: false comes back with its reason, and nothing is masked', async () => {
  answer(Response.json({ run: false, reason: 'Code review is off for this repo.' }));
  expect(await fetchGrant(review)).toEqual({ run: false, reason: 'Code review is off for this repo.' });
  expect(masked).toEqual([]);
});

test("ask: run: false comes back with the comment to post, and its GitHub token is masked", async () => {
  const ask = { run: false, reason: 'A maintainer has to start the review of this fork.', comment: 'Comment `/review`.\n\n<!-- shaft:ask -->', github_token: 'ghs_ask' };
  answer(Response.json(ask));
  expect(await fetchGrant({ job: 'review', event: 'opened', fork: true })).toEqual(ask);
  expect(masked).toEqual(['ghs_ask']);
});

test('run: true without a token or the prompt is an api_error', async () => {
  for (const bad of [{ github_token: undefined }, { claude_token: null }, { job: { ...job, prompt: undefined } }, { job: { ...job, prompt: { template: 't' } } }]) {
    answer(Response.json({ ...run, ...bad }));
    expect(await failure(fetchGrant(review))).toEqual({
      code: 'api_error',
      message: 'The Axon Shaft API sent an incomplete answer. Rerun the job in a few minutes.',
      url: undefined,
    });
  }
});

test('an OpenCode grant masks every key, and needs no Claude token', async () => {
  const opencode = { model: 'openrouter/qwen', effort: 'high', keys: [{ name: 'OPENROUTER_API_KEY', value: 'sk-or-secret' }] };
  answer(Response.json({ ...run, claude_token: null, provider: 'opencode', opencode }));
  const grant = await fetchGrant(review);
  expect(grant).toMatchObject({ provider: 'opencode', opencode, claude_token: { value: '' } });
  expect(masked).toEqual(['ghs_shaft', 'sk-or-secret']);
});

test('an OpenCode key whose name could change what runs is opencode_key_refused', async () => {
  for (const name of ['NODE_OPTIONS', 'LD_PRELOAD', 'PATH', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'INPUT_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'openai_api_key', 'OPENCODE_CONFIG_CONTENT', 'X_KEY=1']) {
    answer(Response.json({ ...run, provider: 'opencode', opencode: { model: 'a/b', keys: [{ name, value: 'v' }] } }));
    expect((await failure(fetchGrant(review))).code).toBe('opencode_key_refused');
  }
});

test('key names: upper-case, ending in _KEY or _TOKEN, never a runner or loader variable', () => {
  expect(['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'AWS_SECRET_KEY', 'HF_TOKEN', 'OPENCODE_API_KEY', 'NODE_AUTH_TOKEN'].every(keyNameAllowed)).toBe(true);
  expect(['GITHUB_TOKEN', 'GITHUB_PAT_TOKEN', 'LD_KEY', 'ANTHROPIC_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'INPUT_KEY', 'ACTIONS_KEY', 'KEY', '_KEY', 'PATH', 'NODE_OPTIONS'].some(keyNameAllowed)).toBe(false);
});

test('ANTHROPIC_API_KEY is the one Anthropic name an OpenCode key may take', () => {
  expect(keyNameAllowed('ANTHROPIC_API_KEY')).toBe(true);
  expect(['ANTHROPIC_API_KEY_2', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_API_KEY'].some(keyNameAllowed)).toBe(false);
});

test('a missing id-token permission is missing_id_token and says which line to add', async () => {
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  answer(Response.json({}));
  expect(await failure(fetchGrant(review))).toMatchObject({ code: 'missing_id_token', message: expect.stringContaining('Add `permissions: id-token: write` to the workflow') });
  expect(requests).toEqual([]);
});

test("each API error keeps the API's code, message and url as given", async () => {
  const errors = [
    [404, { error: 'not_installed', message: 'Install AxonShaft on this repo.', url: 'https://github.com/apps/axonshaft/installations/new' }],
    [404, { error: 'not_a_project', message: 'Add this repo on the dashboard.', url: 'https://shaft.axonpack.dev/console/acme' }],
    [409, { error: 'no_claude_token', message: 'Save a Claude token.', url: 'https://shaft.axonpack.dev/console/acme/settings' }],
    [401, { error: 'oidc_invalid', message: 'Rerun the job.' }],
    [403, { error: 'event_not_allowed', message: 'Run it from a pull request.' }],
    [429, { error: 'rate_limited', message: 'Wait a minute and rerun the job.' }],
    [500, { error: 'api_error', message: 'Rerun the job.' }],
  ] as const;
  for (const [status, body] of errors) {
    answer(Response.json(body, { status }));
    expect(await failure(fetchGrant(review))).toEqual({ code: body.error, message: body.message, url: 'url' in body ? body.url : undefined });
  }
});

test("an error that isn't the API's JSON is an api_error with the status", async () => {
  answer(new Response('<html>Bad gateway</html>', { status: 502 }));
  expect(await failure(fetchGrant(review))).toEqual({ code: 'api_error', message: 'The Axon Shaft API answered 502. Rerun the job in a few minutes.', url: undefined });
  answer(Response.json({ error: 'not_installed' }, { status: 404 }));
  expect(await failure(fetchGrant(review))).toMatchObject({ code: 'api_error', message: 'The Axon Shaft API answered 404. Rerun the job in a few minutes.' });
});

test('a network error is api_unreachable and names the API', async () => {
  answer(new TypeError('fetch failed'));
  expect(await failure(fetchGrant(review))).toEqual({
    code: 'api_unreachable',
    message: "Couldn't reach the Axon Shaft API at https://api-shaft.axonpack.dev (fetch failed). Rerun the job in a few minutes.",
    url: undefined,
  });
});

const summary = { verdict: 'looks-good', model: 'sonnet', effort: 'medium', findings: { blocking: 0, should_fix: 1, nit: 2 }, duration_ms: 1000,
  tokens: { input: 1, output: 2, cache_read: 3, cache_write: 4 },
  output: { headline: 'h', claim: 'c', impact: 'i', scope: 's', not_checked: 'n', type: 'feature', confidence: 90, comment_url: '', checks: [], findings: [], fixed: 0 },
};

test('POST /v1/runs sends the summary with a fresh OIDC token', async () => {
  answer(new Response(null, { status: 204 }));
  await reportRun(summary);
  expect(requests[0].url).toBe('https://api-shaft.axonpack.dev/v1/runs');
  expect(JSON.parse(requests[0].init.body as string)).toEqual(summary);
  expect(warnings).toEqual([]);
});

test('POST /v1/runs sends the abuse events under both abuse and guardrail', async () => {
  const { recordEvent, resetAbuse } = await import('../../abuse/classify.service');
  resetAbuse();
  recordEvent({ id: 42, login: 'mallory' }, { rule: 'push.pipe_shell', severity: 'strike', where: 'push', excerpt: 'curl x | sh' });
  answer(new Response(null, { status: 204 }));
  await reportRun(summary);
  const body = JSON.parse(requests[0].init.body as string);
  expect(body.abuse).toMatchObject([{ user_id: 42, rule: 'push.pipe_shell' }]);
  expect(body.guardrail).toEqual(body.abuse);
  resetAbuse();
});

test('a failing /v1/runs is a warning, never an error', async () => {
  answer(new Response('', { status: 500 }));
  await expect(reportRun(summary)).resolves.toBeUndefined();
  answer(new TypeError('fetch failed'));
  await expect(reportRun(summary)).resolves.toBeUndefined();
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain("Couldn't record the run");
});
