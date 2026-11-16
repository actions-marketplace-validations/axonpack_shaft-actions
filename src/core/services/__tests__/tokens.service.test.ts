import { beforeEach, expect, mock, test } from 'bun:test';

const masked: string[] = [];
const calls: unknown[] = [];
mock.module('@actions/core', () => ({ setSecret: (s: string) => masked.push(s) }));
mock.module('@octokit/auth-app', () => ({
  createAppAuth: (opts: unknown) => async () => {
    calls.push(opts);
    return { token: 'app-jwt' };
  },
}));
mock.module('@actions/github', () => ({
  getOctokit: (token: string) => ({
    rest: {
      apps: {
        getRepoInstallation: async (repo: unknown) => {
          calls.push({ token, repo });
          return { data: { id: 77 } };
        },
        createInstallationAccessToken: async (req: unknown) => {
          calls.push(req);
          return { data: { token: 'ghs_installation' } };
        },
      },
    },
  }),
}));
const { resolveTokens } = await import('../tokens.service');

const repo = { owner: 'acme', repo: 'widgets' };
beforeEach(() => {
  masked.length = 0;
  calls.length = 0;
});

test('an OAuth token and the github_token', async () => {
  const t = await resolveTokens({ claudeCodeOauthToken: 'sk-ant-oat-1', githubToken: 'ghs_run' }, repo);
  expect(t).toEqual({ claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-1' }, github: 'ghs_run', via: 'github_token' });
  expect(masked).toEqual(['sk-ant-oat-1', 'ghs_run']);
});

test('an API key', async () => {
  const t = await resolveTokens({ anthropicApiKey: 'sk-ant-api-1', githubToken: 'ghs_run' }, repo);
  expect(t.claude).toEqual({ env: 'ANTHROPIC_API_KEY', value: 'sk-ant-api-1' });
});

test('neither or both Claude tokens fail with a clear message', async () => {
  await expect(resolveTokens({ githubToken: 'ghs_run' }, repo)).rejects.toThrow('Set claude_code_oauth_token or anthropic_api_key');
  await expect(resolveTokens({ claudeCodeOauthToken: 'a', anthropicApiKey: 'b', githubToken: 'ghs_run' }, repo)).rejects.toThrow('only one');
});

test('the app inputs mint an installation token scoped to this repo', async () => {
  const t = await resolveTokens({ anthropicApiKey: 'sk-ant-api-1', appId: '123', privateKey: 'PEM', githubToken: 'ghs_run' }, repo);
  expect(t).toMatchObject({ github: 'ghs_installation', via: 'app' });
  expect(calls).toEqual([
    { appId: '123', privateKey: 'PEM' },
    { token: 'app-jwt', repo },
    { installation_id: 77, repositories: ['widgets'] },
  ]);
  expect(masked).toEqual(['sk-ant-api-1', 'ghs_installation']);
});

test('only one of app_id and private_key fails', async () => {
  await expect(resolveTokens({ anthropicApiKey: 'k', appId: '123', githubToken: 'ghs_run' }, repo)).rejects.toThrow('both app_id and private_key');
});
