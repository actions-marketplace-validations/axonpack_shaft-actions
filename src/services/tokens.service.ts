import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { createAppAuth } from '@octokit/auth-app';
import { DASHBOARD_URL } from '../consts/api.const';
import { fetchGrant, type Grant } from './api.service';

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
};

/**
 * Each token comes from the first source that has it. Claude: the inputs, then the Axon Shaft API.
 * GitHub: the app inputs, then the Axon Shaft API, then `github_token`.
 */
export async function resolveTokens(input: TokenInputs, repo: { owner: string; repo: string }): Promise<Tokens> {
  const { claudeCodeOauthToken: oauth, anthropicApiKey: apiKey, appId, privateKey } = input;
  if (oauth && apiKey) throw new Error('Set only one of claude_code_oauth_token and anthropic_api_key, not both.');
  if (!appId !== !privateKey) throw new Error('Set both app_id and private_key, or neither.');

  let grant: Grant | undefined;
  try {
    grant = await fetchGrant();
  } catch (e) {
    if (!oauth && !apiKey) throw e; // nothing else has a Claude token
    core.info(`Not using the Axon Shaft API: ${(e as Error).message}`);
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
    if (!input.githubToken) throw new Error('No GitHub token: set github_token, or app_id and private_key.');
    github = input.githubToken;
    via = 'github_token';
  }
  core.setSecret(github);
  return { claude, github, via, settings: grant && (grant.settings ?? {}) };
}
