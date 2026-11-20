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

/**
 * Posts one completed check run on the reviewed commit; false when GitHub refused it. A token without
 * Checks write (the app's installation hasn't approved it yet) only warns: the review is already posted.
 */
async function postCheck(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
  c: { name: string; conclusion: Conclusion; title: string; summary: string },
  clean: (s: string) => string,
): Promise<boolean> {
  return octokit.rest.checks
    .create({ owner, repo, name: c.name, head_sha: sha, status: 'completed', conclusion: c.conclusion, output: { title: c.title, summary: clean(c.summary) } })
    .then(
      () => true,
      (e: Error) => {
        core.warning(
          `Couldn't post the ${c.name} check: ${e.message}. The AxonShaft GitHub App needs the Checks (write) permission, approved on the repo's installation.`,
        );
        return false;
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
