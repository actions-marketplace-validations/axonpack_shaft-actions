import { beforeEach, expect, test, vi } from 'vitest';

const masked: string[] = [];
const calls: unknown[] = [];
vi.doMock('@actions/core', () => ({
  setSecret: (s: string) => masked.push(s),
  getIDToken: async () => 'oidc',
  info: () => {},
}));
vi.doMock('@octokit/auth-app', () => ({
  createAppAuth: (opts: unknown) => async () => {
    calls.push(opts);
    return { token: 'app-jwt' };
  },
}));
vi.doMock('@actions/github', () => ({
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
const grant = {
  github_token: 'ghs_shaft',
  claude_token: { kind: 'oauth', value: 'sk-ant-oat-shaft' },
  settings: { model: 'opus' },
};
/** The Axon Shaft API answers with this grant, or fails to answer when given an Error. */
const api = (answer: object | Error) =>
  vi.stubGlobal('fetch', async () => {
    if (answer instanceof Error) throw answer;
    return Response.json(answer);
  });

beforeEach(() => {
  masked.length = 0;
  calls.length = 0;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  api(grant);
});

test('with no inputs, both tokens and the settings come from the Axon Shaft API', async () => {
  const t = await resolveTokens({ githubToken: 'ghs_run' }, repo);
  expect(t).toEqual({
    claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-shaft' },
    github: 'ghs_shaft',
    via: 'shaft',
    settings: { model: 'opus' },
  });
  expect(masked).toEqual(expect.arrayContaining(['sk-ant-oat-shaft', 'ghs_shaft']));
});

test("the API's api_key token goes in ANTHROPIC_API_KEY", async () => {
  api({ ...grant, claude_token: { kind: 'api_key', value: 'sk-ant-api-shaft' } });
  const t = await resolveTokens({}, repo);
  expect(t.claude).toEqual({ env: 'ANTHROPIC_API_KEY', value: 'sk-ant-api-shaft' });
});

test("a Claude input beats the API's token", async () => {
  const oauth = await resolveTokens({ claudeCodeOauthToken: 'sk-ant-oat-1' }, repo);
  expect(oauth).toMatchObject({ claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-1' }, github: 'ghs_shaft' });
  const key = await resolveTokens({ anthropicApiKey: 'sk-ant-api-1' }, repo);
  expect(key.claude).toEqual({ env: 'ANTHROPIC_API_KEY', value: 'sk-ant-api-1' });
});

test("the app inputs beat the API's GitHub token, with an installation token scoped to this repo", async () => {
  const t = await resolveTokens({ appId: '123', privateKey: 'PEM', githubToken: 'ghs_run' }, repo);
  expect(t).toMatchObject({ github: 'ghs_installation', via: 'app', settings: { model: 'opus' } });
  expect(calls).toEqual([
    { appId: '123', privateKey: 'PEM' },
    { token: 'app-jwt', repo },
    { installation_id: 77, repositories: ['widgets'] },
  ]);
  expect(masked).toContain('ghs_installation');
});

test('without the API, a Claude input and github_token still run', async () => {
  api(new TypeError('fetch failed'));
  const t = await resolveTokens({ claudeCodeOauthToken: 'sk-ant-oat-1', githubToken: 'ghs_run' }, repo);
  expect(t).toEqual({ claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-1' }, github: 'ghs_run', via: 'github_token', settings: undefined });
  expect(masked).toEqual(['sk-ant-oat-1', 'ghs_run']);
});

test("without the API and with no Claude input, the API's error fails the run", async () => {
  api(new TypeError('fetch failed'));
  await expect(resolveTokens({ githubToken: 'ghs_run' }, repo)).rejects.toThrow("Couldn't reach the Axon Shaft API");
});

test('no Claude token anywhere fails with a link to the dashboard', async () => {
  api({ ...grant, claude_token: null });
  await expect(resolveTokens({ githubToken: 'ghs_run' }, repo)).rejects.toThrow('save one on https://shaft.axonpack.dev');
});

test('both Claude inputs, or only one app input, fail', async () => {
  await expect(resolveTokens({ claudeCodeOauthToken: 'a', anthropicApiKey: 'b' }, repo)).rejects.toThrow('only one');
  await expect(resolveTokens({ anthropicApiKey: 'k', appId: '123' }, repo)).rejects.toThrow('both app_id and private_key');
});
