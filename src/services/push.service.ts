import { closeSync, constants, fstatSync, openSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { runnerEnv } from '../utils/env.util';
import { ShaftFailure } from '../utils/failure.util';
import { type Change, commitDenial } from '../utils/push.util';
import { insideCheckout } from '../utils/tool-guard.util';
import { inSandbox } from './sandbox.service';

/** git in the model's checkout, in the sandbox: a hook, filter or file monitor it set up runs there, with no token in reach. */
const git = (cwd: string, args: string[]) =>
  inSandbox(cwd, 'git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { env: runnerEnv(), encoding: 'utf8', stdio: 'pipe' });

/**
 * What the session changed in the checkout, read before the checks run so that what they write
 * isn't pushed. A file's mode comes from the file itself (executable or not), a link is kept as a
 * link and never followed, and a deleted file has no mode. Nothing in the sandbox runs by now
 * (`endSandboxes`). HEAD must still be `base`, the commit the action checked out, and the change
 * must pass `commitDenial`: its paths before any file is read, then its size.
 */
export function readChanges(cwd: string, base: string): Change[] {
  assertHead(cwd, base);
  const paths = git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames'])
    .split('\0')
    .filter(Boolean)
    .map((l) => l.slice(3));
  const why = commitDenial(paths.map((path) => ({ path }))) ?? paths.map((p) => (insideCheckout(dirname(p), cwd) ? undefined : `${p} isn't inside the checkout, so nothing was pushed.`)).find(Boolean);
  if (why) throw new ShaftFailure('push_failed', why);
  const changes = paths.map((path): Change => {
    const file = join(cwd, path);
    let fd;
    try {
      // Never through a link, so one swapped in after `git status` can't lead out of the checkout, and
      // never waiting on a FIFO. What was opened is what's read.
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { path };
      if (code === 'ELOOP') return { path, mode: '120000', content: Buffer.from(readlinkSync(file)) };
      throw new ShaftFailure('push_failed', `${path} couldn't be read (${code}), so nothing was pushed.`);
    }
    try {
      const st = fstatSync(fd);
      if (!st.isFile()) throw new ShaftFailure('push_failed', `${path} isn't a file or a link, so nothing was pushed.`);
      return { path, mode: st.mode & 0o100 ? '100755' : '100644', content: readFileSync(fd) };
    } finally {
      closeSync(fd);
    }
  });
  const big = commitDenial(changes);
  if (big) throw new ShaftFailure('push_failed', big);
  return changes;
}

/** The checkout's HEAD commit. */
export const head = (cwd: string): string => git(cwd, ['rev-parse', 'HEAD']).trim();

/** The session and the checks are the repo's code: neither may move HEAD off the commit the action checked out. */
export function assertHead(cwd: string, base: string): void {
  if (head(cwd) !== base) throw new ShaftFailure('push_failed', 'Something in the run moved HEAD off the pull request\'s head commit, so nothing was pushed.');
}

/** Back to `base`, with nothing in the checkout that git doesn't ignore, for the next attempt. */
export function resetTo(cwd: string, base: string): void {
  git(cwd, ['reset', '-q', '--hard', base]);
  git(cwd, ['clean', '-q', '-f', '-d']);
}

/** A commit to push: `changes` on top of `base`, by `author`, to `branch` of `owner/repo`. */
export type PushRequest = { owner: string; repo: string; branch: string; base: string; changes: Change[]; message: string; author: { name: string; email: string } };

/**
 * Commit `changes` on top of `base` and move `branch` to it, through GitHub's Git Data API with
 * `token`: a blob for each file, a tree on `base`'s, the commit, then the ref, never forced, so a
 * branch that moved during the run is refused. No git process sees the token, and it's revoked at
 * the end whatever happened. The commit's sha.
 */
export async function pushChanges(token: string, p: PushRequest): Promise<string> {
  const octokit = getOctokit(token);
  const { owner, repo } = p;
  try {
    const { data: base } = await octokit.rest.git.getCommit({ owner, repo, commit_sha: p.base });
    const tree = [];
    for (const c of p.changes) {
      const sha = c.content ? (await octokit.rest.git.createBlob({ owner, repo, content: c.content.toString('base64'), encoding: 'base64' })).data.sha : null;
      tree.push({ path: c.path, mode: c.mode ?? '100644', type: 'blob' as const, sha });
    }
    const { data: made } = await octokit.rest.git.createTree({ owner, repo, base_tree: base.tree.sha, tree });
    const { data: commit } = await octokit.rest.git.createCommit({ owner, repo, message: p.message, tree: made.sha, parents: [p.base], author: p.author });
    await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${p.branch}`, sha: commit.sha, force: false });
    return commit.sha;
  } catch (e) {
    throw new ShaftFailure('push_failed', `The push to ${p.branch} failed: ${(e as Error).message}`);
  } finally {
    await octokit.rest.apps.revokeInstallationAccessToken().catch((e: Error) => core.warning(`Couldn't revoke the push token: ${e.message}`));
  }
}
