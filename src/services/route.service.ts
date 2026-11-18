import { APP_MENTION } from '../consts/api.const';
import type { Octokit } from '../types/octokit.type';

/** The pull request event, as the Code review job's `on` choices name it. */
export type ReviewEvent = 'opened' | 'push' | 'ready';

export type Route =
  /**
   * `event` is set on a pull request event; a review someone asked for with `@axonshaft review` has
   * none, and its `actor` needs write access. `fork` is undefined when the payload doesn't say.
   */
  | { mode: 'review'; number: number; event?: ReviewEvent; fork?: boolean; actor?: string }
  | { mode: 'task'; number: number; actor: string }
  | { mode: 'skip'; reason: string; notice?: boolean };

/** The pull_request actions that start a review, and the event each one is for the Axon Shaft API. */
const REVIEW_EVENTS: Record<string, ReviewEvent> = { opened: 'opened', reopened: 'opened', synchronize: 'push', ready_for_review: 'ready' };

/** A comment with this in it starts a review of its pull request. */
export const REVIEW_COMMAND = `${APP_MENTION} review`;

/** The PR's branch lives in another repo, or in one that was deleted. */
const isFork = (pr: any): boolean => pr.head.repo?.full_name !== pr.base.repo.full_name;

// The payload is the raw webhook event (github.context.payload).
export function route(eventName: string, payload: any): Route {
  const pr = payload.pull_request;
  const number: number | undefined = pr?.number ?? payload.issue?.number;

  // pull_request_target has the same payload; it runs on the base branch, so a fork's PR gets an OIDC token too.
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const event = REVIEW_EVENTS[payload.action];
    if (!event) return { mode: 'skip', reason: `${eventName} ${payload.action} is not reviewed.` };
    if (eventName === 'pull_request' && isFork(pr)) {
      return { mode: 'skip', reason: `PR #${pr.number} is from a fork, and a fork's pull_request run gets no OIDC token. To review it, run the workflow on pull_request_target.`, notice: true };
    }
    return { mode: 'review', number: pr.number, event, fork: isFork(pr) };
  }

  const text =
    eventName === 'issue_comment' || eventName === 'pull_request_review_comment'
      ? payload.action === 'created' && payload.comment?.body
      : eventName === 'pull_request_review'
        ? payload.action === 'submitted' && payload.review?.body
        : undefined;
  if (typeof text !== 'string' || !text.includes(APP_MENTION)) return { mode: 'skip', reason: `${eventName} has nothing for Axon Shaft.` };
  if (payload.sender?.type === 'Bot') return { mode: 'skip', reason: 'Comments from bots are ignored.' };
  // An issue_comment's payload doesn't say where the PR's branch lives, so `fork` stays undefined there.
  if (text.includes(REVIEW_COMMAND) && (pr || payload.issue?.pull_request)) {
    return { mode: 'review', number: number!, fork: pr ? isFork(pr) : undefined, actor: payload.sender.login };
  }
  return { mode: 'task', number: number!, actor: payload.sender.login };
}

/** Only people with write access may start a review or a task from a comment. */
export async function hasWriteAccess(octokit: Octokit, owner: string, repo: string, username: string): Promise<boolean> {
  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username });
  return data.permission === 'admin' || data.permission === 'write';
}

/**
 * Post `body` on the PR unless `bot` already posted a comment with the same marker (the HTML
 * comment `body` ends with), so a push doesn't repeat it. Anyone else's copy of the marker doesn't count.
 */
export async function commentOnce(octokit: Octokit, owner: string, repo: string, number: number, body: string, bot: string): Promise<void> {
  const marker = body.slice(Math.max(0, body.lastIndexOf('<!--'))).trim();
  const comments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 });
  if (comments.some((c) => c.user?.login === bot && c.body?.includes(marker))) return;
  await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body });
}
