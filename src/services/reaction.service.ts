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

/**
 * The 👀 on the comment that started the run, or on the pull request itself (`pr`) for a review no
 * comment started. `id` is GitHub's id for it, unset on a dry run.
 */
export type Reaction = { octokit: Octokit; owner: string; repo: string; comment?: Comment; pr?: number; dryRun: boolean; id?: number };

const where = (r: Reaction) => (r.comment ? 'the comment that started the run' : 'the pull request');

const warn = (r: Reaction, what: string) => (e: Error) => {
  core.warning(`Couldn't ${what} on ${where(r)}: ${e.message}`);
  return undefined;
};

async function add(r: Reaction, content: 'eyes' | 'rocket' | 'confused'): Promise<number> {
  const base = { owner: r.owner, repo: r.repo, content };
  const { data } = await (!r.comment
    ? r.octokit.rest.reactions.createForIssue({ ...base, issue_number: r.pr! })
    : r.comment.review
      ? r.octokit.rest.reactions.createForPullRequestReviewComment({ ...base, comment_id: r.comment.id })
      : r.octokit.rest.reactions.createForIssueComment({ ...base, comment_id: r.comment.id }));
  return data.id;
}

/**
 * Puts 👀 on the comment that started the run, or on pull request `pr` when no comment did. None when
 * there's neither, or when GitHub refused it, which only warns.
 */
export async function reactStart(octokit: Octokit, event: Event, dryRun: boolean, pr?: number): Promise<Reaction | undefined> {
  const comment = triggerComment(event.eventName, event.payload);
  if (!comment && pr === undefined) return undefined;
  const r: Reaction = { octokit, owner: event.repo.owner, repo: event.repo.repo, comment, pr: comment ? undefined : pr, dryRun };
  if (dryRun) {
    core.info(`Would react 👀 to ${where(r)}`);
    return r;
  }
  const id = await add(r, 'eyes').catch(warn(r, 'add 👀'));
  return id === undefined ? undefined : { ...r, id };
}

/** Swaps the 👀 for 🚀 when the run did its job, or 😕 when it failed or did nothing. If removing 👀 fails, it stays. */
export async function reactEnd(r: Reaction, done: boolean): Promise<void> {
  const [content, emoji] = done ? (['rocket', '🚀'] as const) : (['confused', '😕'] as const);
  if (r.dryRun) return core.info(`Would swap 👀 for ${emoji} on ${where(r)}`);
  const ids = { owner: r.owner, repo: r.repo, reaction_id: r.id! };
  await (!r.comment
    ? r.octokit.rest.reactions.deleteForIssue({ ...ids, issue_number: r.pr! })
    : r.comment.review
      ? r.octokit.rest.reactions.deleteForPullRequestComment({ ...ids, comment_id: r.comment.id })
      : r.octokit.rest.reactions.deleteForIssueComment({ ...ids, comment_id: r.comment.id })
  ).catch(warn(r, 'remove 👀'));
  await add(r, content).catch(warn(r, `add ${emoji}`));
}
