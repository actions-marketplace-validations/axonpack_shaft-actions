import { expect, test } from 'vitest';
import type { Octokit } from '../../types/octokit.type';
import { commentOnce, hasWriteAccess, pullRequestOf, route } from '../route.service';
import comment from './fixtures/issue_comment.created.json';
import fork from './fixtures/pull_request.fork.json';
import opened from './fixtures/pull_request.opened.json';
import review from './fixtures/pull_request_review.submitted.json';
import reviewComment from './fixtures/pull_request_review_comment.created.json';
import push from './fixtures/push.json';

const quiet = (r: ReturnType<typeof route>) => r.mode === 'skip' && !r.notice;

test('pull_request and pull_request_target opened, synchronize, reopened, ready_for_review: review, with the event the API gets', () => {
  const events = { opened: 'opened', reopened: 'opened', synchronize: 'push', ready_for_review: 'ready' };
  for (const name of ['pull_request', 'pull_request_target']) {
    for (const [action, event] of Object.entries(events)) {
      expect(route(name, { ...opened, action })).toEqual({ mode: 'review', number: 12, event, fork: false });
    }
  }
});

test('other pull_request and pull_request_target actions exit quietly', () => {
  expect(quiet(route('pull_request', { ...opened, action: 'closed' }))).toBe(true);
  expect(quiet(route('pull_request_target', { ...opened, action: 'closed' }))).toBe(true);
});

test("on pull_request_target a fork's PR is reviewed, with fork: true for the API", () => {
  expect(route('pull_request_target', fork)).toEqual({ mode: 'review', number: 13, event: 'push', fork: true });
  const deleted = { ...fork, pull_request: { ...fork.pull_request, head: { ...fork.pull_request.head, repo: null } } };
  expect(route('pull_request_target', deleted)).toMatchObject({ mode: 'review', fork: true });
});

test("on pull_request a fork's PR has no OIDC token, so it's skipped with a notice", () => {
  expect(route('pull_request', fork)).toMatchObject({ mode: 'skip', notice: true, reason: expect.stringContaining('run the workflow on pull_request_target') });
});

test('/review in a comment on a PR: a review with no event, by the commenter', () => {
  const asks = (body: string) => ({ ...comment, comment: { ...comment.comment, body } });
  // An issue_comment's payload doesn't say where the PR's branch lives.
  expect(route('issue_comment', asks('/review please'))).toEqual({ mode: 'review', number: 12, fork: undefined, actor: 'maintainer' });
  expect(route('pull_request_review_comment', { ...reviewComment, comment: { ...reviewComment.comment, body: '/review' } })).toEqual({
    mode: 'review',
    number: 12,
    fork: false,
    actor: 'maintainer',
  });
  expect(route('pull_request_review', { ...review, review: { ...review.review, body: 'Done.\n/review' } })).toEqual({
    mode: 'review',
    number: 12,
    fork: false,
    actor: 'maintainer',
  });
  // On an issue there's no PR to review: it ends with a notice.
  expect(route('issue_comment', { ...asks('/review'), issue: { number: 3 } })).toMatchObject({ mode: 'skip', notice: true });
  // @axonshaft alone starts nothing any more.
  expect(quiet(route('issue_comment', asks('@axonshaft review')))).toBe(true);
  expect(quiet(route('issue_comment', { ...asks('/review'), sender: { login: 'x[bot]', type: 'Bot' } }))).toBe(true);
});

test('comments and reviews with /fix or /axonshaft: task, with the comment it came in', () => {
  expect(route('issue_comment', comment)).toEqual({ mode: 'task', number: 12, actor: 'maintainer', ask: { id: 501, text: '/fix the failing test please' }, bare: false });
  expect(route('pull_request_review_comment', reviewComment)).toEqual({
    mode: 'task',
    number: 12,
    actor: 'maintainer',
    ask: { id: 601, text: '/axonshaft can you rename this?', path: 'src/retry.ts', line: 42, thread: 601 },
    bare: false,
  });
  expect(route('pull_request_review', review)).toEqual({
    mode: 'task',
    number: 12,
    actor: 'maintainer',
    ask: { id: 701, text: 'Looks close.\n/axonshaft add a test for the retry path.' },
    bare: false,
  });
});

test('/ask on a line: a reply under the first comment of its thread, at the line, or the original line when the code moved', () => {
  const asks = (c: object) => ({ ...reviewComment, comment: { ...reviewComment.comment, body: '/ask why retry here?', ...c } });
  expect(route('pull_request_review_comment', asks({}))).toEqual({
    mode: 'reply',
    number: 12,
    actor: 'maintainer',
    ask: { id: 601, text: '/ask why retry here?', path: 'src/retry.ts', line: 42, thread: 601 },
  });
  expect(route('pull_request_review_comment', asks({ id: 602, in_reply_to_id: 600, line: null, original_line: 40 }))).toMatchObject({
    ask: { id: 602, line: 40, thread: 600 },
  });
});

test('a comment without the mention, an edit, or a bot comment exits quietly', () => {
  expect(quiet(route('issue_comment', { ...comment, comment: { ...comment.comment, body: 'thanks!' } }))).toBe(true);
  expect(quiet(route('issue_comment', { ...comment, action: 'edited' }))).toBe(true);
  expect(quiet(route('issue_comment', { ...comment, sender: { login: 'x[bot]', type: 'Bot' } }))).toBe(true);
});

test('a slash word that is not one of the commands, such as /deploy, starts nothing', () => {
  for (const body of ['/deploy', '/approve', 'review please'])
    expect(quiet(route('issue_comment', { ...comment, comment: { ...comment.comment, body } })), body).toBe(true);
});

test('anything else exits quietly', () => {
  expect(quiet(route('push', push))).toBe(true);
});

test("the pull request for the API comes from the payload; an issue_comment's has no branch, and one on an issue gives none", () => {
  const retry = { number: 12, title: 'Retry failed uploads', branch: 'retry-uploads', author: 'octocat', base: 'main', bot: false, labels: [] };
  expect(pullRequestOf(opened)).toEqual({ ...retry, association: 'MEMBER' });
  expect(pullRequestOf(review)).toEqual(retry);
  expect(pullRequestOf(reviewComment)).toEqual(retry);
  expect(pullRequestOf(fork)).toEqual({ number: 13, title: 'Fix typo', branch: 'patch-1', author: 'stranger', base: 'main', association: 'FIRST_TIME_CONTRIBUTOR', bot: false, labels: [] });
  expect(pullRequestOf({ pull_request: { ...opened.pull_request, user: { login: 'dependabot[bot]', type: 'Bot' } } })).toMatchObject({ author: 'dependabot[bot]', bot: true });
  expect(pullRequestOf(comment)).toEqual({ number: 12, title: 'Retry failed uploads', author: 'octocat', labels: [] });
  // The label names, from the pull request or, on an issue_comment, the issue.
  const labels = [{ id: 1, name: 'Skip-Review', color: 'ededed' }, { id: 2, name: 'bug', color: 'd73a4a' }];
  expect(pullRequestOf({ pull_request: { ...opened.pull_request, labels } })).toMatchObject({ labels: ['Skip-Review', 'bug'] });
  expect(pullRequestOf({ ...comment, issue: { ...comment.issue, labels } })).toMatchObject({ labels: ['Skip-Review', 'bug'] });
  expect(pullRequestOf({ ...comment, issue: { number: 3, title: 'Crash', user: { login: 'octocat' } } })).toBeUndefined();
  expect(pullRequestOf(push)).toBeUndefined();
});

test('write access: admin and write pass, the rest do not', async () => {
  const octokit = (permission: string) =>
    ({ rest: { repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) } } }) as unknown as Octokit;
  for (const [permission, ok] of [['admin', true], ['write', true], ['read', false], ['none', false]] as const) {
    expect(await hasWriteAccess(octokit(permission), 'acme', 'widgets', 'maintainer')).toBe(ok);
  }
});

test('commentOnce posts the comment, but not when our bot already posted its marker', async () => {
  const body = 'Someone with write access can start the review by commenting `/review`.\n\n<!-- shaft:ask -->';
  const run = async (existing: { user: { login: string }; body: string }[]) => {
    const posted: unknown[] = [];
    const octokit = {
      paginate: async () => existing,
      rest: { issues: { listComments: {}, createComment: async (p: unknown) => posted.push(p) } },
    } as unknown as Octokit;
    await commentOnce(octokit, 'acme', 'widgets', 13, body, 'axonshaft[bot]');
    return posted;
  };
  expect(await run([])).toEqual([{ owner: 'acme', repo: 'widgets', issue_number: 13, body }]);
  expect(await run([{ user: { login: 'axonshaft[bot]' }, body: 'An older wording.\n\n<!-- shaft:ask -->' }])).toEqual([]);
  // Someone else's copy of the marker doesn't stop it.
  expect(await run([{ user: { login: 'stranger' }, body: '<!-- shaft:ask -->' }])).toHaveLength(1);
});

test('a slash command at the start of a line: /review on a PR reviews; /fix is a task, /ask a reply, /help the list', () => {
  const says = (body: string) => ({ ...comment, comment: { ...comment.comment, body } });
  expect(route('issue_comment', says('/review'))).toEqual({ mode: 'review', number: 12, fork: undefined, actor: 'maintainer' });
  expect(route('issue_comment', says('Thanks!\n  /review please'))).toMatchObject({ mode: 'review' });
  expect(route('issue_comment', says('/fix the null check'))).toMatchObject({ mode: 'task', number: 12, actor: 'maintainer' });
  expect(route('issue_comment', says('/ask why is this async?'))).toEqual({ mode: 'reply', number: 12, actor: 'maintainer', ask: { id: 501, text: '/ask why is this async?' } });
  expect(route('issue_comment', says('/help'))).toEqual({ mode: 'help', number: 12, actor: 'maintainer' });
  expect(route('pull_request_review_comment', { ...reviewComment, comment: { ...reviewComment.comment, body: '/review' } })).toMatchObject({ mode: 'review' });
  // /review and /ask on an issue have no pull request to read.
  const onIssue = (body: string) => ({ ...says(body), issue: { ...comment.issue, pull_request: undefined } });
  expect(route('issue_comment', onIssue('/review'))).toMatchObject({ mode: 'skip', notice: true });
  expect(route('issue_comment', onIssue('/ask why?'))).toEqual({ mode: 'skip', reason: '/ask works on a pull request, not an issue.', notice: true });
  expect(route('issue_comment', onIssue('/fix it'))).toEqual({ mode: 'skip', reason: '/fix works on a pull request, not an issue.', notice: true });
  expect(route('issue_comment', onIssue('/axonshaft do it'))).toEqual({ mode: 'skip', reason: '/axonshaft works on a pull request, not an issue.', notice: true });
});

test('a bare /fix fixes the last review; anything else after it, or /axonshaft, is its own request', () => {
  const says = (body: string) => ({ ...comment, comment: { ...comment.comment, body } });
  for (const body of ['/fix', '  /fix  \n', '\n/fix\n']) expect(route('issue_comment', says(body)), body).toMatchObject({ mode: 'task', bare: true });
  for (const body of ['/fix the null check', 'Thanks.\n/fix', '/axonshaft']) expect(route('issue_comment', says(body)), body).toMatchObject({ mode: 'task', bare: false });
});

test('a command inside a sentence, a quote, inline code or a code block, or a longer word, starts nothing', () => {
  const says = (body: string) => ({ ...comment, comment: { ...comment.comment, body } });
  for (const body of ['please /review this', '> /review', 'run `/review` later', '```\n/review\n```', '/reviewer', '/fix-it', 'see /help/me'])
    expect(quiet(route('issue_comment', says(body))), body).toBe(true);
});

test("a bot's slash command is ignored", () => {
  const bot = { ...comment, comment: { ...comment.comment, body: '/review' }, sender: { ...comment.sender, type: 'Bot' } };
  expect(route('issue_comment', bot)).toMatchObject({ mode: 'skip' });
});
