import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@actions/core';
import { DASHBOARD_URL } from '../consts/api.const';
import { runnerEnv } from '../utils/env.util';
import { ShaftFailure } from '../utils/failure.util';
import { pushDenial, type PushTarget } from '../utils/push.util';

/**
 * Push the checkout's HEAD to `target.branch` on `url` (the repo on GitHub), when `mode` allows it.
 * Called after the agent's session has ended. The checkout is the model's, so its `.git/config` and
 * hooks are not trusted with the token: HEAD is first copied, with hooks off and only the allowlisted
 * environment, into a new repo the action made, and that repo pushes, with the token on its command
 * line only. Never a force push, so GitHub refuses a rewritten history.
 */
export function pushBranch(cwd: string, token: string, mode: string, target: PushTarget, url: string): void {
  const why = pushDenial(mode, target);
  if (why) throw new ShaftFailure('push_failed', why, DASHBOARD_URL);
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  core.setSecret(basic);
  const ref = `refs/heads/${target.branch}`;
  const clean = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'shaft-push-'));
  const git = (dir: string, args: string[], env?: Record<string, string>) => execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
  try {
    git(clean, ['init', '--quiet', '--bare']);
    git(clean, ['config', 'receive.shallowUpdate', 'true']); // a shallow checkout's HEAD
    git(cwd, ['-c', 'core.hooksPath=/dev/null', 'push', '--quiet', '--no-verify', clean, `HEAD:${ref}`], runnerEnv());
    git(clean, ['-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, 'push', '--quiet', '--no-verify', url, `${ref}:${ref}`]);
  } catch (e) {
    const out = (e as { stderr?: string }).stderr?.trim() || (e as Error).message;
    throw new ShaftFailure('push_failed', `The push to ${target.branch} failed: ${out}`);
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
}
