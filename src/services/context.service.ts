import type { ChangedFile } from '../utils/auto-pick.util';
import type { Octokit } from '../types/octokit.type';
import { SUMMARY_MARKER } from '../utils/render.util';

export type Comment = {
  id: number;
  author: string;
  /** GitHub's `author_association`: OWNER, MEMBER, COLLABORATOR, CONTRIBUTOR, NONE and so on. */
  association: string;
  body: string;
  html_url: string;
  path?: string;
  line?: number | null;
};

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
  /** The review rules file's text on the base branch; undefined when it has none. */
  config?: string;
};

const comment = (c: any): Comment => ({
  id: c.id,
  author: c.user?.login ?? 'ghost',
  association: c.author_association ?? 'NONE',
  body: c.body ?? '',
  html_url: c.html_url,
  path: c.path,
  line: c.line,
});

/**
 * The review rules file as the base branch has it, through the API. Never the checkout's copy: on
 * `pull_request` the checkout is the merge commit, so a PR could edit the file to switch its own
 * rules off.
 */
async function baseConfig(octokit: Octokit, owner: string, repo: string, ref: string, path: string): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref, mediaType: { format: 'raw' } });
    return data as unknown as string;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return undefined;
    throw e;
  }
}

/** Everything the review needs from GitHub: the PR text, the diff, the comments already posted and the base branch's review rules. */
export async function collectContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  number: number,
  configPath: string,
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
  const comments = issueComments.map(comment);
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
    },
    commits: commits.map((c) => c.commit.message),
    files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch })),
    comments: comments.filter((c) => c !== summary),
    reviewComments: reviewComments.map(comment),
    summary,
    config: await baseConfig(octokit, owner, repo, pr.base.ref, configPath),
  };
}
