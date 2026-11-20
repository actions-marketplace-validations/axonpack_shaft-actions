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

/**
 * Why a commit of `paths` may not be pushed, or undefined when it may: a path that leaves the
 * checkout or goes into `.git/`, or anything under `.github/`, whose workflows run with the repo's
 * secrets.
 */
export function commitDenial(paths: string[]): string | undefined {
  const bad = paths.find((p) => p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '.git'));
  if (bad) return `The change names ${bad}, outside the files a commit can hold, so nothing was pushed.`;
  const github = paths.filter((p) => p.startsWith('.github/'));
  if (github.length) return `The change touches ${github.join(', ')}, and Axon Shaft never commits anything under .github/, so nothing was pushed.`;
}

/** Files that decide what runs in CI and on install: package scripts, Makefiles and lock files. */
const RUNS_CODE = /(^|\/)(package\.json|Makefile|GNUmakefile|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|npm-shrinkwrap\.json)$/;

/** The `paths` a reviewer should read before merging, because they change what runs. */
export const runsCode = (paths: string[]): string[] => paths.filter((p) => RUNS_CODE.test(p));
