import * as core from '@actions/core';
import type { Octokit } from '../types/octokit.type';

/** What the reactions need from `github.context`. */
type Event = { eventName: string; payload: any; repo: { owner: string; repo: string } };

type Comment = { id: number; review: boolean };

/** The comment that started the run, from the webhook payload: `review` when it's on a line. None for a pull request event or a review's body. */
export function triggerComment(eventName: string, payload: any): Comment | undefined {
  const id = payload.comment?.id;
  if (typeof id !== 'number' || (eventName !== 'issue_comment' && eventName !== 'pull_request_review_comment')) return undefined;
  return { id, review: eventName === 'pull_request_review_comment' };
}

/** The 👀 on the comment that started the run. `id` is GitHub's id for it, unset on a dry run. */
export type Reaction = { octokit: Octokit; owner: string; repo: string; comment: Comment; dryRun: boolean; id?: number };

const warn = (what: string) => (e: Error) => {
  core.warning(`Couldn't ${what} on the comment that started the run: ${e.message}`);
  return undefined;
};

async function add(r: Reaction, content: 'eyes' | 'rocket' | 'confused'): Promise<number> {
  const req = { owner: r.owner, repo: r.repo, comment_id: r.comment.id, content };
  const { data } = await (r.comment.review ? r.octokit.rest.reactions.createForPullRequestReviewComment(req) : r.octokit.rest.reactions.createForIssueComment(req));
  return data.id;
}

/** Puts 👀 on the comment that started the run. None when no comment started it, or when GitHub refused it, which only warns. */
export async function reactStart(octokit: Octokit, event: Event, dryRun: boolean): Promise<Reaction | undefined> {
  const comment = triggerComment(event.eventName, event.payload);
  if (!comment) return undefined;
  const r: Reaction = { octokit, owner: event.repo.owner, repo: event.repo.repo, comment, dryRun };
  if (dryRun) {
    core.info('Would react 👀 to the comment that started the run');
    return r;
  }
  const id = await add(r, 'eyes').catch(warn('add 👀'));
  return id === undefined ? undefined : { ...r, id };
}

/** Swaps the 👀 for 🚀 when the run did its job, or 😕 when it failed or did nothing. If removing 👀 fails, it stays. */
export async function reactEnd(r: Reaction, done: boolean): Promise<void> {
  const [content, emoji] = done ? (['rocket', '🚀'] as const) : (['confused', '😕'] as const);
  if (r.dryRun) return core.info(`Would swap 👀 for ${emoji} on the comment that started the run`);
  const req = { owner: r.owner, repo: r.repo, comment_id: r.comment.id, reaction_id: r.id! };
  await (r.comment.review ? r.octokit.rest.reactions.deleteForPullRequestComment(req) : r.octokit.rest.reactions.deleteForIssueComment(req)).catch(warn('remove 👀'));
  await add(r, content).catch(warn(`add ${emoji}`));
}
