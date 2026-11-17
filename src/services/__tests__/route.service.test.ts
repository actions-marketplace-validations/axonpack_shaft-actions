import { expect, test } from 'vitest';
import type { Octokit } from '../../types/octokit.type';
import { forcedReviewDenial, hasWriteAccess, route } from '../route.service';
import comment from './fixtures/issue_comment.created.json';
import fork from './fixtures/pull_request.fork.json';
import opened from './fixtures/pull_request.opened.json';
import review from './fixtures/pull_request_review.submitted.json';
import reviewComment from './fixtures/pull_request_review_comment.created.json';
import push from './fixtures/push.json';

const quiet = (r: ReturnType<typeof route>) => r.mode === 'skip' && !r.notice;

test('pull_request opened, synchronize, reopened, ready_for_review: review, with the event the API gets', () => {
  const events = { opened: 'opened', reopened: 'opened', synchronize: 'push', ready_for_review: 'ready' };
  for (const [action, event] of Object.entries(events)) {
    expect(route('pull_request', { ...opened, action })).toEqual({ mode: 'review', number: 12, event });
  }
});

test('other pull_request actions exit quietly', () => {
  expect(quiet(route('pull_request', { ...opened, action: 'closed' }))).toBe(true);
});

test('a PR from a fork is skipped with a notice', () => {
  expect(route('pull_request', fork)).toMatchObject({ mode: 'skip', notice: true, reason: 'PR #13 is from a fork, which gets no secrets, so it was skipped.' });
});

test('comments and reviews that mention @axonshaft: task', () => {
  expect(route('issue_comment', comment)).toEqual({ mode: 'task', number: 12, actor: 'maintainer' });
  expect(route('pull_request_review_comment', reviewComment)).toEqual({ mode: 'task', number: 12, actor: 'maintainer' });
  expect(route('pull_request_review', review)).toEqual({ mode: 'task', number: 12, actor: 'maintainer' });
});

test('a comment without the mention, an edit, or a bot comment exits quietly', () => {
  expect(quiet(route('issue_comment', { ...comment, comment: { ...comment.comment, body: 'thanks!' } }))).toBe(true);
  expect(quiet(route('issue_comment', { ...comment, action: 'edited' }))).toBe(true);
  expect(quiet(route('issue_comment', { ...comment, sender: { login: 'x[bot]', type: 'Bot' } }))).toBe(true);
});

test('only @axonshaft starts a task; another phrase such as /review is skipped', () => {
  expect(quiet(route('issue_comment', { ...comment, comment: { ...comment.comment, body: '/review' } }))).toBe(true);
});

test('anything else exits quietly', () => {
  expect(quiet(route('push', push))).toBe(true);
});

test('mode review forces a review of the event PR, and needs one', () => {
  expect(route('issue_comment', comment, { mode: 'review' })).toEqual({ mode: 'review', number: 12, actor: 'maintainer' });
  expect(route('pull_request', { ...opened, action: 'labeled' }, { mode: 'review' })).toMatchObject({ mode: 'review', number: 12 });
  expect(route('workflow_dispatch', push, { mode: 'review' })).toMatchObject({ mode: 'skip', notice: true });
});

test('mode review refuses a PR from a fork, as auto does', () => {
  expect(route('pull_request', fork, { mode: 'review' })).toEqual({ mode: 'skip', notice: true, reason: 'PR #13 is from a fork, which gets no secrets, so it was skipped.' });
});

test('a forced review needs write access from its sender, and a PR whose branch is in this repo', async () => {
  const octokit = (permission: string, head: string) =>
    ({
      rest: {
        repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) },
        pulls: { get: async () => ({ data: { head: { repo: { full_name: head } }, base: { repo: { full_name: 'acme/widgets' } } } }) },
      },
    }) as unknown as Octokit;
  const deny = (permission: string, head: string) => forcedReviewDenial(octokit(permission, head), 'acme', 'widgets', 12, 'someone');
  expect(await deny('write', 'acme/widgets')).toBeUndefined();
  expect(await deny('read', 'acme/widgets')).toBe('someone has no write access, so no review was started.');
  expect(await deny('admin', 'stranger/widgets')).toBe('PR #12 is from a fork, so no review was started.');
});

test('write access: admin and write pass, the rest do not', async () => {
  const octokit = (permission: string) =>
    ({ rest: { repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) } } }) as unknown as Octokit;
  for (const [permission, ok] of [['admin', true], ['write', true], ['read', false], ['none', false]] as const) {
    expect(await hasWriteAccess(octokit(permission), 'acme', 'widgets', 'maintainer')).toBe(ok);
  }
});
