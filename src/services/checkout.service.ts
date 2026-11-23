import { execFileSync } from 'node:child_process';
import { globSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import * as core from '@actions/core';
import type { Checkout } from '../types/prestep.type';

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

/**
 * For `/resolve`: fetch the pull request's base branch, the whole history when the checkout is shallow
 * so git can find where the two branches split, and return its commit. Nothing from the PR runs, and
 * the token goes on the command line only, as in `checkoutHead`.
 */
export function fetchBase(cwd: string, branch: string, token: string): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  core.setSecret(basic);
  const deep = git('rev-parse', '--is-shallow-repository') === 'true' ? ['--unshallow'] : [];
  git('-c', `http.extraheader=AUTHORIZATION: basic ${basic}`, 'fetch', '--no-tags', ...deep, 'origin', `refs/heads/${branch}`);
  return git('rev-parse', 'FETCH_HEAD');
}

/** The biggest file a script reads, unless it asks for more (a lockfile can be several MB). */
const READ_MAX = 1_000_000;

/**
 * The checkout's files for the scripts. `find` never walks `node_modules` or `.git`; `read` returns
 * only a regular file inside the checkout, of up to 1 MB unless `max` says more, so a symlink a PR adds can't point a script
 * at a device or at a file elsewhere on the runner.
 */
export function checkoutFiles(cwd: string): Checkout {
  const root = realpathSync(cwd) + sep;
  return {
    find: (globs) => globSync(globs, { cwd, exclude: (p) => /(^|\/)(node_modules|\.git)$/.test(p) }),
    read: (path, max = READ_MAX) => {
      try {
        const full = join(cwd, path);
        const stat = lstatSync(full);
        return stat.isFile() && stat.size <= max && realpathSync(full).startsWith(root) ? readFileSync(full, 'utf8') : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Whether the checkout's `.git/config` holds a credential the model could read: an `extraheader` or a
 * credentials file from a checkout without `persist-credentials: false`, a credential helper, or a
 * password in a remote's URL.
 */
export function savedCredentials(cwd: string): boolean {
  try {
    return /extraheader|credential|:\/\/[^\s/@]*:[^\s/@]+@/i.test(readFileSync(join(cwd, '.git', 'config'), 'utf8'));
  } catch {
    return false;
  }
}
