import { beforeEach, expect, test, vi } from 'vitest';
import comment from '../services/__tests__/fixtures/issue_comment.created.json';
import fork from '../services/__tests__/fixtures/pull_request.fork.json';
import opened from '../services/__tests__/fixtures/pull_request.opened.json';

const inputs: string[] = [];
const failed: string[] = [];
const notices: string[] = [];
const infos: string[] = [];
const warnings: string[] = [];
let dryRun = false;
const masked: string[] = [];
let jobSummary = '';
let finished = false;
vi.doMock('@actions/core', () => ({
  getInput: (name: string) => {
    inputs.push(name);
    return '';
  },
  getBooleanInput: (name: string) => {
    inputs.push(name);
    return dryRun;
  },
  setFailed: (m: string) => failed.push(m),
  setSecret: (s: string) => masked.push(s),
  getIDToken: async () => 'oidc',
  saveState: () => {},
  info: (m: string) => infos.push(m),
  notice: (m: string) => notices.push(m),
  warning: (m: string) => warnings.push(m),
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
/** The reactions on the comment that started the run, in order; GitHub refuses them when `refuseReactions` is set. */
const reactions: string[] = [];
let refuseReactions = false;
const react = async ({ comment_id, content }: { comment_id: number; content: string }) => {
  if (refuseReactions) throw new Error('Resource not accessible by integration');
  reactions.push(`${content} on ${comment_id}`);
  return { data: { id: 77 } };
};
/** What closing the run's leftovers sent to GitHub: check run updates and comment edits, in order. */
const closed: Record<string, unknown>[] = [];
const unreact = async ({ comment_id, reaction_id }: { comment_id: number; reaction_id: number }) => reactions.push(`removed ${reaction_id} from ${comment_id}`);
vi.doMock('@actions/github', () => ({
  context,
  getOctokit: () => ({
    paginate: async () => existing,
    rest: {
      issues: { listComments: {}, createComment: async (p: unknown) => posted.push(p), updateComment: async (p: Record<string, unknown>) => closed.push(p) },
      checks: { update: async (p: Record<string, unknown>) => closed.push(p) },
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) },
      reactions: { createForIssueComment: react, deleteForIssueComment: unreact },
    },
  }),
}));
const checkedOut: unknown[][] = [];
vi.doMock('../services/checkout.service', () => ({ checkoutHead: (...args: unknown[]) => checkedOut.push(args) }));
let reviewed: Record<string, unknown> | undefined;
/** Runs inside the review, with the registry `main` sees, to leave check runs and the comment open. */
let during: ((t: typeof import('../services/finalize.service')) => Promise<void>) | undefined;
/** The error the review throws, made with the failure class `main` sees after `vi.resetModules()`. */
let reviewError: ((F: typeof import('../utils/failure.util').ShaftFailure) => Error) | undefined;
vi.doMock('../services/review.service', () => ({
  reviewPullRequest: async (o: Record<string, unknown>) => {
    reviewed = o;
    if (during) await during(await import('../services/finalize.service'));
    if (reviewError) throw reviewError((await import('../utils/failure.util')).ShaftFailure);
    return { ...outcome };
  },
}));

let replied: Record<string, unknown> | undefined;
let replyError: Error | undefined;
const answer = { answer: 'It retries in `src/retry.ts:42`.', comment_url: 'https://github.com/acme/widgets/pull/12#issuecomment-9' };
vi.doMock('../services/reply.service', () => ({
  replyToComment: async (o: Record<string, unknown>) => {
    replied = o;
    if (replyError) throw replyError;
    return { model: 'claude-sonnet-5-5', effort: 'medium', tokens, costUsd: 0.05, output: answer };
  },
}));

let tasked: Record<string, unknown> | undefined;
/** What the mocked task returns: a finished one, or one refused before its session. */
let taskOut: Record<string, unknown> = { model: 'claude-opus-5-5', effort: 'high', tokens: {}, costUsd: 0.5, output: { answer: 'Fixed it.', comment_url: '' } };
vi.doMock('../services/task.service', () => ({
  runTask: async (o: Record<string, unknown>) => {
    tasked = o;
    return taskOut;
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
/** What the action sent to /v1/token (without the action's version, which api.service.test.ts checks), and to /v1/runs. */
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
    const { action: _, ...rest } = JSON.parse(init.body as string);
    asked = rest;
    return token;
  });

/** Run the action once and wait for it to record the run, fail or end with a notice. A failure's job summary is written in the same tick as `setFailed`. */
async function main() {
  finished = false;
  await load();
  await vi.waitFor(() => expect(finished || failed.length > 0 || notices.length > 0).toBe(true));
}

/** Each import of `main` adds its own signal handlers, so only the newest one's stay. */
const baseline = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') };
async function load() {
  for (const s of ['SIGINT', 'SIGTERM'] as const) for (const l of process.listeners(s)) if (!baseline[s].includes(l)) process.off(s, l);
  vi.resetModules();
  await import('../main');
}

beforeEach(() => {
  closed.length = 0;
  during = undefined;
  context.eventName = 'pull_request';
  context.payload = opened;
  existing = [];
  posted.length = 0;
  permission = 'write';
  checkedOut.length = 0;
  asked = undefined;
  reported = undefined;
  notices.length = 0;
  infos.length = 0;
  warnings.length = 0;
  dryRun = false;
  reactions.length = 0;
  refuseReactions = false;
  inputs.length = 0;
  failed.length = 0;
  jobSummary = '';
  finished = false;
  reviewed = undefined;
  replied = undefined;
  replyError = undefined;
  tasked = undefined;
  taskOut = { model: 'claude-opus-5-5', effort: 'high', tokens, costUsd: 0.5, output: { answer: 'Fixed it.', comment_url: '' } };
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

test('a newer action release from the grant reaches the review, for the line under its card', async () => {
  const latest_action = { version: '1.6.2', url: 'https://github.com/axonpack/shaft-actions/releases/tag/v1.6.2' };
  api(Response.json({ ...grant, latest_action }));
  await main();
  expect(reviewed).toMatchObject({ latestAction: latest_action });
});

test("each missing permission's warning is logged once, and the review gets the list for its footer", async () => {
  const warning = 'The AxonShaft app needs Code quality (read). Approve it on GitHub.';
  const missing_permissions = [
    { name: 'code_quality', wanted: 'read', granted: null, warning },
    { name: 'code_quality', wanted: 'read', granted: null, warning },
    { name: 'checks', wanted: 'write', granted: 'read', warning: 'Checks (write) is approved only as read.' },
  ];
  api(Response.json({ ...grant, missing_permissions }));
  await main();
  expect(warnings).toEqual([warning, 'Checks (write) is approved only as read.']);
  expect(reviewed).toMatchObject({ missingPermissions: missing_permissions });
  api(Response.json(grant));
  await main();
  expect(reviewed?.missingPermissions).toEqual([]);
});

test('a maxTurns the dashboard left unset reaches the review unset, so it picks one by size', async () => {
  api(Response.json({ ...grant, settings: { ...grant.settings, maxTurns: null } }));
  await main();
  expect(failed).toEqual([]);
  expect(reviewed?.maxTurns).toBeUndefined();
});

test('a maxTurns the API marks as its default reaches the review unset; one set on the dashboard is kept', async () => {
  api(Response.json({ ...grant, settings: { ...grant.settings, maxTurnsDefault: true } }));
  await main();
  expect(reviewed?.maxTurns).toBeUndefined();
  api(Response.json({ ...grant, settings: { ...grant.settings, maxTurnsDefault: false } }));
  await main();
  expect(reviewed?.maxTurns).toBe(30);
});

test("pull_request sends the event, fork: false and the pull request, and reviews the workflow's checkout as it is", async () => {
  api(Response.json(grant));
  await main();
  expect(asked).toEqual({
    job: 'review',
    event: 'opened',
    fork: false,
    pull_request: { number: 12, title: 'Retry failed uploads', branch: 'retry-uploads', author: 'octocat', base: 'main', association: 'MEMBER', bot: false, labels: [] },
  });
  expect(checkedOut).toEqual([]);
  expect(reactions).toEqual([]);
});

test("pull_request_target is a review too: a fork's PR sends fork: true, and its head commit is checked out with the granted token", async () => {
  context.eventName = 'pull_request_target';
  context.payload = fork;
  api(Response.json(grant));
  await main();
  expect(failed).toEqual([]);
  expect(asked).toEqual({ job: 'review', event: 'push', fork: true, pull_request: { number: 13, title: 'Fix typo', branch: 'patch-1', author: 'stranger', base: 'main', association: 'FIRST_TIME_CONTRIBUTOR', bot: false, labels: [] },
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

test("run: false with a code links the notice to the code's docs; an older API's spending_cap also gets a card in the job summary", async () => {
  context.eventName = 'pull_request_target';
  context.payload = fork;
  api(Response.json({ run: false, reason: 'Axon Shaft is paused on this repo.', code: 'paused' }));
  await main();
  expect(notices).toEqual(['Axon Shaft is paused on this repo. See https://shaft.axonpack.dev/docs/reference/codes#paused']);
  expect(jobSummary).toBe('');
  notices.length = 0;
  api(Response.json({ run: false, reason: 'At the cap.', notice: 'spending_cap' }));
  await main();
  expect(notices).toEqual(['At the cap. See https://shaft.axonpack.dev/docs/reference/codes#spending_cap']);
  expect(jobSummary).toBe('[![At the cap.](https://shaft.axonpack.dev/errors/spending_cap.svg)](https://shaft.axonpack.dev/docs/reference/codes#spending_cap)\n\nAt the cap.');
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
  expect(asked).toEqual({ job: 'review', pull_request: { number: 12, title: 'Retry failed uploads', author: 'octocat', labels: [] } });
  expect(checkedOut).toEqual([[process.env.GITHUB_WORKSPACE ?? process.cwd(), 12, 'ghs_shaft']]);
  expect(reviewed).toMatchObject({ number: 12 });
});

test("/review by someone without write access starts nothing, and the notice says who can", async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  permission = 'read';
  api(Response.json(grant));
  await main();
  expect(notices).toEqual(['maintainer has no write access, so no review was started. Only people with write access can start one with /review. See https://shaft.axonpack.dev/docs/reference/codes#no_write_access']);
  expect(checkedOut).toEqual([]);
  expect(reviewed).toBeUndefined();
  expect(reactions).toEqual([]);
});

const SWAPPED = ['eyes on 501', 'removed 77 from 501'];

test('a /review comment gets 👀 at the start, swapped for 🚀 once the review is posted', async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  api(Response.json(grant));
  await main();
  await vi.waitFor(() => expect(reactions).toEqual([...SWAPPED, 'rocket on 501']));
});

test('a failed review swaps the 👀 for 😕', async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  api(Response.json(grant));
  reviewError = () => new Error('Not Found');
  await main();
  await vi.waitFor(() => expect(reactions).toEqual([...SWAPPED, 'confused on 501']));
});

test("/help gets 👀 with the API's token, then 🚀 once the list is posted", async () => {
  context.eventName = 'issue_comment';
  context.payload = { ...comment, comment: { ...comment.comment, body: '/help' } };
  const help = { run: false, reason: 'Posted the list of commands.', comment: 'The commands.\n\n<!-- shaft:help -->', github_token: 'ghs_help' };
  api(Response.json(help));
  await main();
  expect(posted).toEqual([{ owner: 'acme', repo: 'widgets', issue_number: 12, body: help.comment }]);
  await vi.waitFor(() => expect(reactions).toEqual([...SWAPPED, 'rocket on 501']));
});

test('a comment that gets a token but nothing to post adds no reaction', async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  api(Response.json({ run: false, reason: 'Nothing to do.', github_token: 'ghs_none' }));
  await main();
  expect(posted).toEqual([]);
  expect(notices).toEqual(['Nothing to do.']);
  expect(reactions).toEqual([]);
});

test('a dry run logs both reactions and posts neither', async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  dryRun = true;
  api(Response.json(grant));
  await main();
  await vi.waitFor(() => expect(infos).toContain('Would swap 👀 for 🚀 on the comment that started the run'));
  expect(infos).toContain('Would react 👀 to the comment that started the run');
  expect(reactions).toEqual([]);
});

test('a refused 👀 only warns: the review still runs, with no reaction at the end', async () => {
  context.eventName = 'issue_comment';
  context.payload = asks;
  refuseReactions = true;
  api(Response.json(grant));
  await main();
  expect(failed).toEqual([]);
  expect(reviewed).toMatchObject({ number: 12 });
  expect(warnings).toEqual(["Couldn't add 👀 on the comment that started the run: Resource not accessible by integration"]);
});

const replyGrant = { ...grant, run_url: 'https://shaft.axonpack.dev/runs/8', job: { type: 'reply', version: 1, options: {}, checks: [], prompt: { template: '# Reply {{question}}', passes: [] } } };
const asksQuestion = { ...comment, comment: { ...comment.comment, body: '/ask why retry?' } };

test('/ask by someone with write access answers at the head commit with the Reply prompt, and reports the answer with no verdict', async () => {
  context.eventName = 'issue_comment';
  context.payload = asksQuestion;
  api(Response.json(replyGrant));
  await main();
  expect(failed).toEqual([]);
  expect(asked).toEqual({ job: 'reply', pull_request: { number: 12, title: 'Retry failed uploads', author: 'octocat', labels: [] } });
  expect(checkedOut).toEqual([[process.env.GITHUB_WORKSPACE ?? process.cwd(), 12, 'ghs_shaft']]);
  expect(replied).toMatchObject({
    number: 12,
    ask: { id: 501, text: '/ask why retry?' },
    asker: 'maintainer',
    template: '# Reply {{question}}',
    claude: { kind: 'oauth', value: 'sk-ant-oat-shaft' },
    effort: 'auto',
    maxTurns: 30,
    timeoutMinutes: 15,
    env: ['NODE_OPTIONS'],
    dashboardRunUrl: 'https://shaft.axonpack.dev/runs/8',
  });
  expect(reviewed).toBeUndefined();
  expect(reported).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium', duration_ms: expect.any(Number), tokens, output: answer });
});

test("/ask by someone without write access answers nothing, and the notice says who can", async () => {
  context.eventName = 'issue_comment';
  context.payload = asksQuestion;
  permission = 'read';
  api(Response.json(replyGrant));
  await main();
  expect(notices).toEqual(["maintainer has no write access, so the question wasn't answered. Only people with write access can ask with /ask. See https://shaft.axonpack.dev/docs/reference/codes#no_write_access"]);
  expect(checkedOut).toEqual([]);
  expect(replied).toBeUndefined();
});

test('/ask gets 👀, swapped for 🚀 once the answer is posted', async () => {
  context.eventName = 'issue_comment';
  context.payload = asksQuestion;
  api(Response.json(replyGrant));
  await main();
  await vi.waitFor(() => expect(reactions).toEqual([...SWAPPED, 'rocket on 501']));
});

test('a failed /ask swaps the 👀 for 😕', async () => {
  context.eventName = 'issue_comment';
  context.payload = asksQuestion;
  replyError = new Error('Not Found');
  api(Response.json(replyGrant));
  await main();
  await vi.waitFor(() => expect(reactions).toEqual([...SWAPPED, 'confused on 501']));
});

const taskGrant = { ...grant, settings: { ...grant.settings, pushMode: 'restricted' }, job: { type: 'task', version: 1, options: {}, checks: [], prompt: { template: '# Task {{request}}', passes: [] } } };

test("/fix asks for a task grant with no push token, runs it with the project's variables masked and taken out of what it posts, and reports its reply", async () => {
  context.eventName = 'issue_comment';
  process.env.NODE_OPTIONS = '--max-old-space-size=4096';
  masked.length = 0;
  context.payload = comment;
  api(Response.json(taskGrant));
  await main();
  expect(failed).toEqual([]);
  expect(asked).toEqual({ job: 'task', pull_request: { number: 12, title: 'Retry failed uploads', author: 'octocat', labels: [] } });
  expect(checkedOut).toEqual([[process.env.GITHUB_WORKSPACE ?? process.cwd(), 12, 'ghs_shaft']]);
  expect(tasked).toMatchObject({
    ask: { id: 501, text: '/fix the failing test please' },
    asker: 'maintainer',
    bare: false,
    template: '# Task {{request}}',
    pushMode: 'restricted',
    repoUrl: 'https://github.com/acme/widgets',
    env: ['NODE_OPTIONS'],
  });
  expect(tasked).not.toHaveProperty('pushToken');
  expect(tasked!.secrets).toEqual(expect.arrayContaining(['ghs_shaft', '--max-old-space-size=4096']));
  expect(masked).toContain('--max-old-space-size=4096');
  expect(reported).toEqual({ model: 'claude-opus-5-5', effort: 'high', duration_ms: expect.any(Number), tokens, output: { answer: 'Fixed it.', comment_url: '' } });
});

test('a task that refuses to push ends with a notice and reports push_failed with the reason', async () => {
  context.eventName = 'issue_comment';
  context.payload = comment;
  taskOut = { refused: 'Pushing is turned off for this project.', code: 'push_failed' };
  api(Response.json(taskGrant));
  await main();
  expect(failed).toEqual([]);
  expect(notices).toEqual(['Pushing is turned off for this project. See https://shaft.axonpack.dev/docs/reference/codes#push_failed']);
  expect(reported).toEqual({ error: { code: 'push_failed', message: 'Pushing is turned off for this project.' }, duration_ms: expect.any(Number) });
});

test('/fix from someone without write access starts nothing, and the notice says who can', async () => {
  context.eventName = 'issue_comment';
  context.payload = comment;
  permission = 'read';
  api(Response.json(taskGrant));
  await main();
  expect(notices).toEqual(['maintainer has no write access, so nothing was changed. Only people with write access can start a change with /fix or /axonshaft. See https://shaft.axonpack.dev/docs/reference/codes#no_write_access']);
  expect(tasked).toBeUndefined();
});

test("an API error fails the step with the API's message, and the job summary shows its card, message and link", async () => {
  const message = 'Add this repo on the dashboard, then rerun the job.';
  api(Response.json({ error: 'not_a_project', message, url: 'https://shaft.axonpack.dev/console/acme' }, { status: 404 }));
  await main();
  expect(failed).toEqual([message]);
  expect(jobSummary).toBe(
    `[![${message}](https://shaft.axonpack.dev/errors/not_a_project.svg)](https://shaft.axonpack.dev/docs/reference/codes#not_a_project)\n\n${message}\n\n<https://shaft.axonpack.dev/console/acme>`,
  );
  expect(reviewed).toBeUndefined();
});

test('without id-token: write, the card is missing_id_token, with no link', async () => {
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  await main();
  expect(failed).toEqual(['Add `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.']);
  expect(jobSummary).toBe(
    '[![Add `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.](https://shaft.axonpack.dev/errors/missing_id_token.svg)](https://shaft.axonpack.dev/docs/reference/codes#missing_id_token)\n\nAdd `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.',
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
    '[![The review ran past its 15-minute time limit.](https://shaft.axonpack.dev/errors/review_timed_out.svg)](https://shaft.axonpack.dev/docs/reference/codes#review_timed_out)\n\nThe review ran past its 15-minute time limit.\n\n<https://shaft.axonpack.dev>',
  );
});

test('a review that fails mid-way closes the check runs it left open as failed, and swaps "Reviewing" for the failure card', async () => {
  api(Response.json(grant));
  during = async (t) => {
    t.trackCheck(5, 'Axon Shaft / review');
    t.trackCheck(6, 'Axon Shaft / gates');
    t.trackCheck(6);
    t.trackComment(8, true);
  };
  reviewError = (F) => new F('review_timed_out', 'The review ran past its 15-minute time limit.');
  await main();
  await vi.waitFor(() => expect(closed).toHaveLength(2));
  // Only the run still in progress: the one already completed is left alone.
  expect(closed[0]).toEqual({
    owner: 'acme',
    repo: 'widgets',
    check_run_id: 5,
    status: 'completed',
    conclusion: 'failure',
    output: { title: 'The review failed', summary: expect.stringContaining('errors/review_timed_out.svg') },
  });
  expect(closed[1]).toMatchObject({ comment_id: 8, body: expect.stringContaining('The review ran past its 15-minute time limit.') });
});

test('a cancel closes the open check runs as cancelled, swaps "Reviewing" for the cancelled card, reports the run and exits', async () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
  api(Response.json(grant));
  let inReview!: () => void;
  const started = new Promise<void>((r) => (inReview = r));
  during = async (t) => {
    t.trackCheck(5, 'Axon Shaft / review');
    t.trackComment(8, true);
    inReview();
    await new Promise(() => {}); // the session still running
  };
  await load();
  await started;
  process.emit('SIGINT', 'SIGINT');
  await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  exit.mockRestore();
  expect(closed[0]).toMatchObject({
    check_run_id: 5,
    conclusion: 'cancelled',
    output: { title: 'Cancelled', summary: 'The workflow was cancelled before the review finished.' },
  });
  expect(closed[1]).toMatchObject({ comment_id: 8, body: expect.stringContaining('errors/cancelled.svg') });
  expect(reported).toEqual({ error: { code: 'cancelled', message: 'The workflow was cancelled before the review finished.' }, duration_ms: expect.any(Number) });
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
