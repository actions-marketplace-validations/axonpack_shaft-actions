import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, test, vi } from 'vitest';

const masked: string[] = [];
vi.doMock('@actions/core', () => ({ setSecret: (s: string) => masked.push(s), getIDToken: async () => 'oidc', info: () => {} }));
const { addShaftMcp } = await import('../mcp-setup.service');
const { claudeConfigDir, setClaudeConfigDir } = await import('../claude-binary.service');

const API = 'https://api-shaft.axonpack.dev';
const requests: { url: string; init: RequestInit }[] = [];
/** The API's answers, by path: the MCP token, then tools/list. */
const answer = (token: Response, tools: Response | Error) =>
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    if (url.endsWith('/v1/mcp/token')) return token;
    if (tools instanceof Error) throw tools;
    return tools;
  });
const listed = () => Response.json({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_advisories' }, { name: 'get_checklist' }, { name: 'code_quality' }] } });
const failure = (p: Promise<unknown>) => p.then(() => expect.unreachable(), (e) => ({ code: e.code, message: e.message }));

beforeEach(() => {
  masked.length = 0;
  requests.length = 0;
  setClaudeConfigDir(undefined);
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://oidc.example';
  process.env.RUNNER_TEMP = mkdtempSync(join(tmpdir(), 'mcp-setup-'));
});

test("gets the MCP token with the run's OIDC token, checks tools/list, and writes only that token to Claude Code's config", async () => {
  answer(Response.json({ token: 'mcp-tok', expires_in: 21600 }), listed());
  await addShaftMcp();
  expect(requests.map((r) => r.url)).toEqual([`${API}/v1/mcp/token`, `${API}/mcp`]);
  expect(requests[0].init.headers).toMatchObject({ authorization: 'Bearer oidc' });
  expect(requests[1].init.headers).toMatchObject({ Authorization: 'Bearer mcp-tok' });
  expect(JSON.parse(requests[1].init.body as string)).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  expect(masked).toEqual(['mcp-tok']);

  const dir = claudeConfigDir()!;
  expect(dir).toBe(join(process.env.RUNNER_TEMP!, 'shaft-claude-config'));
  expect(JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8'))).toEqual({
    mcpServers: { shaft: { type: 'http', url: `${API}/mcp`, headers: { Authorization: 'Bearer mcp-tok' } } },
  });
  expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ permissions: { allow: ['mcp__shaft'] } });
  expect(statSync(join(dir, '.claude.json')).mode & 0o777).toBe(0o600);
});

test('stops the run with mcp_unavailable, and writes no config, when the token or the server fails', async () => {
  answer(Response.json({ error: 'mcp_token_failed', message: 'This run has no open review on a pull request.' }, { status: 403 }), listed());
  expect(await failure(addShaftMcp())).toEqual({
    code: 'mcp_unavailable',
    message: "Couldn't connect Axon Shaft's MCP server, so the review didn't start: This run has no open review on a pull request. Rerun the job in a few minutes.",
  });
  answer(Response.json({ token: 'mcp-tok' }), Response.json({ error: 'mcp_token_invalid' }, { status: 401 }));
  expect((await failure(addShaftMcp())).message).toContain('its tools/list answered 401');
  answer(Response.json({ token: 'mcp-tok' }), new Error('connect ECONNREFUSED'));
  expect((await failure(addShaftMcp())).message).toContain('connect ECONNREFUSED');
  answer(Response.json({}), listed());
  expect((await failure(addShaftMcp())).message).toContain('sent no MCP token');
  expect(claudeConfigDir()).toBeUndefined();
});
