import type { Octokit } from '../types/octokit.type';

/** The pull request event, as the Code review job's `on` choices name it. */
export type ReviewEvent = 'opened' | 'push' | 'ready';

export type Route =
  /**
   * `event` is set on a pull request event; a review someone asked for with `/review` has
   * none, and its `actor` needs write access. `fork` is undefined when the payload doesn't say.
   */
  | { mode: 'review'; number: number; event?: ReviewEvent; fork?: boolean; actor?: string }
  | { mode: 'task'; number: number; actor: string; ask: Ask }
  /** `/ask`: answer, never change code. */
  | { mode: 'reply'; number: number; actor: string; ask: Ask }
  /** `/help`: post the list of commands. */
  | { mode: 'help'; number: number; actor: string }
  | { mode: 'skip'; reason: string; notice?: boolean };

/**
 * The comment a `/ask` or `/fix` came in, which the answer goes under: its ID and text (a review's
 * body for `pull_request_review`). On a line of the diff, also its file and line, and `thread`, the
 * ID of the thread's first comment, which GitHub takes a reply to.
 */
export type Ask = { id: number; text: string; path?: string; line?: number; thread?: number };

/** The pull_request actions that start a review, and the event each one is for the Axon Shaft API. */
const REVIEW_EVENTS: Record<string, ReviewEvent> = { opened: 'opened', reopened: 'opened', synchronize: 'push', ready_for_review: 'ready' };

/** A comment with this in it starts a review of its pull request. */
export const REVIEW_COMMAND = '/review';

/** `prompt` is `/axonshaft <prompt>`: anything, answered or done. */
export type Command = 'review' | 'fix' | 'ask' | 'help' | 'prompt';

/**
 * The slash command a comment gives: `/review`, `/fix`, `/ask`, `/help` or `/axonshaft` at the start of a line.
 * Lines in a quote or a code block don't count, so quoting someone's command doesn't run it again.
 */
export function commandIn(text: string): Command | undefined {
  const lines = text.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '').split('\n');
  for (const line of lines) {
    const m = /^\s*\/(review|fix|ask|help|axonshaft)(?![\w-])/.exec(line);
    if (m && !line.trimStart().startsWith('>')) return m[1] === 'axonshaft' ? 'prompt' : (m[1] as Command);
  }
  return undefined;
}

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
  const command = typeof text === 'string' ? commandIn(text) : undefined;
  if (typeof text !== 'string' || !command) return { mode: 'skip', reason: `${eventName} has nothing for Axon Shaft.` };
  if (payload.sender?.type === 'Bot') return { mode: 'skip', reason: 'Comments from bots are ignored.' };
  const actor: string = payload.sender.login;
  const onPr = Boolean(pr || payload.issue?.pull_request);
  // An issue_comment's payload doesn't say where the PR's branch lives, so `fork` stays undefined there.
  if (command === 'review' && onPr) return { mode: 'review', number: number!, fork: pr ? isFork(pr) : undefined, actor };
  if (command === 'review') return { mode: 'skip', reason: '/review works on a pull request, not an issue.', notice: true };
  if (command === 'help') return { mode: 'help', number: number!, actor };
  const c = eventName === 'pull_request_review' ? payload.review : payload.comment;
  const ask: Ask =
    eventName === 'pull_request_review_comment'
      ? { id: c.id, text, path: c.path, line: c.line ?? c.original_line ?? undefined, thread: c.in_reply_to_id ?? c.id }
      : { id: c.id, text };
  if (command === 'ask' && !onPr) return { mode: 'skip', reason: '/ask works on a pull request, not an issue.', notice: true };
  if (command === 'ask') return { mode: 'reply', number: number!, actor, ask };
  return { mode: 'task', number: number!, actor, ask };
}

/**
 * The pull request the run is for, as `POST /v1/token` takes it. `base` (the branch it goes into),
 * `association` (GitHub's `author_association`) and `bot` are for the review job's filters.
 */
export type PullRequest = { number: number; title: string; branch?: string; author: string; base?: string; association?: string; bot?: boolean };

/**
 * The pull request from the payload, when it has one. An issue_comment on a pull request has it as
 * the issue, with no branch; a review from a comment isn't filtered, so it needs none of the filters' facts.
 */
export function pullRequestOf(payload: any): PullRequest | undefined {
  const pr = payload.pull_request;
  if (pr)
    return {
      number: pr.number,
      title: pr.title,
      branch: pr.head.ref,
      author: pr.user.login,
      base: pr.base.ref,
      association: pr.author_association,
      bot: pr.user.type === 'Bot',
    };
  const issue = payload.issue;
  if (issue?.pull_request) return { number: issue.number, title: issue.title, author: issue.user.login };
  return undefined;
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
