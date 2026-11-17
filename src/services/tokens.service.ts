import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { createAppAuth } from '@octokit/auth-app';
import { DASHBOARD_URL } from '../consts/api.const';
import { fetchGrant, type Grant, type GrantJob, type GrantRequest } from './api.service';

export type TokenInputs = {
  claudeCodeOauthToken?: string;
  anthropicApiKey?: string;
  appId?: string;
  privateKey?: string;
  githubToken?: string;
};

/** The env var the Claude Code CLI reads the token from. */
export type ClaudeToken = { env: 'CLAUDE_CODE_OAUTH_TOKEN' | 'ANTHROPIC_API_KEY'; value: string };

export type Tokens = {
  claude: ClaudeToken;
  github: string;
  via: 'app' | 'shaft' | 'github_token';
  /** The dashboard's settings; undefined when the Axon Shaft API wasn't used. */
  settings?: Record<string, unknown>;
  /** The project's job from the Axon Shaft API; undefined when it wasn't used. */
  job?: GrantJob;
};

/**
 * Each token comes from the first source that has it. Claude: the inputs, then the Axon Shaft API.
 * GitHub: the app inputs, then `github_token`, then the Axon Shaft API. With every token given as an
 * input the API isn't called (standalone); otherwise it is, and when it says not to run, its reason
 * comes back instead.
 */
export async function resolveTokens(
  input: TokenInputs,
  repo: { owner: string; repo: string },
  request: GrantRequest,
): Promise<Tokens | { reason: string }> {
  const { claudeCodeOauthToken: oauth, anthropicApiKey: apiKey, appId, privateKey } = input;
  if (oauth && apiKey) throw new Error('Set only one of claude_code_oauth_token and anthropic_api_key, not both.');
  if (!appId !== !privateKey) throw new Error('Set both app_id and private_key, or neither.');

  let grant: Extract<Grant, { run: true }> | undefined;
  if (!((oauth || apiKey) && ((appId && privateKey) || input.githubToken))) {
    const answer = await fetchGrant(request);
    if (!answer.run) return { reason: answer.reason };
    grant = answer;
  }

  let claude: ClaudeToken;
  if (oauth) claude = { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: oauth };
  else if (apiKey) claude = { env: 'ANTHROPIC_API_KEY', value: apiKey };
  else if (grant?.claude_token) {
    claude = { env: grant.claude_token.kind === 'oauth' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY', value: grant.claude_token.value };
  } else {
    throw new Error(`No Claude token: save one on ${DASHBOARD_URL}, or set claude_code_oauth_token or anthropic_api_key.`);
  }
  core.setSecret(claude.value);

  let github: string;
  let via: Tokens['via'];
  if (appId && privateKey) {
    const { token: jwt } = await createAppAuth({ appId, privateKey })({ type: 'app' });
    const app = getOctokit(jwt);
    const { data: installation } = await app.rest.apps.getRepoInstallation(repo);
    const { data } = await app.rest.apps.createInstallationAccessToken({
      installation_id: installation.id,
      repositories: [repo.repo],
    });
    github = data.token;
    via = 'app';
  } else if (grant) {
    github = grant.github_token;
    via = 'shaft';
  } else {
    github = input.githubToken!; // standalone without app inputs
    via = 'github_token';
  }
  core.setSecret(github);
  return { claude, github, via, settings: grant && (grant.settings ?? {}), job: grant?.job };
}
