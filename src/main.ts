import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { reviewPullRequest } from './services/review.service';
import { hasWriteAccess, route } from './services/route.service';
import { resolveTokens } from './services/tokens.service';
import { mergeSettings } from './utils/settings.util';

const input = (name: string) => core.getInput(name);

function oneOf(name: string, allowed: string[], value = input(name)): string {
  if (!allowed.includes(value)) throw new Error(`${name} must be one of ${allowed.join(', ')}, not "${value}".`);
  return value;
}

function number(name: string): number {
  const value = Number(input(name));
  if (!(value > 0)) throw new Error(`${name} must be a positive number, not "${input(name)}".`);
  return value;
}

async function run(): Promise<void> {
  const r = route(context.eventName, context.payload, {
    mode: oneOf('mode', ['auto', 'review', 'task']),
    triggerPhrase: input('trigger_phrase'),
  });
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
  );
  const octokit = getOctokit(tokens.github);

  if (r.mode === 'task') {
    if (!(await hasWriteAccess(octokit, owner, repo, r.actor))) return core.notice(`${r.actor} has no write access, so no task was started.`);
    return core.notice('Task mode is not built yet.');
  }

  const settings = mergeSettings(input, tokens.settings);
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
    maxTurns: number('max_turns'),
    timeoutMinutes: number('timeout_minutes'),
    configPath: input('config_path'),
    dryRun: core.getBooleanInput('dry_run'),
    runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
    cwd: process.env.GITHUB_WORKSPACE ?? process.cwd(),
  });
  core.setOutput('verdict', out.verdict);
  core.setOutput('findings', out.findings);
  core.setOutput('summary_url', out.summaryUrl);
}

run().catch((e) => core.setFailed(e instanceof Error ? e.message : String(e)));
