import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { API_URL } from '../consts/api.const';
import { ShaftFailure } from '../utils/failure.util';
import { callApi } from './api.service';
import { setClaudeConfigDir } from './claude-binary.service';

/** The server's name in Claude Code's config; its tools are `mcp__shaft__<tool>`. */
const NAME = 'shaft';

const unavailable = (why: string) =>
  new ShaftFailure('mcp_unavailable', `Couldn't connect Axon Shaft's MCP server, so the review didn't start: ${why.replace(/\.$/, '')}. Rerun the job in a few minutes.`);

/**
 * Before a review: get the run's read-only MCP token from the Axon Shaft API, add Shaft's MCP server
 * to a fresh Claude Code config folder for this run (in RUNNER_TEMP, which the model's tools can't
 * read), allow its tools there, and check the connection with `tools/list`. Any failure stops the
 * run with `mcp_unavailable`. Only the MCP token goes in the config: never a GitHub or Claude token.
 */
export async function addShaftMcp(): Promise<void> {
  let token: unknown;
  try {
    token = ((await callApi('/v1/mcp/token', {})) as { token?: unknown } | undefined)?.token;
  } catch (e) {
    throw unavailable((e as Error).message);
  }
  if (typeof token !== 'string') throw unavailable('the Axon Shaft API sent no MCP token');
  core.setSecret(token);
  const url = `${API_URL}/mcp`;
  const headers = { Authorization: `Bearer ${token}` };

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => e);
  if (res instanceof Error) throw unavailable(res.message);
  const tools = res.ok ? ((await res.json().catch(() => undefined)) as { result?: { tools?: { name: string }[] } } | undefined)?.result?.tools : undefined;
  if (!Array.isArray(tools) || !tools.length) throw unavailable(`its tools/list answered ${res.status}`);

  // Claude Code reads user-scope MCP servers from `.claude.json` and allow rules from `settings.json` in this folder.
  const dir = join(process.env.RUNNER_TEMP ?? tmpdir(), 'shaft-claude-config');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ mcpServers: { [NAME]: { type: 'http', url, headers } } }), { mode: 0o600 });
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: [`mcp__${NAME}`] } }), { mode: 0o600 });
  setClaudeConfigDir(dir);
  core.info(`Connected Axon Shaft's MCP server: ${tools.map((t) => t.name).join(', ')}`);
}
