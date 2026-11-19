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
