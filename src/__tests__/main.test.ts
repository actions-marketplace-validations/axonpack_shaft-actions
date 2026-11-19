import { beforeEach, expect, test, vi } from 'vitest';
import comment from '../services/__tests__/fixtures/issue_comment.created.json';
import fork from '../services/__tests__/fixtures/pull_request.fork.json';
import opened from '../services/__tests__/fixtures/pull_request.opened.json';

const inputs: string[] = [];
const failed: string[] = [];
const notices: string[] = [];
let jobSummary = '';
let finished = false;
vi.doMock('@actions/core', () => ({
  getInput: (name: string) => {
    inputs.push(name);
    return '';
  },
  getBooleanInput: (name: string) => {
    inputs.push(name);
    return false;
  },
  setFailed: (m: string) => failed.push(m),
  setSecret: () => {},
  getIDToken: async () => 'oidc',
  info: () => {},
  notice: (m: string) => notices.push(m),
  warning: () => {},
  setOutput: () => {},
  group: (_name: string, fn: () => Promise<unknown>) => fn(),
  summary: {
    addRaw(md: string) {
      jobSummary += md;
      return this;
    },
    write: async () => {},
  },
}));
const context = { eventName: 'pull_request', payload: opened as unknown, repo: { owner: 'acme', repo: 'widgets' }, serverUrl: 'https://github.com', runId: 9 };
/** GitHub, through the token the API granted: the PR's comments, what got posted and the commenter's permission. */
let existing: { user: { login: string }; body: string }[] = [];
const posted: unknown[] = [];
let permission = 'write';
vi.doMock('@actions/github', () => ({
  context,
  getOctokit: () => ({
    paginate: async () => existing,
    rest: {
      issues: { listComments: {}, createComment: async (p: unknown) => posted.push(p) },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) },
    },
  }),
}));
const checkedOut: unknown[][] = [];
vi.doMock('../services/checkout.service', () => ({ checkoutHead: (...args: unknown[]) => checkedOut.push(args) }));
let reviewed: Record<string, unknown> | undefined;
/** The error the review throws, made with the failure class `main` sees after `vi.resetModules()`. */
let reviewError: ((F: typeof import('../utils/failure.util').ShaftFailure) => Error) | undefined;
vi.doMock('../services/review.service', () => ({
  reviewPullRequest: async (o: Record<string, unknown>) => {
    reviewed = o;
    if (reviewError) throw reviewError((await import('../utils/failure.util')).ShaftFailure);
    return { ...outcome };
  },
}));

const tokens = { input: 120000, output: 6000, cache_read: 50000, cache_write: 6000 };
const output = { headline: 'h', claim: 'c', impact: 'i', scope: 's', not_checked: 'n', type: 'feature', confidence: 90, comment_url: '', checks: [], findings: [], fixed: 0 };
const outcome = { verdict: 'looks-good', findings: 0, summaryUrl: '', model: 'sonnet', effort: 'medium', bySeverity: { blocking: 0, should_fix: 0, nit: 0 }, tokens, costUsd: 0.42, output };

const prompt = { template: '# Review {{repo}}', passes: [] };
const grant = {
  run: true,
  github_token: 'ghs_shaft',
  claude_token: { kind: 'oauth', value: 'sk-ant-oat-shaft' },
  settings: { model: 'auto', effort: 'auto', rules: 'Use tabs.', skip: ['**/*.lock'], focus: ['src/core/**'], maxTurns: 30, timeLimit: 15, env: ['NODE_OPTIONS'] },
  job: { type: 'review', version: 2, options: { on: ['opened'], depth: 'standard', nits: 'summary' }, checks: ['correctness'], prompt },
};
/** What the action sent to /v1/token, and to /v1/runs. */
let asked: unknown;
let reported: Record<string, unknown> | undefined;
/** The API answers /v1/token with `token`, and /v1/runs with 204; the run is over once /v1/runs is called. */
const api = (token: Response) =>
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/v1/runs')) {
      reported = JSON.parse(init.body as string);
      finished = true;
      return new Response(null, { status: 204 });
    }
    asked = JSON.parse(init.body as string);
    return token;
  });

/** Run the action once and wait for it to record the run, fail or end with a notice. A failure's job summary is written in the same tick as `setFailed`. */
async function main() {
  vi.resetModules();
  await import('../main');
  await vi.waitFor(() => expect(finished || failed.length > 0 || notices.length > 0).toBe(true));
}

beforeEach(() => {
  context.eventName = 'pull_request';
  context.payload = opened;
  existing = [];
  posted.length = 0;
  permission = 'write';
  checkedOut.length = 0;
  asked = undefined;
  reported = undefined;
  notices.length = 0;
  inputs.length = 0;
  failed.length = 0;
  jobSummary = '';
  finished = false;
  reviewed = undefined;
  reviewError = undefined;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
});

test("a review reads only the dry_run input; everything else comes from the API's grant", async () => {
  api(Response.json(grant));
  await main();
  expect(failed).toEqual([]);
  expect(inputs).toEqual(['dry_run']);
  expect(reviewed).toMatchObject({
    number: 12,
    claude: { kind: 'oauth', value: 'sk-ant-oat-shaft' },
    model: 'auto',
    effort: 'auto',
    depth: 'standard',
    nits: 'summary',
    maxTurns: 30,
    timeoutMinutes: 15,
    skip: ['**/*.lock'],
    focus: ['src/core/**'],
    env: ['NODE_OPTIONS'],
    bot: 'axonshaft[bot]',
    prompt,
    checks: ['correctness'],
    dryRun: false,
  });
  expect(reviewed?.dashboardRunUrl).toBeUndefined();
});

test("the run's dashboard page from the grant reaches the review", async () => {
  api(Response.json({ ...grant, run_url: 'https://shaft.axonpack.dev/runs/7' }));
  await main();
  expect(reviewed).toMatchObject({ dashboardRunUrl: 'https://shaft.axonpack.dev/runs/7' });
});

test("pull_request sends the event, fork: false and the pull request, and reviews the workflow's checkout as it is", async () => {
  api(Response.json(grant));
  await main();
  expect(asked).toEqual({
    job: 'review',
    event: 'opened',
    fork: false,
    pull_request: { number: 12, title: 'Retry failed uploads', branch: 'retry-uploads', author: 'octocat', base: 'main', association: 'MEMBER', bot: false },
  });
  expect(checkedOut).toEqual([]);
});

test("pull_request_target is a review too: a fork's PR sends fork: true, and its head commit is checked out with the granted token", async () => {
  context.eventName = 'pull_request_target';
  context.payload = fork;
  api(Response.json(grant));
  await main();
  expect(failed).toEqual([]);
  expect(asked).toEqual({ job: 'review', event: 'push', fork: true, pull_request: { number: 13, title: 'Fix typo', branch: 'patch-1', author: 'stranger', base: 'main', association: 'FIRST_TIME_CONTRIBUTOR', bot: false },
  });
  expect(checkedOut).toEqual([[process.env.GITHUB_WORKSPACE ?? process.cwd(), 13, 'ghs_shaft']]);
  expect(reviewed).toMatchObject({ number: 13 });
});

const ask = {
  run: false,
  reason: 'This pull request comes from a fork, so a maintainer has to start its review.',
  comment: 'Someone with write access can start the review by commenting `/review`.\n\n<!-- shaft:ask -->',
  github_token: 'ghs_ask',
};

test("ask: the API's comment is posted once on the PR, and the step ends with a notice", async () => {
  context.eventName = 'pull_request_target';
  context.payload = fork;
  api(Response.json(ask));
  await main();
  expect(posted).toEqual([{ owner: 'acme', repo: 'widgets', issue_number: 13, body: ask.comment }]);
  expect(notices).toEqual([ask.reason]);
  expect(failed).toEqual([]);

  // The next push: the bot's comment with the marker is already there.
  posted.length = 0;
  notices.length = 0;
  existing = [{ user: { login: 'axonshaft[bot]' }, body: ask.comment }];
  api(Response.json(ask));
  await main();
  expect(posted).toEqual([]);
  expect(notices).toEqual([ask.reason]);
  expect(reviewed).toBeUndefined();
});

test('mention, or any other run: false, posts nothing and ends with a notice', async () => {
  context.eventName = 'pull_request_target';
  context.payload = fork;
  api(Response.json({ run: false, reason: 'A maintainer has to comment /review to review a fork.' }));
  await main();
  expect(posted).toEqual([]);
  expect(notices).toEqual(['A maintainer has to comment /review to review a fork.']);
  expect(failed).toEqual([]);
});

const asks = { ...comment, comment: { ...comment.comment, body: '/review' } };

test('the run report has the tokens, and the cost only for a run on an API key', async () => {
  api(Response.json(grant));
  await main();
  expect(reported).toMatchObject({ verdict: 'looks-good', tokens, output });
  expect(reported).not.toHaveProperty('cost_usd');
  api(Response.json({ ...grant, claude_token: { kind: 'api_key', value: 'sk-ant-api-shaft' } }));
  finished = false;
  await main();
  expect(reported).toMatchObject({ tokens, cost_usd: 0.42 });
});

test('/review by someone with write access reviews the PR, with no event and the pull request without its branch, at its head commit', async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  api(Response.json(grant));
  await main();
  expect(failed).toEqual([]);
  expect(asked).toEqual({ job: 'review', pull_request: { number: 12, title: 'Retry failed uploads', author: 'octocat' } });
  expect(checkedOut).toEqual([[process.env.GITHUB_WORKSPACE ?? process.cwd(), 12, 'ghs_shaft']]);
  expect(reviewed).toMatchObject({ number: 12 });
});

test("/review by someone without write access starts nothing, and the notice says who can", async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  permission = 'read';
  api(Response.json(grant));
  await main();
  expect(notices).toEqual(['maintainer has no write access, so no review was started. Only people with write access can start one with /review.']);
  expect(checkedOut).toEqual([]);
  expect(reviewed).toBeUndefined();
});

test("an API error fails the step with the API's message, and the job summary shows its card, message and link", async () => {
  const message = 'Add this repo on the dashboard, then rerun the job.';
  api(Response.json({ error: 'not_a_project', message, url: 'https://shaft.axonpack.dev/console/acme' }, { status: 404 }));
  await main();
  expect(failed).toEqual([message]);
  expect(jobSummary).toBe(
    `![${message}](https://shaft.axonpack.dev/errors/not_a_project.svg)\n\n${message}\n\n<https://shaft.axonpack.dev/console/acme>`,
  );
  expect(reviewed).toBeUndefined();
});

test('without id-token: write, the card is missing_id_token, with no link', async () => {
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  await main();
  expect(failed).toEqual(['Add `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.']);
  expect(jobSummary).toBe(
    '![Add `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.](https://shaft.axonpack.dev/errors/missing_id_token.svg)\n\nAdd `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.',
  );
});

test('an unreachable API is api_unreachable', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await main();
  expect(jobSummary).toContain('](https://shaft.axonpack.dev/errors/api_unreachable.svg)');
});

test('a review failure goes to the job summary too', async () => {
  api(Response.json(grant));
  reviewError = (F) => new F('review_timed_out', 'The review ran past its 15-minute time limit.', 'https://shaft.axonpack.dev');
  await main();
  expect(failed).toEqual(['The review ran past its 15-minute time limit.']);
  // The run's row is open, so the dashboard hears of the failure too.
  expect(reported).toEqual({ error: { code: 'review_timed_out', message: 'The review ran past its 15-minute time limit.' }, duration_ms: expect.any(Number) });
  expect(jobSummary).toBe(
    '![The review ran past its 15-minute time limit.](https://shaft.axonpack.dev/errors/review_timed_out.svg)\n\nThe review ran past its 15-minute time limit.\n\n<https://shaft.axonpack.dev>',
  );
});

test("a setting the action can't use is an api_error, before the review starts", async () => {
  api(Response.json({ ...grant, settings: { ...grant.settings, effort: 'huge' } }));
  await main();
  expect(failed[0]).toContain('The Axon Shaft API sent effort "huge"');
  expect(jobSummary).toContain('errors/api_error.svg');
  expect(reviewed).toBeUndefined();
});

test('an unknown error fails the step with no card', async () => {
  api(Response.json(grant));
  reviewError = () => new Error('Not Found');
  await main();
  expect(failed).toEqual(['Not Found']);
  expect(jobSummary).toBe('');
});
