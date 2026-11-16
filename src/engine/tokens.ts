import * as core from '@actions/core';
import { getOctokit } from '@actions/github';
import { createAppAuth } from '@octokit/auth-app';

export type TokenInputs = {
  claudeCodeOauthToken?: string;
  anthropicApiKey?: string;
  appId?: string;
  privateKey?: string;
  githubToken?: string;
};

/** The env var the Claude Code CLI reads the token from. */
export type ClaudeToken = { env: 'CLAUDE_CODE_OAUTH_TOKEN' | 'ANTHROPIC_API_KEY'; value: string };

export type Tokens = { claude: ClaudeToken; github: string; via: 'app' | 'github_token' };

export async function resolveTokens(input: TokenInputs, repo: { owner: string; repo: string }): Promise<Tokens> {
  const { claudeCodeOauthToken: oauth, anthropicApiKey: apiKey, appId, privateKey } = input;
  if (!oauth === !apiKey) {
    throw new Error(
      oauth
        ? 'Set only one of claude_code_oauth_token and anthropic_api_key, not both.'
        : 'Set claude_code_oauth_token or anthropic_api_key. A PR from a fork gets no secrets, so it can\'t be reviewed this way.',
    );
  }
  const claude: ClaudeToken = oauth
    ? { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: oauth }
    : { env: 'ANTHROPIC_API_KEY', value: apiKey! };
  core.setSecret(claude.value);

  if (!appId !== !privateKey) throw new Error('Set both app_id and private_key, or neither.');

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
  } else {
    if (!input.githubToken) throw new Error('No GitHub token: set github_token, or app_id and private_key.');
    github = input.githubToken;
    via = 'github_token';
  }
  core.setSecret(github);
  return { claude, github, via };
}
