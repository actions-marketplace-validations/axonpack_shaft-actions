import * as core from '@actions/core';
import type { Octokit } from '../types/octokit.type';
import { type CheckState, findingsTable, type Gate, gatesTable, type Placed } from '../utils/render.util';

/** The check run branch protection can require. */
export const GATES_CHECK = 'Axon Shaft / gates';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * One result per gate the project keeps, in its order: the review's for that gate (by its text, else
 * by position), or `not_met` when the review didn't report on it, so a gate is never passed by omission.
 */
export function gateResults(gates: string[], reported: Gate[] = []): Gate[] {
  return gates.map((gate, i) => {
    const r = reported.find((g) => norm(g.gate) === norm(gate)) ?? reported[i];
    return r ? { ...r, gate } : { gate, status: 'not_met', reason: "The review didn't report on this gate." };
  });
}

/** Failure when a gate isn't met; a gate that doesn't apply passes. */
export const gatesConclusion = (gates: Gate[]) => (gates.some((g) => g.status === 'not_met') ? 'failure' : 'success');

type Conclusion = 'success' | 'failure' | 'neutral' | 'skipped';

/** The check run that shows a review in progress, then its result. */
export const REVIEW_CHECK = 'Axon Shaft / review';

/** The review's steps in the order they run, named as in the job log. */
export const REVIEW_STEPS = ['Read the pull request', 'Review', 'Post the review'] as const;
export type ReviewStep = (typeof REVIEW_STEPS)[number];

/** The review check's summary while it runs: ✓ on the steps done, the current one in bold, and when it started. */
export function progressSummary(current: ReviewStep, ms: number): string {
  const at = REVIEW_STEPS.indexOf(current);
  const s = Math.round(ms / 1000);
  const steps = REVIEW_STEPS.map((name, i) => (i < at ? `- ✓ ${name}` : i === at ? `- ▶ **${name}**` : `- ${name}`));
  return `${steps.join('\n')}\n\nThis step started ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s into the review.`;
}

/**
 * Posts a check run on the reviewed commit: in progress without a conclusion, completed with one,
 * and an update of run `id` when given. Returns the run's id, or undefined when GitHub refused it.
 * A token without Checks write (the app's installation hasn't approved it yet) only warns: the review is already posted.
 */
export async function postCheck(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  c: { name: string; conclusion?: Conclusion; title: string; summary: string; detailsUrl?: string; id?: number },
  clean: (s: string) => string,
): Promise<number | undefined> {
  const run = {
    owner,
    repo,
    name: c.name,
    ...(c.conclusion ? { status: 'completed' as const, conclusion: c.conclusion } : { status: 'in_progress' as const }),
    ...(c.detailsUrl ? { details_url: c.detailsUrl } : {}),
    output: { title: c.title, summary: clean(c.summary) },
  };
  return (c.id ? octokit.rest.checks.update({ ...run, check_run_id: c.id }) : octokit.rest.checks.create({ ...run, head_sha: sha })).then(
    ({ data }) => data.id,
    (e: Error) => {
      core.warning(
        `Couldn't post the ${c.name} check: ${e.message}. The AxonShaft GitHub App needs the Checks (write) permission, approved on the repo's installation.`,
      );
      return undefined;
    },
  );
}

/** Posts the gates check on the reviewed commit. */
export async function postGatesCheck(octokit: Octokit, owner: string, repo: string, sha: string, gates: Gate[], clean: (s: string) => string): Promise<void> {
  const failed = gates.filter((g) => g.status === 'not_met').length;
  const title = failed ? `${failed} of ${gates.length} gates not met` : 'Every gate met or not applicable';
  await postCheck(octokit, owner, repo, sha, { name: GATES_CHECK, conclusion: gatesConclusion(gates), title, summary: gatesTable(gates) }, clean);
}

/** A review check's run, named after its key. */
export const categoryCheck = (key: string) => `Axon Shaft / ${key}`;

/** A blocking finding fails the check, any other is neutral; a check that's off gets no run. */
export const CATEGORY_CONCLUSION: Record<CheckState, Conclusion | undefined> = {
  failed: 'failure',
  warned: 'neutral',
  passed: 'success',
  not_checked: 'skipped',
  off: undefined,
};

const CATEGORY_TITLE: Record<CheckState, string> = {
  failed: 'Blocking findings',
  warned: 'Findings, none blocking',
  passed: 'Checked, nothing found',
  not_checked: "The review didn't do this check",
  off: '',
};

/**
 * Posts one check run per review check that's on, with that check's findings as its summary. After
 * the first refusal the rest are skipped: the same token would refuse them too.
 */
export async function postCategoryChecks(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  states: { key: string; state: CheckState }[],
  placed: Placed[],
  clean: (s: string) => string,
): Promise<void> {
  for (const { key, state } of states) {
    const conclusion = CATEGORY_CONCLUSION[state];
    if (!conclusion) continue;
    const found = placed.filter((p) => p.step === key);
    const summary = found.length ? findingsTable(found, { repo: `${owner}/${repo}`, sha }) : CATEGORY_TITLE[state];
    if (!(await postCheck(octokit, owner, repo, sha, { name: categoryCheck(key), conclusion, title: CATEGORY_TITLE[state], summary }, clean))) return;
  }
}
