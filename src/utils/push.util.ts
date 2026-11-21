/** Where the project lets Axon Shaft push: nowhere, only the pull request's own branch, or any branch. */
export type PushMode = 'disabled' | 'restricted' | 'enabled';

/** A push the action is about to make: the branch, and the run's pull request and repo. */
export type PushTarget = {
  branch: string;
  defaultBranch: string;
  /** The pull request's head branch, when the run is on one. */
  pullBranch?: string;
  /** The pull request comes from a fork, whose branch isn't in this repo. */
  fork?: boolean;
};

/**
 * Why the action may not push to `target.branch` under `mode`, or undefined when it may. The default
 * branch is refused in every mode, and an unknown mode counts as `disabled`. Force pushes aren't a
 * choice: the action never makes one.
 */
export function pushDenial(mode: string, t: PushTarget): string | undefined {
  if (mode !== 'restricted' && mode !== 'enabled') return 'Pushing is turned off for this project. An admin can change Push mode in its settings on the dashboard.';
  if (t.branch === t.defaultBranch) return `Axon Shaft never pushes to the default branch, ${t.defaultBranch}.`;
  if (mode === 'enabled') return;
  if (!t.pullBranch || t.fork) return "Push mode is Restricted, so Axon Shaft pushes only to a pull request's own branch in this repo.";
  if (t.branch !== t.pullBranch) return `Push mode is Restricted, so Axon Shaft pushes only to the pull request's branch, ${t.pullBranch}, not ${t.branch}.`;
}

/** A file a change adds, edits or deletes: its git mode and bytes, neither when it's deleted. */
export type Change = { path: string; mode?: '100644' | '100755' | '120000'; content?: Buffer };

/** The most one commit may hold: files, and bytes in one file and in all of them. */
export const COMMIT_MAX = { files: 200, fileBytes: 1024 * 1024, totalBytes: 10 * 1024 * 1024 };

const mb = (bytes: number) => `${bytes / 1024 / 1024} MB`;

/**
 * Why a commit of `changes` may not be pushed, or undefined when it may: a path that leaves the
 * checkout or goes into `.git/`, or `.github/` or anything under it, whose workflows run with the
 * repo's secrets, in any case (a case-insensitive file system makes `.GitHub/` the same folder); or
 * more than `COMMIT_MAX`. A change without `content` counts no bytes, so the paths can be checked
 * before any file is read.
 */
export function commitDenial(changes: Pick<Change, 'path' | 'content'>[]): string | undefined {
  const paths = changes.map((c) => c.path);
  const bad = paths.find((p) => p.startsWith('/') || p.split('/').some((s) => s === '..' || s.toLowerCase() === '.git'));
  if (bad) return `The change names ${bad}, outside the files a commit can hold, so nothing was pushed.`;
  const github = paths.filter((p) => /^\.github(\/|$)/i.test(p));
  if (github.length) return `The change touches ${github.join(', ')}, and Axon Shaft never commits anything under .github/, so nothing was pushed.`;
  if (changes.length > COMMIT_MAX.files)
    return `The change has ${changes.length} files, more than the ${COMMIT_MAX.files} one commit from Axon Shaft may hold, so nothing was pushed.`;
  const big = changes.find((c) => (c.content?.length ?? 0) > COMMIT_MAX.fileBytes);
  if (big) return `${big.path} is over ${mb(COMMIT_MAX.fileBytes)}, the most one file in a commit may be, so nothing was pushed.`;
  const total = changes.reduce((n, c) => n + (c.content?.length ?? 0), 0);
  if (total > COMMIT_MAX.totalBytes) return `The change adds up to over ${mb(COMMIT_MAX.totalBytes)}, the most one commit may hold, so nothing was pushed.`;
}

/** Files that decide what runs in CI and on install: package scripts, Makefiles and lock files. */
const RUNS_CODE = /(^|\/)(package\.json|Makefile|GNUmakefile|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|npm-shrinkwrap\.json)$/;

/** The `paths` a reviewer should read before merging, because they change what runs. */
export const runsCode = (paths: string[]): string[] => paths.filter((p) => RUNS_CODE.test(p));

/** The same files with the same contents: the session changed nothing past the applied suggestions. */
export const sameChanges = (a: Change[], b: Change[]) => a.length === b.length && a.every((c, i) => c.path === b[i]!.path && Buffer.compare(c.content ?? Buffer.alloc(0), b[i]!.content ?? Buffer.alloc(0)) === 0);
