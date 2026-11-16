import type { getOctokit } from '@actions/github';

export type Octokit = ReturnType<typeof getOctokit>;

export type Route =
  | { mode: 'review'; number: number }
  | { mode: 'task'; number: number; actor: string }
  | { mode: 'skip'; reason: string; notice?: boolean };

const REVIEW_ACTIONS = ['opened', 'synchronize', 'reopened', 'ready_for_review'];

// The payload is the raw webhook event (github.context.payload).
export function route(
  eventName: string,
  payload: any,
  opts: { mode?: string; triggerPhrase?: string } = {},
): Route {
  const { mode = 'auto', triggerPhrase = '@axonbot' } = opts;
  const pr = payload.pull_request;
  const number: number | undefined = pr?.number ?? payload.issue?.number;

  if (mode === 'review') {
    if (!pr && !payload.issue?.pull_request) return { mode: 'skip', reason: 'mode is review, but this event has no pull request.', notice: true };
    return { mode: 'review', number: number! };
  }
  if (mode === 'task') {
    if (!number) return { mode: 'skip', reason: 'mode is task, but this event has no pull request or issue.', notice: true };
    return { mode: 'task', number, actor: payload.sender?.login };
  }

  if (eventName === 'pull_request') {
    if (!REVIEW_ACTIONS.includes(payload.action)) return { mode: 'skip', reason: `pull_request ${payload.action} is not reviewed.` };
    if (pr.head.repo?.full_name !== pr.base.repo.full_name) {
      return {
        mode: 'skip',
        reason: `PR #${pr.number} is from a fork, which gets no secrets, so it was skipped. A maintainer can comment "${triggerPhrase} review" instead.`,
        notice: true,
      };
    }
    return { mode: 'review', number: pr.number };
  }

  const text =
    eventName === 'issue_comment' || eventName === 'pull_request_review_comment'
      ? payload.action === 'created' && payload.comment?.body
      : eventName === 'pull_request_review'
        ? payload.action === 'submitted' && payload.review?.body
        : undefined;
  if (typeof text !== 'string' || !text.includes(triggerPhrase)) return { mode: 'skip', reason: `${eventName} has nothing for axonbot.` };
  if (payload.sender?.type === 'Bot') return { mode: 'skip', reason: 'Comments from bots never start a task.' };
  return { mode: 'task', number: number!, actor: payload.sender.login };
}

/** Only people with write access may start a task. */
export async function hasWriteAccess(octokit: Octokit, owner: string, repo: string, username: string): Promise<boolean> {
  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username });
  return data.permission === 'admin' || data.permission === 'write';
}
