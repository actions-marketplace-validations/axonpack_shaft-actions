import { beforeEach, expect, test, vi } from 'vitest';

const warnings: string[] = [];
beforeEach(() => {
  warnings.length = 0;
});
vi.doMock('@actions/core', () => ({ info: () => {}, warning: (s: string) => warnings.push(s) }));
const { reactEnd, reactStart, triggerComment } = await import('../reaction.service');

test('triggerComment: only a comment event has a comment to react to', () => {
  expect(triggerComment('issue_comment', { comment: { id: 3 } })).toEqual({ id: 3, review: false });
  expect(triggerComment('pull_request_review_comment', { comment: { id: 4 } })).toEqual({ id: 4, review: true });
  expect(triggerComment('pull_request_review', { review: { id: 5 } })).toBeUndefined();
  expect(triggerComment('pull_request', {})).toBeUndefined();
});

test("a line comment's reactions go through the review comment API; a refused removal keeps the 👀 and only warns", async () => {
  const calls: string[] = [];
  const octokit = {
    rest: {
      reactions: {
        createForPullRequestReviewComment: async ({ comment_id, content }: { comment_id: number; content: string }) => {
          calls.push(`${content} on ${comment_id}`);
          return { data: { id: 8 } };
        },
        deleteForPullRequestComment: async () => {
          throw new Error('Not Found');
        },
      },
    },
  } as any;
  const event = { eventName: 'pull_request_review_comment', payload: { comment: { id: 4 } }, repo: { owner: 'o', repo: 'r' } };
  const r = await reactStart(octokit, event, false);
  expect(r).toMatchObject({ id: 8, comment: { id: 4, review: true } });
  await reactEnd(r!, false);
  expect(calls).toEqual(['eyes on 4', 'confused on 4']);
  expect(warnings).toEqual(["Couldn't remove 👀 on the comment that started the run: Not Found"]);
});
