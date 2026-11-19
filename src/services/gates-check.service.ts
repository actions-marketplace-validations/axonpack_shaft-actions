import * as core from '@actions/core';
import type { Octokit } from '../types/octokit.type';
import { type Gate, gatesTable } from '../utils/render.util';

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

/**
 * Posts the gates check on the reviewed commit. A token without Checks write (the app's installation
 * hasn't approved it yet) only warns: the review is already posted.
 */
export async function postGatesCheck(octokit: Octokit, owner: string, repo: string, sha: string, gates: Gate[], clean: (s: string) => string): Promise<void> {
  const conclusion = gatesConclusion(gates);
  const failed = gates.filter((g) => g.status === 'not_met').length;
  const title = failed ? `${failed} of ${gates.length} gates not met` : 'Every gate met or not applicable';
  await octokit.rest.checks
    .create({ owner, repo, name: GATES_CHECK, head_sha: sha, status: 'completed', conclusion, output: { title, summary: clean(gatesTable(gates)) } })
    .catch((e: Error) =>
      core.warning(
        `Couldn't post the ${GATES_CHECK} check: ${e.message}. The AxonShaft GitHub App needs the Checks (write) permission, approved on the repo's installation.`,
      ),
    );
}
