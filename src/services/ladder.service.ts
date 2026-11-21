import * as core from '@actions/core';
import type { Choice } from '../utils/auto-pick.util';
import { ShaftFailure } from '../utils/failure.util';

/**
 * An attempt that ran but didn't work: a task that changed nothing it was asked to change, or whose
 * check failed. `context` is what the next rung is told about it.
 */
export class NotWorked extends ShaftFailure {
  constructor(
    message: string,
    readonly context = message,
  ) {
    super('review_failed', message);
  }
}

/** A rung that didn't work, and why, for the footer. */
export type Tried = { model: string; effort: string; why: string };
type Spent = NonNullable<ShaftFailure['spent']>;

/** Why an attempt moves up a rung, or undefined when it doesn't: a time limit or an API failure ends the run. */
function whyClimb(e: unknown): string | undefined {
  if (e instanceof NotWorked) return e.message;
  if (!(e instanceof ShaftFailure)) return;
  if (e.code === 'review_invalid_reply') return "its reply didn't match the format";
  if (e.code !== 'review_failed') return;
  return /error_max_turns/.test(e.message) ? 'it ran out of turns' : 'the session failed';
}

/**
 * Run `attempt` on each rung in turn, until one works: the session errored, ran out of turns or gave
 * a reply that doesn't match the format, or the attempt threw `NotWorked`. The last rung's failure is
 * the run's. Each attempt gets the earlier one's failure, and `spent` adds up what the failed ones used.
 */
export async function climb<T>(
  rungs: Choice[],
  attempt: (c: Choice, last: boolean, earlier?: string) => Promise<T>,
): Promise<{ out: T; choice: Choice; tried: Tried[]; spent: Spent }> {
  const tried: Tried[] = [];
  const spent: Spent = { models: [], costUsd: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } };
  let earlier: string | undefined;
  for (const [i, c] of rungs.entries()) {
    const last = i === rungs.length - 1;
    try {
      return { out: await attempt(c, last, earlier), choice: c, tried, spent };
    } catch (e) {
      const why = last ? undefined : whyClimb(e);
      if (!why) throw e;
      const f = e as ShaftFailure;
      if (f.spent) {
        spent.models.push(...f.spent.models);
        spent.costUsd += f.spent.costUsd;
        for (const k of Object.keys(spent.tokens) as (keyof Spent['tokens'])[]) spent.tokens[k] += f.spent.tokens[k];
      }
      tried.push({ model: c.model, effort: c.effort, why });
      earlier = e instanceof NotWorked ? e.context : f.message;
      core.info(`${c.model}, effort ${c.effort}, didn't work (${why}), so the run tries ${rungs[i + 1]!.model}`);
    }
  }
  throw new Error('climb needs at least one rung');
}

/** Nothing used, for a run with no model call. */
export const NO_SPEND: Spent = { models: [], costUsd: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } };

/** The session's usage plus what the failed rungs used. */
export function withSpent<R extends { tokens: Spent['tokens']; costUsd: number }>(r: R, spent: Spent): R {
  const tokens = { ...r.tokens };
  for (const k of Object.keys(tokens) as (keyof Spent['tokens'])[]) tokens[k] += spent.tokens[k];
  return { ...r, tokens, costUsd: r.costUsd + spent.costUsd };
}

/** The run's model for the API, which has no field for the ladder: the one that ran, then the rungs tried before it. */
export const modelLabel = (model: string, tried: Tried[]) => (tried.length ? `${model} (after ${tried.map((t) => t.model).join(', ')})` : model).slice(0, 200);
