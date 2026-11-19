import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { APP_BOT, DASHBOARD_URL } from './consts/api.const';
import { fetchGrant, reportRun } from './services/api.service';
import { checkoutHead } from './services/checkout.service';
import { reviewPullRequest } from './services/review.service';
import { commentOnce, hasWriteAccess, pullRequestOf, REVIEW_COMMAND, route } from './services/route.service';
import { step } from './services/step.service';
import { failureMarkdown, ShaftFailure } from './utils/failure.util';
import { redact } from './utils/render.util';

/** A setting from the Axon Shaft API, checked before the review starts. */
function oneOf(name: string, allowed: string[], value: unknown): string {
  if (typeof value === 'string' && allowed.includes(value)) return value;
  throw new ShaftFailure('api_error', `The Axon Shaft API sent ${name} "${value}", which isn't one of ${allowed.join(', ')}. Check the repo's settings on the dashboard.`, DASHBOARD_URL);
}

function positive(name: string, value: unknown): number {
  const n = Number(value);
  if (n > 0) return n;
  throw new ShaftFailure('api_error', `The Axon Shaft API sent ${name} "${value}", which isn't a positive number. Check the repo's settings on the dashboard.`, DASHBOARD_URL);
}

const globs = (v: unknown) => (Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []);

/** Set once the API has opened the run's row: a failure after that is reported to it, so the dashboard shows it. */
let reportFailure: ((e: unknown) => Promise<void>) | undefined;

async function run(): Promise<void> {
  const started = Date.now();
  const r = route(context.eventName, context.payload);
  if (r.mode === 'skip') return r.notice ? core.notice(r.reason) : core.info(r.reason);

  const dryRun = core.getBooleanInput('dry_run');
  const cwd = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const { owner, repo } = context.repo;
  const pull_request = pullRequestOf(context.payload);
  const grant = await step('Config from the dashboard', () =>
    fetchGrant(r.mode === 'review' ? { job: 'review', event: r.event, fork: r.fork, pull_request } : { job: r.mode, pull_request }),
  );
  if (!grant.run) {
    // The API's comment to post once: how to start a fork's review, or the list of commands for /help.
    if (typeof grant.comment === 'string' && typeof grant.github_token === 'string') {
      if (dryRun) core.info(`--- comment\n${grant.comment}`);
      else await commentOnce(getOctokit(grant.github_token), owner, repo, r.number, grant.comment, APP_BOT);
    }
    return core.notice(grant.reason);
  }
  const octokit = getOctokit(grant.github_token);

  if (r.mode !== 'review') {
    if (!(await hasWriteAccess(octokit, owner, repo, r.actor))) return core.notice(`${r.actor} has no write access, so nothing was started.`);
    return core.notice(`${r.mode === 'reply' ? 'Reply' : 'Task'} mode is not built yet.`);
  }
  if (r.actor && !(await hasWriteAccess(octokit, owner, repo, r.actor))) {
    return core.notice(`${r.actor} has no write access, so no review was started. Only people with write access can start one with ${REVIEW_COMMAND}.`);
  }
  const secrets = [grant.claude_token.value, grant.github_token, Buffer.from(`x-access-token:${grant.github_token}`).toString('base64')];
  reportFailure = (e) =>
    reportRun({
      error: { code: e instanceof ShaftFailure ? e.code : 'review_failed', message: redact(e instanceof Error ? e.message : String(e), secrets) },
      duration_ms: Date.now() - started,
    });
  // On pull_request the checkout is the PR merged into its base; anywhere else it's the base branch.
  if (context.eventName !== 'pull_request') await step('Check out the pull request', async () => checkoutHead(cwd, r.number, grant.github_token));

  const { settings, job } = grant;
  const out = await reviewPullRequest({
    octokit,
    owner,
    repo,
    number: r.number,
    claude: grant.claude_token,
    secrets,
    model: String(settings.model ?? ''),
    effort: oneOf('effort', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], settings.effort),
    depth: oneOf('depth', ['standard', 'deep'], job.options.depth),
    nits: oneOf('nits', ['summary', 'inline', 'off'], job.options.nits),
    maxTurns: positive('maxTurns', settings.maxTurns),
    timeoutMinutes: positive('timeLimit', settings.timeLimit),
    skip: globs(settings.skip),
    focus: globs(settings.focus),
    env: globs(settings.env),
    bot: APP_BOT,
    prompt: job.prompt,
    checks: job.checks,
    dryRun,
    runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
    cwd,
  });
  core.setOutput('verdict', out.verdict);
  core.setOutput('findings', out.findings);
  core.setOutput('summary_url', out.summaryUrl);
  await reportRun({
    verdict: out.verdict,
    model: out.model,
    effort: out.effort,
    findings: out.bySeverity,
    duration_ms: Date.now() - started,
    tokens: out.tokens,
    ...(grant.claude_token.kind === 'api_key' ? { cost_usd: out.costUsd } : {}),
    output: out.output,
  });
}

/** Fail the step; a known failure also puts its card, message and link in the job summary. */
async function fail(e: unknown): Promise<void> {
  core.setFailed(e instanceof Error ? e.message : String(e));
  await reportFailure?.(e);
  if (!(e instanceof ShaftFailure)) return;
  await core.summary
    .addRaw(failureMarkdown(e))
    .write()
    .catch((w: Error) => core.warning(`Couldn't write the job summary: ${w.message}`));
}

run().catch(fail);
