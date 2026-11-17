import { expect, test } from 'vitest';
import { cliEnv } from '../agent.service';

test('the CLI gets PATH, HOME and the Claude token, and nothing else the runner holds', () => {
  Object.assign(process.env, {
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-secret',
    ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
    INPUT_GITHUB_TOKEN: 'ghs_input',
    GITHUB_TOKEN: 'ghs_env',
    ANTHROPIC_API_KEY: 'sk-ant-api-other',
  });
  const env = cliEnv({ env: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'sk-ant-oat-1' });
  expect(Object.keys(env).sort()).toEqual(['CLAUDE_AGENT_SDK_CLIENT_APP', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'HOME', 'PATH']);
  expect(env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1', CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1', PATH: process.env.PATH, HOME: process.env.HOME });
  expect(JSON.stringify(env)).not.toMatch(/oidc|runtime-secret|ghs_|sk-ant-api/);
});
