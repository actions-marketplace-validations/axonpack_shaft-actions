import * as core from '@actions/core';
import type { ChangedFile } from '../utils/auto-pick.util';
import type { Octokit } from '../types/octokit.type';
import { GUIDE_FILES } from '../consts/settings.const';
import { SUMMARY_MARKER } from '../utils/render.util';
import { hasWriteAccess } from './route.service';

export type Comment = {
  id: number;
  author: string;
  /** Whether the author is inside the repo (`insider`), so the review reads the comment. */
  trusted: boolean;
  body: string;
  html_url: string;
  path?: string;
  line?: number | null;
  /** A review comment's first line, when it spans several, and the commit its lines are on. */
  start_line?: number | null;
  commit_id?: string;
};

export type Context = {
  owner: string;
  repo: string;
  /** `fork`: the head branch lives in another repo, or one that was deleted. `defaultBranch` is the base repo's. */
  pr: { number: number; title: string; body: string; author: string; headSha: string; base: string; head: string; fork: boolean; defaultBranch: string };
  commits: string[];
  files: (ChangedFile & { status: string })[];
  /** Issue comments, without our own summary. */
  comments: Comment[];
  reviewComments: Comment[];
  /** Our sticky summary comment, if an earlier run made one. */
  summary?: Comment;
  /** The repo's guides (`GUIDE_FILES`) the base branch has, in that order. */
  guides: { path: string; text: string }[];
};

const toComment = (c: any, trusted: boolean): Comment => ({
  id: c.id,
  author: c.user?.login ?? 'ghost',
  trusted,
  body: c.body ?? '',
  html_url: c.html_url,
  path: c.path,
  line: c.line,
  start_line: c.start_line,
  commit_id: c.commit_id,
});

/** Associations that put an author inside the repo without asking GitHub. */
const INSIDE = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/**
 * Whether a comment's author is inside the repo. `author_association` misses write access through an
 * org team and shows a private org member as CONTRIBUTOR or NONE, so anyone it leaves out is asked
 * about on the permission endpoint, once per login: admin or write counts. A failed call counts as
 * outside, with a warning. Bots are never asked.
 */
function insider(octokit: Octokit, owner: string, repo: string): (c: any) => Promise<boolean> {
  const asked = new Map<string, Promise<boolean>>();
  return async (c) => {
    if (INSIDE.includes(c.author_association)) return true;
    const login: string | undefined = c.user?.login;
    if (!login || c.user.type === 'Bot') return false;
    if (!asked.has(login))
      asked.set(
        login,
        hasWriteAccess(octokit, owner, repo, login).catch((e: Error) => {
          core.warning(`Couldn't check ${login}'s access to the repo, so their comments are left out of the review: ${e.message}`);
          return false;
        }),
      );
    return asked.get(login)!;
  };
}

/**
 * A file as the base branch has it, through the API; undefined when it has none. Never the
 * checkout's copy: on `pull_request` the checkout is the merge commit, so a PR could edit the
 * repo's guides to change its own review.
 */
export async function baseFile(octokit: Octokit, owner: string, repo: string, ref: string, path: string): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref, mediaType: { format: 'raw' } });
    return data as unknown as string;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return undefined;
    throw e;
  }
}

/** Everything the review needs from GitHub: the PR text, the diff, the comments already posted and the base branch's guides. */
export async function collectContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number,
  /** Our own login: the summary is the comment it wrote, never one someone else made to look like it. */
  bot: string,
): Promise<Context> {
  const q = { owner, repo, pull_number: number, per_page: 100 };
  const [{ data: pr }, files, commits, issueComments, reviewComments] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: number }),
    octokit.paginate(octokit.rest.pulls.listFiles, q),
    octokit.paginate(octokit.rest.pulls.listCommits, q),
    octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 }),
    octokit.paginate(octokit.rest.pulls.listReviewComments, q),
  ]);
  const trusted = insider(octokit, owner, repo);
  const comment = async (c: any) => toComment(c, await trusted(c));
  const comments = await Promise.all(issueComments.map(comment));
  const summary = comments.find((c) => c.author === bot && c.body.startsWith(SUMMARY_MARKER));
  return {
    owner,
    repo,
    pr: {
      number,
      title: pr.title,
      body: pr.body ?? '',
      author: pr.user.login,
      headSha: pr.head.sha,
      base: pr.base.ref,
      head: pr.head.ref,
      fork: pr.head.repo?.full_name !== pr.base.repo.full_name,
      defaultBranch: pr.base.repo.default_branch,
    },
    commits: commits.map((c) => c.commit.message),
    files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })),
    comments: comments.filter((c) => c !== summary),
    reviewComments: await Promise.all(reviewComments.map(comment)),
    summary,
    guides: (await Promise.all(GUIDE_FILES.map(async (path) => ({ path, text: await baseFile(octokit, owner, repo, pr.base.ref, path) })))).filter(
      (g): g is { path: string; text: string } => typeof g.text === 'string' && !!g.text.trim(),
    ),
  };
}
