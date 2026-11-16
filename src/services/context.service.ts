import type { ChangedFile } from '../utils/auto-pick.util';
import type { Octokit } from '../types/octokit.type';
import { SUMMARY_MARKER } from '../utils/render.util';

export type Comment = { id: number; author: string; body: string; isBot: boolean; html_url: string; path?: string; line?: number | null };

export type Context = {
  owner: string;
  repo: string;
  pr: { number: number; title: string; body: string; author: string; headSha: string; base: string; head: string };
  commits: string[];
  files: (ChangedFile & { status: string })[];
  /** Issue comments, without our own summary. */
  comments: Comment[];
  reviewComments: Comment[];
  /** Our sticky summary comment, if an earlier run made one. */
  summary?: Comment;
};

const comment = (c: any): Comment => ({
  id: c.id,
  author: c.user?.login ?? 'ghost',
  body: c.body ?? '',
  isBot: c.user?.type === 'Bot',
  html_url: c.html_url,
  path: c.path,
  line: c.line,
});

/** Everything the review needs from GitHub: the PR text, the diff and the comments already posted. */
export async function collectContext(octokit: Octokit, owner: string, repo: string, number: number): Promise<Context> {
  const q = { owner, repo, pull_number: number, per_page: 100 };
  const [{ data: pr }, files, commits, issueComments, reviewComments] = await Promise.all([
    octokit.rest.pulls.get({ owner, repo, pull_number: number }),
    octokit.paginate(octokit.rest.pulls.listFiles, q),
    octokit.paginate(octokit.rest.pulls.listCommits, q),
    octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: number, per_page: 100 }),
    octokit.paginate(octokit.rest.pulls.listReviewComments, q),
  ]);
  const comments = issueComments.map(comment);
  const summary = comments.find((c) => c.isBot && c.body.startsWith(SUMMARY_MARKER));
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
    },
    commits: commits.map((c) => c.commit.message),
    files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })),
    comments: comments.filter((c) => c !== summary),
    reviewComments: reviewComments.map(comment),
    summary,
  };
}
