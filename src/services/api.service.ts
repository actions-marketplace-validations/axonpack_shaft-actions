import * as core from '@actions/core';
import { API_AUDIENCE, API_URL } from '../consts/api.const';
import { ShaftFailure } from '../utils/failure.util';
import type { PullRequest, ReviewEvent } from './route.service';

/**
 * What `POST /v1/token` takes: the job the event routed to, for a pull request event which one, for
 * a review whether the PR comes from a fork, and the pull request when the payload has it.
 * `help` asks for the list of commands to post; the rest are a job kind.
 */
export type GrantRequest = { job: 'review' | 'task' | 'reply' | 'help'; event?: ReviewEvent; fork?: boolean; pull_request?: PullRequest };

/** One of the deep review's subagents, for a check the project keeps on. */
export type Pass = { name: string; description: string; prompt: string };

/**
 * The project's job: `options` filled in with the catalog's defaults, `checks` the keys of the
 * catalog checks it keeps on, and `prompt` the whole review prompt, whose `{{slots}}` the action
 * fills with the run's data, plus the deep review's `passes`.
 */
export type GrantJob = {
  type: string;
  version: number;
  options: Record<string, unknown>;
  checks: string[];
  prompt: { template: string; passes: Pass[] };
};

/** The project's Claude token, from the dashboard. */
export type ClaudeToken = { kind: 'oauth' | 'api_key'; value: string };

/**
 * What `POST /v1/token` returns: no run (the job is off, or not on for this event), or the run's
 * tokens. A fork's PR on a job set to ask a maintainer first also gets the `comment` to post, and the
 * GitHub token to post it with.
 */
export type Grant =
  | { run: false; reason: string; comment?: string; github_token?: string }
  | {
      run: true;
      github_token: string;
      claude_token: ClaudeToken;
      /** The dashboard's settings for this repo, already merged with the account's and the defaults. */
      settings: Record<string, unknown>;
      job: GrantJob;
      /** The run's page on the dashboard. Older APIs don't send it. */
      run_url?: string;
    };

/** What the dashboard shows of a finished review: the card, as the PR comment has it. */
export type RunOutput = {
  headline: string;
  claim: string;
  impact: string;
  scope: string;
  not_checked: string;
  type: string;
  confidence: number;
  comment_url: string;
  checks: { key: string; label: string; state: string }[];
  findings: { severity: string; check: string; file: string; line: number; end_line?: number; title: string; body: string; suggestion?: string; inline: boolean }[];
  fixed: number;
};

/** What `POST /v1/runs` takes: a finished review, or a run that failed after it opened. */
export type RunSummary = RunDone | { error: { code: string; message: string }; duration_ms: number };
type RunDone = {
  verdict: string;
  model: string;
  effort: string;
  findings: { blocking: number; should_fix: number; nit: number };
  duration_ms: number;
  tokens: { input: number; output: number; cache_read: number; cache_write: number };
  /** Only for a run on an API key: on a Claude plan the SDK's price isn't what anyone pays. */
  cost_usd?: number;
  output: RunOutput;
};

/** POST to the Axon Shaft API with a fresh OIDC token: the API refuses a token it has already seen. */
async function post(path: string, body: unknown): Promise<Response> {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new ShaftFailure('missing_id_token', 'Add `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.');
  }
  const oidc = await core.getIDToken(API_AUDIENCE);
  try {
    return await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${oidc}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new ShaftFailure('api_unreachable', `Couldn't reach the Axon Shaft API at ${API_URL} (${(e as Error).message}). Rerun the job in a few minutes.`);
  }
}

/** Whether to run, and this repo's GitHub token, Claude token, settings and job from the Axon Shaft API. Both tokens are masked. */
export async function fetchGrant(request: GrantRequest): Promise<Grant> {
  const res = await post('/v1/token', request);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    // The API's errors are `{ error, message, url? }`; anything else came from something in front of it.
    if (typeof body?.error === 'string' && typeof body.message === 'string') {
      throw new ShaftFailure(body.error, body.message, typeof body.url === 'string' ? body.url : undefined);
    }
    throw new ShaftFailure('api_error', `The Axon Shaft API answered ${res.status}. Rerun the job in a few minutes.`);
  }
  const grant = body as Grant | undefined;
  if (grant?.run === false) {
    if (typeof grant.github_token === 'string') core.setSecret(grant.github_token);
    return grant;
  }
  if (typeof grant?.github_token !== 'string' || typeof grant.claude_token?.value !== 'string' || typeof grant.job?.prompt?.template !== 'string' || !Array.isArray(grant.job.prompt.passes)) {
    throw new ShaftFailure('api_error', 'The Axon Shaft API sent an incomplete answer. Rerun the job in a few minutes.');
  }
  core.setSecret(grant.github_token);
  core.setSecret(grant.claude_token.value);
  return grant;
}

/** Record the run on the dashboard. Best effort: a failure is logged and never fails the run. */
export async function reportRun(summary: RunSummary): Promise<void> {
  try {
    const res = await post('/v1/runs', summary);
    if (!res.ok) throw new Error(`the API answered ${res.status}`);
  } catch (e) {
    core.warning(`Couldn't record the run on the Axon Shaft API: ${(e as Error).message}`);
  }
}
