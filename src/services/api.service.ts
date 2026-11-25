import * as core from '@actions/core';
import { ACTION_VERSION, API_AUDIENCE, API_URL, DASHBOARD_URL } from '../consts/api.const';
import { KEY_NAME_ALLOWED, KEY_NAME_DENIED_PREFIXES } from '../consts/env.const';
import { ShaftFailure } from '../utils/failure.util';
import { abuseEvents } from '../abuse/classify.service';
import type { Flagged } from '../abuse/output.util';
import type { FollowUp, PullRequest, ReviewEvent } from './route.service';

/**
 * What `POST /v1/token` takes: the job the event routed to, for a pull request event which one, for
 * a review whether the PR comes from a fork, and the pull request when the payload has it.
 * `help` asks for the list of commands to post, and `dismiss` or `undismiss` for a token to change a
 * finding's state with; the rest are a job kind.
 */
export type GrantRequest = {
  job: 'review' | 'task' | 'reply' | 'help' | 'dismiss' | 'undismiss';
  event?: ReviewEvent;
  fork?: boolean;
  pull_request?: PullRequest;
  /** With `job: 'task'`, the follow-up command that asked for it. An older API ignores it and runs a plain Task. */
  command?: FollowUp;
  /** The comment on a line of the diff that asked for the run, so the API can reply on its thread when it refuses it. An older API ignores it. */
  comment?: { id: number };
};

/** One of the deep review's subagents, for a check the project keeps on. */
export type Pass = { name: string; description: string; prompt: string };

/**
 * One checklist the job keeps on, in the job's order, then the project's own (`own-<n>`): it runs when
 * a changed file matches its `paths` and not its `exclude`, and `prompt` is its step. A community one
 * (`@publisher/slug`) also has its `publisher` and `version`, which the action doesn't need.
 */
export type Checklist = {
  key: string;
  name: string;
  mode: 'script' | 'script+model' | 'model';
  model: 'main' | 'light';
  paths: string[];
  /** Globs on the changed files it never looks at, from an API that sends them. */
  exclude?: string[];
  prestep: string | null;
  prompt: string;
  /** Its script's settings, as plain data (a size limit, globs). Older APIs send none, and each script keeps its own defaults. */
  data?: Record<string, unknown>;
};

/**
 * The project's job: `options` filled in with the catalog's defaults, `checks` the keys of the
 * catalog checks it keeps on, and `prompt` the job's whole prompt (a review's or a reply's), whose
 * `{{slots}}` the action fills with the run's data, plus the deep review's `passes`. An API that
 * sends `checklists` also sends the review prompt with `{{steps}}` left `open`, and the steps that
 * always run `before` and `after` the checklists; an older one sends none of them, and the action
 * runs `template` as 1.5 did.
 */
export type GrantJob = {
  type: string;
  version: number;
  options: Record<string, unknown>;
  checks: string[];
  prompt: { template: string; passes: Pass[]; open?: string; before?: string[]; after?: string[] };
  checklists?: Checklist[] | null;
};

/** A newer v1 release of the action than this run's: its version (`1.6.2`) and its release page. */
export type LatestAction = { version: string; url: string };

/** The project's Claude token, from the dashboard. */
export type ClaudeToken = { kind: 'oauth' | 'api_key'; value: string };

/** The project's OpenCode settings: a `provider/model`, an optional variant, and each key as the env var its provider reads (none for a free model). */
export type OpencodeGrant = {
  model: string;
  effort?: string;
  keys: { name: string; value: string }[];
  /** Keys kept in GitHub Actions secrets, by name: the workflow maps each into the step's env. The action reads them into `keys`. */
  github_keys?: string[];
};

/**
 * The names a stored key may take, as the API checks them: upper-case, ending in `_KEY` or `_TOKEN`, never
 * `NODE_OPTIONS` or `PATH`, and never starting with one of `KEY_NAME_DENIED_PREFIXES` unless it is one of `KEY_NAME_ALLOWED`. The API's data
 * never picks a variable that changes what a program runs.
 */
export const keyNameAllowed = (name: string): boolean =>
  /^[A-Z][A-Z0-9_]*_(KEY|TOKEN)$/.test(name) && name !== 'NODE_OPTIONS' && name !== 'PATH' && (KEY_NAME_ALLOWED.includes(name) || !KEY_NAME_DENIED_PREFIXES.some((p) => name.startsWith(p)));

/** The grant's `opencode`, checked: every key name allowed, else the run stops with `opencode_key_refused`. */
function checkOpencode(o: unknown): OpencodeGrant {
  const g = o as OpencodeGrant | undefined;
  if (typeof g?.model !== 'string' || !g.model.includes('/') || (g.effort !== undefined && typeof g.effort !== 'string') || (g.keys !== undefined && !Array.isArray(g.keys)) || (g.github_keys !== undefined && !Array.isArray(g.github_keys))) {
    throw new ShaftFailure('api_error', 'The Axon Shaft API sent an incomplete OpenCode setting. Rerun the job in a few minutes.');
  }
  // No keys is fine: OpenCode's free models need none, and the run gets only `runnerEnv`.
  const keys = g.keys ?? [];
  for (const k of keys) {
    if (typeof k?.name !== 'string' || typeof k.value !== 'string') throw new ShaftFailure('api_error', 'The Axon Shaft API sent an incomplete OpenCode key. Rerun the job in a few minutes.');
    if (!keyNameAllowed(k.name)) {
      throw new ShaftFailure('opencode_key_refused', `The OpenCode key named ${k.name.slice(0, 64)} isn't allowed, so no model ran. A key's name is upper-case and ends in _KEY or _TOKEN. Rename it on the dashboard.`, DASHBOARD_URL);
    }
  }
  // A key kept in GitHub: the same name rule, and its value from the step's env, which the workflow maps from the secret.
  const github = (g.github_keys ?? []).map((name) => {
    if (typeof name !== 'string') throw new ShaftFailure('api_error', 'The Axon Shaft API sent an incomplete OpenCode key. Rerun the job in a few minutes.');
    if (!keyNameAllowed(name)) {
      throw new ShaftFailure('opencode_key_refused', `The OpenCode key named ${name.slice(0, 64)} isn't allowed, so no model ran. A key's name is upper-case and ends in _KEY or _TOKEN. Rename it on the dashboard.`, DASHBOARD_URL);
    }
    const value = process.env[name];
    if (!value) {
      throw new ShaftFailure('opencode_key_missing', `The OpenCode key ${name} is kept in GitHub, and this run has no ${name}, so no model ran. Add it as an Actions secret, and add \`${name}: \${{ secrets.${name} }}\` under \`env:\` on the Axon Shaft step in the workflow.`);
    }
    return { name, value };
  });
  return { model: g.model, ...(g.effort && { effort: g.effort }), keys: [...keys.map(({ name, value }) => ({ name, value })), ...github] };
}

/**
 * What `POST /v1/token` returns: no run (the job is off, or not on for this event), or the run's
 * tokens. A fork's PR on a job set to ask a maintainer first also gets the `comment` to post, and the
 * GitHub token to post it with. `code` names why nothing runs (`paused`, `filtered`, `skip_label`, …), for
 * the notice to link to its docs; older APIs send none, or only `notice: 'spending_cap'`. A `/dismiss`
 * or `/undismiss` the API allows gets `dismiss: true` and the token to post with: no run, no model.
 */
export type Grant =
  | { run: false; reason: string; code?: string; notice?: string; comment?: string; github_token?: string; dismiss?: boolean }
  | {
      run: true;
      github_token: string;
      claude_token: ClaudeToken;
      /** Which agent runs the model. Absent from an older API, and then `claude`. */
      provider?: 'claude' | 'opencode';
      /** With `provider: 'opencode'`. */
      opencode?: OpencodeGrant;
      /**
       * The dashboard's settings for this repo, already merged with the account's and the defaults.
       * `maxTurnsDefault: true` says `maxTurns` is the default, not a value set on the dashboard.
       */
      settings: Record<string, unknown>;
      job: GrantJob;
      /** The run's page on the dashboard. Older APIs don't send it. */
      run_url?: string;
      /** Only when this run is pinned to an older v1 release than the newest. Older APIs don't send it. */
      latest_action?: LatestAction;
      /** Permissions the run wanted that the installation hasn't approved, each with the warning to log. Older APIs don't send it. */
      missing_permissions?: MissingPermission[];
      /**
       * The users in this run (the actor, the pull request's author) with 1 or 2 active abuse strikes,
       * and `rules`, extra input rules (regex strings) the action adds to its own. Older APIs send neither.
       */
      abuse?: { flagged: Flagged[]; rules?: unknown };
      /** The project's guardrails, org rules then project rules. Older APIs don't send them. */
      guardrails?: unknown;
      /** The old name of `abuse`, which an API from before the rename sends instead. */
      guardrail?: { flagged: Flagged[]; rules?: unknown };
    };

/** A permission the AxonShaft app wants at `wanted` that the installation approved only at `granted`, or not at all. */
export type MissingPermission = { name: string; wanted: string; granted: string | null; warning: string };

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
  /** Each model session the run made, with the checklists it ran. Only when the job has checklists. */
  passes?: { name: string; model: string; tokens: { input: number; output: number; cache_read: number; cache_write: number }; checklists: string[]; max_turns?: number }[];
  findings: { severity: string; check: string; file: string; line: number; end_line?: number; title: string; body: string; suggestion?: string; url?: string; inline: boolean }[];
  fixed: number;
  /** The findings dismissed on the pull request, with who and why. Only when there are any. */
  dismissed?: { severity: string; file: string; line: number; title: string; by: string; reason: string }[];
};

/** What `POST /v1/runs` takes: a finished review, reply or task, or a run that failed after it opened. */
export type RunSummary = RunDone | ReplyDone | { error: { code: string; message: string }; duration_ms: number };
/** A finished reply or task: no verdict or findings, and what it posted as `output`. */
type ReplyDone = Pick<RunDone, 'model' | 'effort' | 'duration_ms' | 'tokens' | 'cost_usd'> & {
  /** `command` is the follow-up that ran, and `commit` the sha it pushed, when it pushed one. */
  output: { answer: string; comment_url: string; command?: FollowUp; commit?: string };
};
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

/** The answer's JSON, or the API's error as a `ShaftFailure`: `{ error, message, url? }`, else something in front of the API answered. */
async function answer(res: Response): Promise<unknown> {
  const body = await res.json().catch(() => undefined);
  if (res.ok) return body;
  if (typeof body?.error === 'string' && typeof body.message === 'string') {
    throw new ShaftFailure(body.error, body.message, typeof body.url === 'string' ? body.url : undefined);
  }
  throw new ShaftFailure('api_error', `The Axon Shaft API answered ${res.status}. Rerun the job in a few minutes.`);
}

/** POST to the Axon Shaft API and return its answer's JSON, or throw its error as a `ShaftFailure`. */
export async function callApi(path: string, body: unknown): Promise<unknown> {
  return answer(await post(path, body));
}

/**
 * Like `callApi`, but undefined when the API is older than `path`: its 404, or the 403 its guard gives
 * a path it doesn't know, neither with the JSON error every route of the API sends.
 */
export async function callNewApi(path: string, body: unknown): Promise<unknown> {
  const res = await post(path, body);
  if ((res.status === 403 || res.status === 404) && typeof (await res.clone().json().catch(() => undefined))?.error !== 'string') return undefined;
  return answer(res);
}

/**
 * Whether to run, and this repo's GitHub token, Claude token, settings and job from the Axon Shaft API.
 * Both tokens are masked. It also sends this build's version and the ref the workflow runs it at
 * (`v1`, `v1.5.0`, a branch or a SHA), so the API can say when a newer release is out.
 */
export async function fetchGrant(request: GrantRequest): Promise<Grant> {
  const grant = (await answer(await post('/v1/token', { ...request, action: { version: ACTION_VERSION, ref: process.env.GITHUB_ACTION_REF } }))) as Grant | undefined;
  if (grant?.run === false) {
    if (typeof grant.github_token === 'string') core.setSecret(grant.github_token);
    return grant;
  }
  const provider = grant?.provider ?? 'claude';
  if (
    typeof grant?.github_token !== 'string' ||
    (provider !== 'claude' && provider !== 'opencode') ||
    (provider === 'claude' && typeof grant.claude_token?.value !== 'string') ||
    typeof grant.job?.prompt?.template !== 'string' ||
    !Array.isArray(grant.job.prompt.passes)
  ) {
    throw new ShaftFailure('api_error', 'The Axon Shaft API sent an incomplete answer. Rerun the job in a few minutes.');
  }
  core.setSecret(grant.github_token);
  if (provider === 'claude') {
    core.setSecret(grant.claude_token.value);
    return grant;
  }
  const opencode = checkOpencode(grant.opencode);
  for (const k of opencode.keys) core.setSecret(k.value);
  // No Claude token runs on OpenCode; an empty one is never used, and never redacted.
  const claude = typeof grant.claude_token?.value === 'string' ? grant.claude_token : { kind: 'api_key' as const, value: '' };
  if (claude.value) core.setSecret(claude.value);
  return { ...grant, provider, opencode, claude_token: claude };
}

/** What `POST /v1/push-token` returns: a token with Contents write only, and the pull request's branch as GitHub has it. */
export type PushGrant = { push_token: string; branch: string };

/**
 * A task's push token, asked for only once its checks have passed. The API reads the run's pull
 * request from GitHub again and refuses a fork's, the default branch and someone without write
 * access, with `push_failed`. The token is masked.
 */
export async function fetchPushToken(): Promise<PushGrant> {
  const grant = (await answer(await post('/v1/push-token', {}))) as PushGrant | undefined;
  if (typeof grant?.push_token !== 'string' || typeof grant.branch !== 'string') {
    throw new ShaftFailure('api_error', 'The Axon Shaft API sent an incomplete answer. Rerun the job in a few minutes.');
  }
  core.setSecret(grant.push_token);
  return grant;
}

/**
 * Record the run on the dashboard, with this run's abuse events (`abuse`, and the same under the old name
 * `guardrail`, only when there are any). Best effort: a failure is logged and never fails the run.
 */
export async function reportRun(summary: RunSummary): Promise<void> {
  const abuse = abuseEvents();
  try {
    // ponytail: `guardrail` duplicates `abuse` for an API from before the rename; drop it once every deployed API reads `abuse`.
    const res = await post('/v1/runs', { ...summary, ...(abuse.length && { abuse, guardrail: abuse }) });
    if (!res.ok) throw new Error(`the API answered ${res.status}`);
  } catch (e) {
    core.warning(`Couldn't record the run on the Axon Shaft API: ${(e as Error).message}`);
  }
}
