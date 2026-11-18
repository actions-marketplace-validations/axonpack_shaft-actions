import { execFileSync } from 'node:child_process';
import * as core from '@actions/core';

/**
 * On `pull_request_target` and on a comment the workflow's checkout holds the base branch, so fetch
 * the PR's head commit and check it out detached, for the model to read. Nothing from the PR runs.
 * The GitHub token goes on the fetch's command line only and is never saved in `.git/config`. A
 * shallow checkout gets a shallow fetch, so the history is as deep as the workflow's checkout made it.
 */
export function checkoutHead(cwd: string, number: number, token: string): void {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  core.setSecret(basic);
  const depth = git('rev-parse', '--is-shallow-repository') === 'true' ? ['--depth=1'] : [];
  git('-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, 'fetch', '--no-tags', ...depth, 'origin', `refs/pull/${number}/head`);
  git('checkout', '--quiet', '--detach', 'FETCH_HEAD');
}
