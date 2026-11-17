import * as core from '@actions/core';
import { API_AUDIENCE, API_URL, INSTALL_URL } from '../consts/api.const';

/** What `POST /v1/token` returns. */
export type Grant = {
  github_token: string;
  claude_token: { kind: 'oauth' | 'api_key'; value: string } | null;
  /** The dashboard's review settings for this repo; a field that isn't set there is null or missing. */
  settings?: Record<string, unknown>;
};

/** What `POST /v1/runs` takes. */
export type RunSummary = {
  verdict: string;
  model: string;
  effort: string;
  findings: { blocking: number; should_fix: number; nit: number };
  duration_ms: number;
};

/** POST to the Axon Shaft API with a fresh OIDC token: the API refuses a token it has already seen. */
async function post(path: string, body: unknown): Promise<Response> {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error('Add `permissions: id-token: write` to the workflow, so Axon Shaft can fetch its tokens from its API.');
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
    throw new Error(`Couldn't reach the Axon Shaft API at ${API_URL}: ${(e as Error).message}`);
  }
}

/** This repo's GitHub token, Claude token and settings from the Axon Shaft API. Both tokens are masked. */
export async function fetchGrant(): Promise<Grant> {
  const res = await post('/v1/token', {});
  if (res.status === 404) throw new Error(`The AxonShaft app isn't installed on this repo. Install it: ${INSTALL_URL}`);
  if (res.status === 429) throw new Error(`The Axon Shaft API rate-limited this repo. Retry-After: ${res.headers.get('retry-after') ?? 'not given'}.`);
  if (!res.ok) {
    const why = res.status === 401 || res.status === 403 ? "refused this run's OIDC token" : 'failed';
    throw new Error(`The Axon Shaft API ${why} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const grant = (await res.json()) as Grant;
  if (typeof grant?.github_token !== 'string') throw new Error('The Axon Shaft API sent no github_token.');
  core.setSecret(grant.github_token);
  if (grant.claude_token) core.setSecret(grant.claude_token.value);
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
