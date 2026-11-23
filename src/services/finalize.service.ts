import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { redact } from '../utils/render.util';
import { reportRun } from './api.service';

/** How the run ended, for closing what it left open on GitHub. */
export type Ending = { kind: 'finished' } | { kind: 'failed'; error: unknown } | { kind: 'cancelled'; message: string };

/**
 * What this run has open on GitHub: its check runs still in progress, by ID. Saved to the job's state on every change, so the post step can close them
 * when the main step died before it could.
 */
type Open = {
  token?: string;
  owner?: string;
  repo?: string;
  runUrl?: string;
  /** When the API opened the run's row, so a cancelled run is reported to it. */
  started?: number;
  checks: Record<string, string>;
  /** `finalize` already ran, in the main step. */
  finalized?: boolean;
};

const STATE = 'shaft';
let open: Open = { checks: {} };
/** Values that must never reach GitHub. The post step knows only the token. */
let secrets: string[] = [];
let closing: Promise<void> | undefined;

const save = () => core.saveState(STATE, JSON.stringify(open));

/** The run's token and repo, once the API granted the run. The token goes in the job's state for the post step. */
export function trackRun(o: { token: string; owner: string; repo: string; runUrl: string; started: number; secrets: string[] }): void {
  const { secrets: s, ...rest } = o;
  secrets = s;
  Object.assign(open, rest);
  save();
}

/** A check run this run posted: in progress when `name` is given, else done. */
export function trackCheck(id: number, name?: string): void {
  if (name) open.checks[id] = name;
  else delete open.checks[id];
  save();
}

/** In the post step: what the main step saved. */
export function resume(): void {
  try {
    const saved = core.getState(STATE);
    if (saved) open = JSON.parse(saved);
    secrets = open.token ? [open.token] : [];
  } catch (e) {
    core.warning(`Couldn't read what the run left open: ${(e as Error).message}`);
  }
}

/**
 * Closes every check run still in progress: cancelled on
 * a cancel, failed on a failure (a check that never got its result mustn't read as passed), and neutral
 * after a normal finish, where a check left open is a bug. A cancel is also reported to the API, unless
 * the main step got this far before. Runs once, whoever calls it first, and never throws.
 */
export function finalize(e: Ending): Promise<void> {
  return (closing ??= close(e).catch((err: Error) => core.warning(`Couldn't close what the run left open: ${err.message}`)));
}

async function close(e: Ending): Promise<void> {
  const { token, owner, repo, runUrl, started } = open;
  const report = e.kind === 'cancelled' && started !== undefined && !open.finalized;
  open.finalized = true;
  save();
  const failure =
    e.kind === 'cancelled'
      ? new ShaftFailure('cancelled', e.message, runUrl)
      : e.kind === 'failed' && e.error instanceof ShaftFailure
        ? e.error
        : new ShaftFailure('review_failed', e.kind === 'failed' ? String(e.error instanceof Error ? e.error.message : e.error) : 'The review ended without posting its result. Rerun the job.', runUrl);
  const end =
    e.kind === 'cancelled'
      ? { conclusion: 'cancelled' as const, title: 'Cancelled', summary: e.message }
      : e.kind === 'failed'
        ? { conclusion: 'failure' as const, title: 'The review failed', summary: failureMarkdown(failure) }
        : { conclusion: 'neutral' as const, title: 'Finished without a result', summary: 'Axon Shaft finished without a result for this check.' };
  const clean = (s: string) => redact(s, secrets);
  const jobs: Promise<unknown>[] = [];
  if (token && owner && repo && Object.keys(open.checks).length) {
    const gh = getOctokit(token);
    for (const [id, name] of Object.entries(open.checks)) {
      if (e.kind === 'finished') core.warning(`The ${name} check was still in progress when the run finished, so it's closed as neutral.`);
      const output = { title: end.title, summary: clean(end.summary) };
      jobs.push(gh.rest.checks.update({ owner, repo, check_run_id: Number(id), status: 'completed', conclusion: end.conclusion, output }).then(() => trackCheck(Number(id))));
    }
  }
  if (report) jobs.push(reportRun({ error: { code: 'cancelled', message: clean(failure.message) }, duration_ms: Date.now() - started }));
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === 'rejected') core.warning(`Couldn't close what the run left open: ${(r.reason as Error).message}`);
  }
}
