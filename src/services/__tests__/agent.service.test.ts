import { beforeEach, expect, test, vi } from 'vitest';

const infos: string[] = [];
const warnings: string[] = [];
vi.doMock('@actions/core', () => ({ info: (s: string) => infos.push(s), warning: (s: string) => warnings.push(s) }));
/** What the mocked Agent SDK does on each `query`: yield these messages, throw, or wait for the abort. */
let reply: 'hang' | Error | object[] = [];
const asked: { options: { agents?: unknown; abortController: AbortController; outputFormat: { schema: any } } }[] = [];
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
const { setClaudeConfigDir } = await import('../claude-binary.service');
const { bashFailure, cliEnv, deepAgents, REVIEW_FORMAT, reviewSchema, runAgent, SCHEMA, sumTokens, toolTarget } = await import('../agent.service');

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
  expect(Object.keys(env).filter((k) => !ENV_ALLOW.includes(k)).sort()).toEqual([
    'CLAUDE_AGENT_SDK_CLIENT_APP',
    'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS',
    'CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_SUBPROCESS_ENV_SCRUB',
    'NODE_OPTIONS',
  ]);
  // Background commands are off, so no repo code runs while the CLI's file tools act.
  expect(env).toMatchObject({ CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF: '1' });
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

test("the CLI loads user settings only from the action's own config folder, and never the project's", async () => {
  const review = { verdict: 'looks-good', headline: 'h', findings: [] };
  reply = [{ type: 'result', subtype: 'success', structured_output: review, modelUsage: {}, total_cost_usd: 0 }];
  await runAgent('prompt', options, REVIEW_FORMAT);
  setClaudeConfigDir('/runner/temp/shaft-claude-config');
  await runAgent('prompt', options, REVIEW_FORMAT);
  setClaudeConfigDir(undefined);
  const [before, after] = asked.map((a) => a.options as unknown as { settingSources: string[]; env: Record<string, string> });
  expect(before.settingSources).toEqual([]);
  expect(before.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  expect(after.settingSources).toEqual(['user']);
  expect(after.env.CLAUDE_CONFIG_DIR).toBe('/runner/temp/shaft-claude-config');
});

test('a deep run gives the SDK the passes as agents; a standard one gives none', async () => {
  const review = { verdict: 'looks-good', headline: 'h', findings: [] };
  reply = [{ type: 'result', subtype: 'success', structured_output: review, modelUsage: {}, total_cost_usd: 0 }];
  const pass = { name: 'breakage', description: 'd', prompt: 'p' };
  await runAgent('prompt', { ...options, subagentModel: 'sonnet', passes: [pass] }, REVIEW_FORMAT);
  await runAgent('prompt', options, REVIEW_FORMAT);
  expect(Object.keys(asked[0].options.agents as object)).toEqual(['breakage']);
  expect(asked[1].options.agents).toBeUndefined();
});

test("a pass with checklists limits the reply's step to their keys; without, it's 1.5's fixed steps", async () => {
  reply = [{ type: 'result', subtype: 'success', structured_output: { verdict: 'looks-good', headline: 'h', findings: [] }, modelUsage: {}, total_cost_usd: 0 }];
  await runAgent('prompt', options, { ...REVIEW_FORMAT, schema: reviewSchema(['correctness', 'own-1']) });
  await runAgent('prompt', options, { ...REVIEW_FORMAT, schema: reviewSchema([]) });
  await runAgent('prompt', options, REVIEW_FORMAT);
  const steps = asked.map(({ options: { outputFormat: { schema } } }) => [schema.properties.findings.items.properties.step, schema.properties.checked.items]);
  expect(steps[0]).toEqual([{ enum: ['correctness', 'own-1'] }, { enum: ['correctness', 'own-1'] }]);
  expect(steps[1]).toEqual([{ type: 'string' }, { type: 'string' }]);
  expect(asked[2]!.options.outputFormat.schema).toEqual({ ...SCHEMA, properties: { ...SCHEMA.properties, injection_seen: expect.any(Object) } });
  expect(SCHEMA.properties.findings.items.properties.step.enum).toContain('rules');
});

test("a task's session may edit and run the repo's commands, each call through the guard; a review's may not edit", async () => {
  process.env.GITHUB_TOKEN = 'ghs_env';
  reply = [{ type: 'result', subtype: 'success', structured_output: { verdict: 'looks-good', headline: 'h', findings: [] }, modelUsage: {}, total_cost_usd: 0 }];
  await runAgent('prompt', { ...options, cwd: process.cwd(), commands: ['bun run test'] }, REVIEW_FORMAT);
  await runAgent('prompt', options, REVIEW_FORMAT);
  const [task, review] = asked.map((a) => a.options as unknown as { tools: string[]; allowedTools: string[]; env: object; hooks: { PreToolUse: { hooks: ((i: object) => Promise<any>)[] }[] } });
  expect(task!.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write']);
  // No rule allows a task's Bash: only the guard's allow does.
  expect(task!.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Edit', 'Write']);
  expect(review!.tools).not.toContain('Edit');
  expect(JSON.stringify(task!.env)).not.toMatch(/ghs_/);
  const hook = task!.hooks.PreToolUse[0]!.hooks[0]!;
  const decide = async (tool_name: string, tool_input: object) => (await hook({ tool_name, tool_input }))?.hookSpecificOutput?.permissionDecision ?? 'allow';
  expect(await decide('Bash', { command: 'bun run test src/a.test.ts' })).toBe('allow');
  expect(await decide('Bash', { command: 'bun run test', run_in_background: true })).toBe('deny');
  expect(await decide('Edit', { file_path: 'src/a.ts' })).toBe('allow');
  for (const command of ['git push origin HEAD', 'gh pr view', 'git commit -m x', 'npm install left-pad', 'bun run deploy']) expect(await decide('Bash', { command }), command).toBe('deny');
  expect(await decide('Write', { file_path: '.git/hooks/pre-push' })).toBe('deny');
  expect(await decide('Edit', { file_path: '.github/workflows/ci.yml' })).toBe('deny');
  // A task's allowed Bash runs in the sandbox, its command unchanged after the prefix; a review's runs as it is.
  const { sandboxPrefix } = await import('../sandbox.service');
  expect((await hook({ tool_name: 'Bash', tool_input: { command: 'bun run test', timeout: 5 } })).hookSpecificOutput).toEqual({
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: { command: `${sandboxPrefix(process.cwd())} bun run test`, timeout: 5 },
  });
  const reviewHook = review!.hooks.PreToolUse[0]!.hooks[0]!;
  expect(await reviewHook({ tool_name: 'Bash', tool_input: { command: 'git diff' } })).toEqual({});
});

test('a run past the time limit is review_timed_out, linking the dashboard', async () => {
  reply = 'hang';
  expect(await failure(runAgent('prompt', { ...options, timeoutMinutes: 0.0005 }, REVIEW_FORMAT))).toEqual({
    code: 'review_timed_out',
    message: 'The review ran past its 0.0005-minute time limit. Raise the time limit on the dashboard, or rerun the job.',
    url: 'https://shaft.axonpack.dev',
  });
});

test("a reply that misses the schema twice is review_invalid_reply, and the log names its fields without the finding's text", async () => {
  const findings = [{ title: 'Token sent in the URL', body: 'The session token goes in the query string.' }];
  reply = [{ type: 'result', subtype: 'success', structured_output: { verdict: 'maybe', findings }, result: '', modelUsage: {}, total_cost_usd: 0 }];
  warnings.length = 0;
  expect(await failure(runAgent('prompt', options, REVIEW_FORMAT))).toMatchObject({ code: 'review_invalid_reply', url: undefined });
  expect(asked).toHaveLength(2);
  expect(warnings).toEqual([1, 2].map((n) => `The reply didn't match the review schema (attempt ${n}), its fields: verdict, findings`));
});

test('an SDK error, or anything else that breaks the run, is review_failed', async () => {
  reply = [{ type: 'result', subtype: 'error_max_turns', errors: ['Reached the turn limit.'] }];
  expect(await failure(runAgent('prompt', options, REVIEW_FORMAT))).toMatchObject({
    code: 'review_failed',
    message: 'The review failed: The Agent SDK run ended with error_max_turns: Reached the turn limit. Rerun the job; the job log has the details.',
    url: undefined,
  });
  reply = new Error('Claude Code process exited with code 1.');
  expect(await failure(runAgent('prompt', options, REVIEW_FORMAT))).toMatchObject({
    code: 'review_failed',
    message: 'The review failed: Claude Code process exited with code 1. Rerun the job; the job log has the details.',
  });
});

test("another job's format: its schema goes to the SDK, its check gives the reply, and its name is in the failures", async () => {
  const format = { name: 'reply', schema: { type: 'object' }, parse: (x: unknown) => (x as { answer?: string })?.answer };
  reply = [{ type: 'result', subtype: 'success', structured_output: { answer: 'In src/a.ts:3.' }, modelUsage: {}, total_cost_usd: 0 }];
  expect((await runAgent('prompt', options, format)).reply).toBe('In src/a.ts:3.');
  expect((asked[0].options as { outputFormat?: unknown }).outputFormat).toEqual({ type: 'json_schema', schema: { type: 'object', properties: { injection_seen: expect.any(Object) } } });
  reply = 'hang';
  expect((await failure(runAgent('prompt', { ...options, timeoutMinutes: 0.0005 }, format))).message).toMatch(/^The reply ran past its/);
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
  await runAgent('prompt', options, REVIEW_FORMAT).catch(() => {});
  expect(infos).toEqual(['Read src/pay.ts', 'Task Security pass', '[security] Grep exec\\(']);
  expect(toolTarget({ command: 'bun   test\n --watch' })).toBe('bun test --watch');
  expect(toolTarget({ file_path: 'x'.repeat(300) })).toHaveLength(200);
  expect(toolTarget({})).toBe('');
});

test('a failed Bash call gets one short line in the log: the command and what it printed first and last', async () => {
  const use = (id: string, name: string, input: object) => ({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id: string, content: unknown, is_error: boolean) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
  reply = [
    use('b1', 'Bash', { command: 'socat -V' }),
    result('b1', 'Exit code 127\nbwrap: execvp socat: No such file or directory', true),
    use('b2', 'Bash', { command: 'bun run test' }),
    result('b2', [{ type: 'text', text: '3 passed' }], false),
    use('r1', 'Read', { file_path: 'missing.ts' }),
    result('r1', 'File does not exist.', true),
    { type: 'result', subtype: 'success', structured_output: { verdict: 'looks-good', headline: 'h', findings: [] }, modelUsage: {}, total_cost_usd: 0 },
  ];
  infos.length = 0;
  await runAgent('prompt', options, REVIEW_FORMAT).catch(() => {});
  expect(infos).toEqual(['Bash socat -V', 'Bash failed: socat -V: Exit code 127, bwrap: execvp socat: No such file or directory', 'Bash bun run test', 'Read missing.ts']);
  expect(bashFailure('x', undefined)).toBe('Bash failed: x: no output');
  expect(bashFailure('x', 'y'.repeat(400))).toHaveLength(300);
});
