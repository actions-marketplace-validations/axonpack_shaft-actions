import { expect, test } from 'bun:test';
import type { Octokit } from '../../../../core/types/octokit.type';
import { hasWriteAccess, route } from '../route.service';
import comment from './fixtures/issue_comment.created.json';
import fork from './fixtures/pull_request.fork.json';
import opened from './fixtures/pull_request.opened.json';
import review from './fixtures/pull_request_review.submitted.json';
import reviewComment from './fixtures/pull_request_review_comment.created.json';
import push from './fixtures/push.json';

const quiet = (r: ReturnType<typeof route>) => r.mode === 'skip' && !r.notice;

test('pull_request opened, synchronize, reopened, ready_for_review: review', () => {
  for (const action of ['opened', 'synchronize', 'reopened', 'ready_for_review']) {
    expect(route('pull_request', { ...opened, action })).toEqual({ mode: 'review', number: 12 });
  }
});

test('other pull_request actions exit quietly', () => {
  expect(quiet(route('pull_request', { ...opened, action: 'closed' }))).toBe(true);
});

test('a PR from a fork is skipped with a notice', () => {
  expect(route('pull_request', fork)).toMatchObject({ mode: 'skip', notice: true, reason: expect.stringContaining('"@axonshaft review"') });
});

test('comments and reviews with the trigger phrase: task', () => {
  expect(route('issue_comment', comment)).toEqual({ mode: 'task', number: 12, actor: 'maintainer' });
  expect(route('pull_request_review_comment', reviewComment)).toEqual({ mode: 'task', number: 12, actor: 'maintainer' });
  expect(route('pull_request_review', review)).toEqual({ mode: 'task', number: 12, actor: 'maintainer' });
});

test('a comment without the phrase, an edit, or a bot comment exits quietly', () => {
  expect(quiet(route('issue_comment', { ...comment, comment: { ...comment.comment, body: 'thanks!' } }))).toBe(true);
  expect(quiet(route('issue_comment', { ...comment, action: 'edited' }))).toBe(true);
  expect(quiet(route('issue_comment', { ...comment, sender: { login: 'x[bot]', type: 'Bot' } }))).toBe(true);
});

test('trigger_phrase is configurable', () => {
  expect(route('issue_comment', comment, { triggerPhrase: '/review' }).mode).toBe('skip');
  expect(route('issue_comment', { ...comment, comment: { ...comment.comment, body: '/review' } }, { triggerPhrase: '/review' }).mode).toBe('task');
});

test('anything else exits quietly', () => {
  expect(quiet(route('push', push))).toBe(true);
});

test('mode review forces a review of the event PR, and needs one', () => {
  expect(route('issue_comment', comment, { mode: 'review' })).toEqual({ mode: 'review', number: 12 });
  expect(route('workflow_dispatch', push, { mode: 'review' })).toMatchObject({ mode: 'skip', notice: true });
});

test('write access: admin and write pass, the rest do not', async () => {
  const octokit = (permission: string) =>
    ({ rest: { repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission } }) } } }) as unknown as Octokit;
  for (const [permission, ok] of [['admin', true], ['write', true], ['read', false], ['none', false]] as const) {
    expect(await hasWriteAccess(octokit(permission), 'acme', 'widgets', 'maintainer')).toBe(ok);
  }
});
