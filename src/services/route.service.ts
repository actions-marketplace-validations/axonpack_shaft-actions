import { APP_MENTION } from '../consts/api.const';
import type { Octokit } from '../types/octokit.type';

/** The pull request event, as the Code review job's `on` choices name it. */
export type ReviewEvent = 'opened' | 'push' | 'ready';

export type Route =
  /** `actor` is set when `mode: review` forced the review: that person needs write access. */
  | { mode: 'review'; number: number; event?: ReviewEvent; actor?: string }
  | { mode: 'task'; number: number; actor: string }
  | { mode: 'skip'; reason: string; notice?: boolean };

/** The pull_request actions that start a review, and the event each one is for the Axon Shaft API. */
const REVIEW_EVENTS: Record<string, ReviewEvent> = { opened: 'opened', reopened: 'opened', synchronize: 'push', ready_for_review: 'ready' };

// The payload is the raw webhook event (github.context.payload).
export function route(
  eventName: string,
  payload: any,
  opts: { mode?: string } = {},
): Route {
  const { mode = 'auto' } = opts;
  const pr = payload.pull_request;
  const number: number | undefined = pr?.number ?? payload.issue?.number;
  const event = eventName === 'pull_request' ? REVIEW_EVENTS[payload.action] : undefined;
  const fork = pr && pr.head.repo?.full_name !== pr.base.repo.full_name;
  const forkSkip = (n: number): Route => ({ mode: 'skip', reason: `PR #${n} is from a fork, which gets no secrets, so it was skipped.`, notice: true });

  if (mode === 'review') {
    if (!pr && !payload.issue?.pull_request) return { mode: 'skip', reason: 'mode is review, but this event has no pull request.', notice: true };
    if (fork) return forkSkip(pr.number);
    return { mode: 'review', number: number!, event, actor: payload.sender?.login };
  }
  if (mode === 'task') {
    if (!number) return { mode: 'skip', reason: 'mode is task, but this event has no pull request or issue.', notice: true };
    return { mode: 'task', number, actor: payload.sender?.login };
  }

  if (eventName === 'pull_request') {
    if (!event) return { mode: 'skip', reason: `pull_request ${payload.action} is not reviewed.` };
    if (fork) return forkSkip(pr.number);
    return { mode: 'review', number: pr.number, event };
  }

  const text =
    eventName === 'issue_comment' || eventName === 'pull_request_review_comment'
      ? payload.action === 'created' && payload.comment?.body
      : eventName === 'pull_request_review'
        ? payload.action === 'submitted' && payload.review?.body
        : undefined;
  if (typeof text !== 'string' || !text.includes(APP_MENTION)) return { mode: 'skip', reason: `${eventName} has nothing for Axon Shaft.` };
  if (payload.sender?.type === 'Bot') return { mode: 'skip', reason: 'Comments from bots never start a task.' };
  return { mode: 'task', number: number!, actor: payload.sender.login };
}

/**
 * Why a review that `mode: review` forced may not run, or undefined when it may: the person who
 * started it needs write access, and the PR can't come from a fork. A comment's payload doesn't say
 * where the PR's branch lives, so this asks GitHub.
 */
export async function forcedReviewDenial(octokit: Octokit, owner: string, repo: string, number: number, actor: string): Promise<string | undefined> {
  if (!(await hasWriteAccess(octokit, owner, repo, actor))) return `${actor} has no write access, so no review was started.`;
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo, pull_number: number });
  if (pr.head.repo?.full_name !== pr.base.repo.full_name) return `PR #${number} is from a fork, so no review was started.`;
}

/** Only people with write access may start a task. */
export async function hasWriteAccess(octokit: Octokit, owner: string, repo: string, username: string): Promise<boolean> {
  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username });
  return data.permission === 'admin' || data.permission === 'write';
}
