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
        getAuthenticated: async () => ({ data: { slug: 'my-reviewer' } }),
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
type Tokens = import('../tokens.service').Tokens;

const repo = { owner: 'acme', repo: 'widgets' };
const job = { type: 'review', version: 1, options: { depth: 'standard' }, instructions: '1. **Verify.**' };
const grant = {
  run: true,
  github_token: 'ghs_shaft',
  claude_token: { kind: 'oauth', value: 'sk-ant-oat-shaft' },
  settings: { model: 'opus' },
  job,
};
const sent: unknown[] = [];
/** The Axon Shaft API answers with this grant, or fails to answer when given an Error. */
const api = (answer: object | Error) =>
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string));
    if (answer instanceof Error) throw answer;
    return Response.json(answer);
  });

beforeEach(() => {
  masked.length = 0;
  calls.length = 0;
  sent.length = 0;
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  api(grant);
});

const review = { job: 'review', event: 'opened' } as const;
const resolve = async (input: Parameters<typeof resolveTokens>[0]) => (await resolveTokens(input, repo, review)) as Tokens;

test('with no inputs, both tokens, the settings and the job come from the Axon Shaft API', async () => {
  const t = await resolve({});
  expect(sent).toEqual([review]);
  expect(t).toEqual({
    claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-shaft' },
    github: 'ghs_shaft',
    via: 'shaft',
    bot: 'axonshaft[bot]',
    settings: { model: 'opus' },
    job,
  });
  expect(masked).toEqual(expect.arrayContaining(['sk-ant-oat-shaft', 'ghs_shaft']));
});

test("github_token beats the API's GitHub token; the Claude token and settings still come from the API", async () => {
  expect(await resolve({ githubToken: 'ghs_run' })).toMatchObject({ github: 'ghs_run', via: 'github_token', claude: { value: 'sk-ant-oat-shaft' }, job });
});

test("run: false gives the API's reason and no tokens", async () => {
  api({ run: false, reason: 'Code review is off for this repo.' });
  expect(await resolveTokens({}, repo, review)).toEqual({ reason: 'Code review is off for this repo.' });
});

test("the API's api_key token goes in ANTHROPIC_API_KEY", async () => {
  api({ ...grant, claude_token: { kind: 'api_key', value: 'sk-ant-api-shaft' } });
  const t = await resolve({});
  expect(t.claude).toEqual({ env: 'ANTHROPIC_API_KEY', value: 'sk-ant-api-shaft' });
});

test("a Claude input beats the API's token", async () => {
  const oauth = await resolve({ claudeCodeOauthToken: 'sk-ant-oat-1' });
  expect(oauth).toMatchObject({ claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-1' }, github: 'ghs_shaft' });
  const key = await resolve({ anthropicApiKey: 'sk-ant-api-1' });
  expect(key.claude).toEqual({ env: 'ANTHROPIC_API_KEY', value: 'sk-ant-api-1' });
});

test("the app inputs beat the API's GitHub token, with an installation token scoped to this repo", async () => {
  const t = await resolve({ appId: '123', privateKey: 'PEM', githubToken: 'ghs_run' });
  expect(t).toMatchObject({ github: 'ghs_installation', via: 'app', bot: 'my-reviewer[bot]', settings: { model: 'opus' } });
  expect(calls).toEqual([
    { appId: '123', privateKey: 'PEM' },
    { token: 'app-jwt', repo },
    { installation_id: 77, repositories: ['widgets'] },
  ]);
  expect(masked).toContain('ghs_installation');
});

test('standalone: a Claude input and github_token never call the API', async () => {
  const t = await resolve({ claudeCodeOauthToken: 'sk-ant-oat-1', githubToken: 'ghs_run' });
  expect(sent).toEqual([]);
  expect(t).toEqual({ claude: { env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-1' }, github: 'ghs_run', via: 'github_token', bot: 'github-actions[bot]' });
  expect(masked).toEqual(['sk-ant-oat-1', 'ghs_run']);
});

test('standalone: a Claude input and the app inputs never call the API', async () => {
  const t = await resolve({ anthropicApiKey: 'sk-ant-api-1', appId: '123', privateKey: 'PEM' });
  expect(sent).toEqual([]);
  expect(t).toEqual({ claude: { env: 'ANTHROPIC_API_KEY', value: 'sk-ant-api-1' }, github: 'ghs_installation', via: 'app', bot: 'my-reviewer[bot]' });
});

test("with a token missing from the inputs, the API's error fails the run", async () => {
  api(new TypeError('fetch failed'));
  await expect(resolve({ githubToken: 'ghs_run' })).rejects.toThrow("Couldn't reach the Axon Shaft API");
  await expect(resolve({ claudeCodeOauthToken: 'sk-ant-oat-1' })).rejects.toThrow("Couldn't reach the Axon Shaft API");
});

test('no Claude token anywhere fails with a link to the dashboard', async () => {
  api({ ...grant, claude_token: null });
  await expect(resolve({ githubToken: 'ghs_run' })).rejects.toThrow('save one on https://shaft.axonpack.dev');
});

test('both Claude inputs, or only one app input, fail', async () => {
  await expect(resolve({ claudeCodeOauthToken: 'a', anthropicApiKey: 'b' })).rejects.toThrow('only one');
  await expect(resolve({ anthropicApiKey: 'k', appId: '123' })).rejects.toThrow('both app_id and private_key');
});
