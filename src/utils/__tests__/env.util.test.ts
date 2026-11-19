import { expect, test } from 'vitest';
import { ENV_ALLOW } from '../../consts/env.const';
import { runnerEnv } from '../env.util';

test("the allowlist and the project's names the runner has, never a denied one", () => {
  Object.assign(process.env, { LANG: 'C.UTF-8', NODE_OPTIONS: '--x', GITHUB_TOKEN: 'ghs_env', ACTIONS_RUNTIME_TOKEN: 'r', INPUT_DRY_RUN: 'false', SECRET_THING: 's' });
  const env = runnerEnv(['NODE_OPTIONS', 'UNSET_NAME', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'INPUT_DRY_RUN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']);
  expect(env).toMatchObject({ LANG: 'C.UTF-8', NODE_OPTIONS: '--x', PATH: process.env.PATH });
  expect(Object.keys(env).filter((k) => !ENV_ALLOW.includes(k))).toEqual(['NODE_OPTIONS']);
});
