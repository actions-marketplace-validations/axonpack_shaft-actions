import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { reportRun } from './services/api.service';
import { reviewPullRequest } from './services/review.service';
import { forcedReviewDenial, hasWriteAccess, route } from './services/route.service';
import { resolveTokens } from './services/tokens.service';
import { mergeSettings } from './utils/settings.util';

const input = (name: string) => core.getInput(name);

function oneOf(name: string, allowed: string[], value = input(name)): string {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')}, not "${value}".`);
  return value;
}

function number(name: string, text: string): number {
  const value = Number(text);
  if (!(value > 0)) throw new Error(`${name} must be a positive number, not "${text}".`);
  return value;
}

async function run(): Promise<void> {
  const started = Date.now();
  const r = route(context.eventName, context.payload, { mode: oneOf('mode', ['auto', 'review', 'task']) });
  if (r.mode === 'skip') return r.notice ? core.notice(r.reason) : core.info(r.reason);

  const { owner, repo } = context.repo;
  const tokens = await resolveTokens(
    {
      claudeCodeOauthToken: input('claude_code_oauth_token'),
      anthropicApiKey: input('anthropic_api_key'),
      appId: input('app_id'),
      privateKey: input('private_key'),
      githubToken: input('github_token'),
    },
    context.repo,
    { job: r.mode, event: r.mode === 'review' ? r.event : undefined },
  );
  if ('reason' in tokens) return core.notice(tokens.reason);
  const octokit = getOctokit(tokens.github);

  if (r.mode === 'task') {
    if (!(await hasWriteAccess(octokit, owner, repo, r.actor))) return core.notice(`${r.actor} has no write access, so no task was started.`);
    return core.notice('Task mode is not built yet.');
  }
  if (r.actor) {
    const why = await forcedReviewDenial(octokit, owner, repo, r.number, r.actor);
    if (why) return core.notice(why);
  }

  const settings = mergeSettings(input, tokens.settings, tokens.job?.options);
  const out = await reviewPullRequest({
    octokit,
    owner,
    repo,
    number: r.number,
    claude: tokens.claude,
    secrets: [tokens.claude.value, tokens.github, Buffer.from(`x-access-token:${tokens.github}`).toString('base64')],
    model: settings.model,
    effort: oneOf('effort', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], settings.effort),
    depth: oneOf('depth', ['standard', 'deep'], settings.depth),
    nits: oneOf('nits', ['summary', 'inline', 'off'], settings.nits),
    maxTurns: number('max_turns', settings.maxTurns),
    timeoutMinutes: number('timeout_minutes', settings.timeLimit),
    configPath: input('config_path'),
    dashboard: tokens.settings,
    instructions: tokens.job?.instructions,
    checks: tokens.job?.checks,
    dryRun: core.getBooleanInput('dry_run'),
    runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
    cwd: process.env.GITHUB_WORKSPACE ?? process.cwd(),
  });
  core.setOutput('verdict', out.verdict);
  core.setOutput('findings', out.findings);
  core.setOutput('summary_url', out.summaryUrl);
  // Only when /v1/token answered, which opened the run on the dashboard.
  if (tokens.settings) {
    await reportRun({ verdict: out.verdict, model: out.model, effort: out.effort, findings: out.bySeverity, duration_ms: Date.now() - started });
  }
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));
