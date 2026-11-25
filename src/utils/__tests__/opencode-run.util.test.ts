import { expect, test } from 'vitest';
import { addChildUsage, childUsageSql, emptyEvents, modelProblem, opencodePermission, opencodeTools, readEvent, replyJson, schemaPrompt } from '../opencode-run.util';

test("the job's Claude tools map to OpenCode's, without edits outside a task", () => {
  expect(opencodeTools(['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)'], false)).toEqual(['read', 'grep', 'glob', 'bash']);
  expect(opencodeTools(['Read', 'Edit', 'Write', 'Bash'], false)).toEqual(['read', 'bash']);
  expect(opencodeTools(['Read', 'Edit', 'Write', 'Bash'], true)).toEqual(['read', 'edit', 'apply_patch', 'write', 'bash']);
  expect(opencodeTools([], false)).toEqual([]);
});

test('permissions deny everything first, then allow only the listed tools', () => {
  expect(opencodePermission([], {})).toEqual({ '*': 'deny', external_directory: 'deny' });
  const review = opencodePermission(['read', 'bash'], { mcp: true });
  expect(Object.keys(review)[0]).toBe('*');
  expect(review.bash).toEqual({ '*': 'deny', 'git diff *': 'allow', 'git log *': 'allow', 'git show *': 'allow' });
  expect(review['shaft_*']).toBe('allow');
  expect(review.edit).toBeUndefined();
  const task = opencodePermission(['bash', 'edit'], { prefix: "'bwrap' '--'" });
  expect(task.bash).toEqual({ '*': 'deny', "'bwrap' '--' *": 'allow' });
  expect(task.edit).toEqual({ '*': 'allow', '.git/*': 'deny', '.github/*': 'deny' });
  expect(opencodePermission(['task'], { passes: [{ name: 'security', description: '', prompt: '' }] }).task).toEqual({ '*': 'deny', security: 'allow' });
});

test('the reply is the JSON object in the last text, fence or not', () => {
  expect(replyJson('```json\n{"verdict":"approve"}\n```')).toEqual({ verdict: 'approve' });
  expect(replyJson('no json')).toBeUndefined();
  expect(replyJson('[1]')).toBeUndefined();
  expect(schemaPrompt('Review', { type: 'object' })).toContain('{"type":"object"}');
});

test('run events: the last text, tokens and cost summed per step, tool calls and errors', () => {
  const e = emptyEvents();
  const lines = [
    { type: 'step_start', part: {} },
    { type: 'tool_use', part: { tool: 'bash', state: { status: 'error', input: { command: 'git log' }, error: 'denied' } } },
    { type: 'step_finish', part: { tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 50, write: 10 } }, cost: 0.01 } },
    { type: 'text', part: { text: 'first' } },
    { type: 'step_finish', part: { tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.02 } },
    { type: 'text', part: { text: '{"a":1}' } },
    { type: 'error', error: { name: 'APIError', data: { message: 'bad key' } } },
  ];
  for (const l of lines) readEvent(JSON.stringify({ sessionID: 'ses_1', ...l }), e);
  readEvent('a log line', e);
  expect(e).toEqual({
    session: 'ses_1',
    text: '{"a":1}',
    tokens: { input: 101, output: 27, cache_read: 50, cache_write: 10 },
    costUsd: 0.03,
    tools: [{ tool: 'bash', input: { command: 'git log' }, error: 'denied' }],
    errors: ['bad key'],
  });
});

test("the deep passes' usage is read from their sessions' step-finish parts and added to the totals", () => {
  expect(childUsageSql('ses_abc123')).toContain("parent_id = 'ses_abc123'");
  expect(childUsageSql("ses_x' or 1=1 --")).toBeUndefined();
  expect(childUsageSql(undefined)).toBeUndefined();
  const e = emptyEvents();
  e.tokens.input = 10;
  e.costUsd = 0.5;
  addChildUsage(JSON.stringify([{ input: 100, output: 20, cache_read: 3, cache_write: 4, cost: 0.25 }]), e);
  addChildUsage('not json', e);
  expect(e.tokens).toEqual({ input: 110, output: 20, cache_read: 3, cache_write: 4 });
  expect(e.costUsd).toBe(0.75);
});

test("a model the pinned OpenCode's list lacks, or a provider it doesn't list, is named before the run", () => {
  const listed = 'opencode/big-pickle\nopencode/deepseek-v4.1-flash-free\n';
  expect(modelProblem('opencode/big-pickle', '1.19.6', listed)).toBeUndefined();
  expect(modelProblem('opencode/gpt-9', '1.19.6', listed)).toBe("opencode/gpt-9 isn't in OpenCode 1.19.6's model list");
  expect(modelProblem('opencode/big', '1.19.6', listed)).toBeDefined();
  expect(modelProblem('nosuch/x', '1.19.6', undefined)).toBe("OpenCode 1.19.6 has no provider nosuch, or its key isn't set for this run");
});
