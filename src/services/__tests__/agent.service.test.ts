import { beforeEach, expect, test, vi } from 'vitest';

const infos: string[] = [];
vi.doMock('@actions/core', () => ({ info: (s: string) => infos.push(s), warning: () => {} }));
/** What the mocked Agent SDK does on each `query`: yield these messages, throw, or wait for the abort. */
let reply: 'hang' | Error | object[] = [];
const asked: { options: { agents?: unknown; abortController: AbortController } }[] = [];
vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
  async *query(args: (typeof asked)[number]) {
    asked.push(args);
    if (reply instanceof Error) throw reply;
    if (reply === 'hang') {
      await new Promise((_, reject) => args.options.abortController.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } else yield* reply;
  },
}));
const { ENV_ALLOW } = await import('../../consts/env.const');
const { cliEnv, deepAgents, runAgent, sumTokens, toolTarget } = await import('../agent.service');

beforeEach(() => {
  reply = [];
  asked.length = 0;
});

test('the CLI gets the allowlist, the project\'s own names and the Claude token, and no token the runner holds', () => {
  Object.assign(process.env, {
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-secret',
    ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
    INPUT_GITHUB_TOKEN: 'ghs_input',
    INPUT_DRY_RUN: 'false',
    GITHUB_TOKEN: 'ghs_env',
    ANTHROPIC_API_KEY: 'sk-ant-api-other',
    LANG: 'C.UTF-8',
    CI: 'true',
    NODE_OPTIONS: '--max-old-space-size=4096',
    SECRET_THING: 'not-passed',
  });
  // A project asking for denied names gets none of them.
  const names = ['NODE_OPTIONS', 'UNSET_NAME', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN', 'INPUT_GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];
  const env = cliEnv({ kind: 'oauth', value: 'sk-ant-oat-1' }, names);
  expect(env).toMatchObject({
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat-1',
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
    PATH: process.env.PATH,
    LANG: 'C.UTF-8',
    CI: 'true',
    NODE_OPTIONS: '--max-old-space-size=4096',
  });
  expect(Object.keys(env).filter((k) => !ENV_ALLOW.includes(k)).sort()).toEqual(['CLAUDE_AGENT_SDK_CLIENT_APP', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB', 'NODE_OPTIONS']);
  expect(JSON.stringify(env)).not.toMatch(/oidc|runtime-secret|ghs_|sk-ant-api|not-passed/);
  expect(cliEnv({ kind: 'api_key', value: 'sk-ant-api-1' })).toMatchObject({ ANTHROPIC_API_KEY: 'sk-ant-api-1' });
});

test("the deep review's subagents are the dashboard's passes, with read-only tools on the subagent model", () => {
  const passes = [
    { name: 'correctness', description: 'Finds logic errors.', prompt: 'You review for correctness.' },
    { name: 'security', description: 'Finds security problems.', prompt: 'You review for security.' },
  ];
  expect(deepAgents('sonnet', 'high', passes)).toEqual({
    correctness: { description: 'Finds logic errors.', prompt: 'You review for correctness.', tools: ['Read', 'Grep', 'Glob'], model: 'sonnet', effort: 'high' },
    security: { description: 'Finds security problems.', prompt: 'You review for security.', tools: ['Read', 'Grep', 'Glob'], model: 'sonnet', effort: 'high' },
  });
});

const options = { claude: { kind: 'oauth', value: 'k' }, model: 'sonnet', effort: 'medium', maxTurns: 1, timeoutMinutes: 1, cwd: '.' } as const;
const failure = (p: Promise<unknown>) =>
  p.then(
    () => expect.unreachable(),
    (e) => ({ code: e.code, message: e.message, url: e.url }),
  );

test('a deep run gives the SDK the passes as agents; a standard one gives none', async () => {
  const review = { verdict: 'looks-good', headline: 'h', findings: [] };
  reply = [{ type: 'result', subtype: 'success', structured_output: review, modelUsage: {}, total_cost_usd: 0 }];
  const pass = { name: 'breakage', description: 'd', prompt: 'p' };
  await runAgent('prompt', { ...options, subagentModel: 'sonnet', passes: [pass] });
  await runAgent('prompt', options);
  expect(Object.keys(asked[0].options.agents as object)).toEqual(['breakage']);
  expect(asked[1].options.agents).toBeUndefined();
});

test('a run past the time limit is review_timed_out, linking the dashboard', async () => {
  reply = 'hang';
  expect(await failure(runAgent('prompt', { ...options, timeoutMinutes: 0.0005 }))).toEqual({
    code: 'review_timed_out',
    message: 'The review ran past its 0.0005-minute time limit. Raise the time limit on the dashboard, or rerun the job.',
    url: 'https://shaft.axonpack.dev',
  });
});

test('a reply that misses the schema twice is review_invalid_reply', async () => {
  reply = [{ type: 'result', subtype: 'success', structured_output: { verdict: 'maybe' }, result: '', modelUsage: {}, total_cost_usd: 0 }];
  expect(await failure(runAgent('prompt', options))).toMatchObject({ code: 'review_invalid_reply', url: undefined });
  expect(asked).toHaveLength(2);
});

test('an SDK error, or anything else that breaks the run, is review_failed', async () => {
  reply = [{ type: 'result', subtype: 'error_max_turns', errors: ['Reached the turn limit.'] }];
  expect(await failure(runAgent('prompt', options))).toEqual({
    code: 'review_failed',
    message: 'The review failed: The Agent SDK run ended with error_max_turns: Reached the turn limit. Rerun the job; the job log has the details.',
    url: undefined,
  });
  reply = new Error('Claude Code process exited with code 1.');
  expect(await failure(runAgent('prompt', options))).toMatchObject({
    code: 'review_failed',
    message: 'The review failed: Claude Code process exited with code 1. Rerun the job; the job log has the details.',
  });
});

test('the tokens are the sum over every model the run used', () => {
  const u = (input: number) => ({ inputTokens: input, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, webSearchRequests: 0, costUSD: 0, contextWindow: 0, maxOutputTokens: 0 });
  expect(sumTokens({ 'claude-sonnet-5-5': u(10), 'claude-haiku-5-5': u(5) })).toEqual({ input: 15, output: 4, cache_read: 6, cache_write: 8 });
  expect(sumTokens({})).toEqual({ input: 0, output: 0, cache_read: 0, cache_write: 0 });
});

test('each tool call goes to the log, a deep pass\'s named after it', async () => {
  const use = (id: string, name: string, input: object, parent: string | null = null) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'tool_use', id, name, input }] },
  });
  reply = [
    use('t1', 'Read', { file_path: 'src/pay.ts' }),
    use('t2', 'Task', { subagent_type: 'security', description: 'Security pass' }),
    use('t3', 'Grep', { pattern: 'exec\\(' }, 't2'),
    { type: 'result', subtype: 'success', structured_output: { verdict: 'looks-good', headline: 'h', findings: [] }, modelUsage: {}, total_cost_usd: 0 },
  ];
  infos.length = 0;
  await runAgent('prompt', options).catch(() => {});
  expect(infos).toEqual(['Read src/pay.ts', 'Task Security pass', '[security] Grep exec\\(']);
  expect(toolTarget({ command: 'bun   test\n --watch' })).toBe('bun test --watch');
  expect(toolTarget({ file_path: 'x'.repeat(300) })).toHaveLength(200);
  expect(toolTarget({})).toBe('');
});
