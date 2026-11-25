import { expect, test } from 'vitest';
import { opencodeArgs, opencodeConfig, opencodeEnv, sandboxUnset } from '../opencode.service';

const g = { model: 'openrouter/qwen', effort: 'high', keys: [{ name: 'OPENROUTER_API_KEY', value: 'sk-or' }] };

test('opencode run gets JSON events, our agent, the model and its variant', () => {
  expect(opencodeArgs(g)).toEqual(['run', '--format', 'json', '--agent', 'shaft', '-m', 'openrouter/qwen', '--variant', 'high']);
  expect(opencodeArgs({ ...g, effort: undefined })).not.toContain('--variant');
});

test("the env has the keys and the switches that keep the PR's config out, and no OPENCODE_ or XDG_ name of the project's", () => {
  process.env.OPENCODE_CONFIG_CONTENT = '{"plugin":["evil"]}';
  process.env.MY_VAR = 'v';
  const env = opencodeEnv(g, ['OPENCODE_CONFIG_CONTENT', 'MY_VAR', 'XDG_CONFIG_HOME'], { XDG_CONFIG_HOME: '/run/config' }, '/run/opencode.json');
  expect(env).toMatchObject({ OPENROUTER_API_KEY: 'sk-or', MY_VAR: 'v', XDG_CONFIG_HOME: '/run/config', OPENCODE_CONFIG: '/run/opencode.json', OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_DISABLE_AUTOUPDATE: '1' });
  expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
  delete process.env.OPENCODE_CONFIG_CONTENT;
});

test('the config loads only our guard plugin, with its options, and turns off formatters, LSP, sharing and updates', () => {
  const guard = { cwd: '/w', tools: ['read'], marker: '/run/m' };
  const c = opencodeConfig({ maxTurns: 7, cwd: '/w' } as never, g, guard, '/action/dist/opencode-guard.js');
  expect(c).toMatchObject({ autoupdate: false, share: 'disabled', snapshot: false, formatter: false, lsp: false, instructions: [] });
  expect(c.plugin).toEqual([['file:///action/dist/opencode-guard.js', guard]]);
  expect(c.mcp).toBeUndefined();
  expect((c.agent as Record<string, { steps: number; model: string }>).shaft).toMatchObject({ steps: 7, model: 'openrouter/qwen' });
});

test('with no keys, the env is runnerEnv and the run switches only', () => {
  const env = opencodeEnv({ model: 'opencode/free', keys: [] }, [], {}, '/run/opencode.json');
  expect(Object.keys(env).filter((k) => k.endsWith('_KEY') || k.endsWith('_TOKEN'))).toEqual([]);
});

test("a key kept in GitHub Actions secrets reaches OpenCode by its project variable's name, and never a task's sandbox", () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-from-github';
  const free = { model: 'openrouter/qwen', keys: [] };
  expect(opencodeEnv(free, ['OPENROUTER_API_KEY'], {}, '/run/opencode.json').OPENROUTER_API_KEY).toBe('sk-or-from-github');
  expect(sandboxUnset(g, ['OPENROUTER_API_KEY', 'HF_TOKEN', 'NODE_ENV'])).toEqual(['OPENROUTER_API_KEY', 'HF_TOKEN']);
  delete process.env.OPENROUTER_API_KEY;
});
