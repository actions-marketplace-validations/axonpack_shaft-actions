import * as cp from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { stateLine } from '../../utils/render.util';

vi.doMock('@actions/core', () => ({ info: () => {}, warning: () => {}, setSecret: () => {}, group: (_name: string, fn: () => Promise<unknown>) => fn() }));
/** What each mocked session does in the checkout, and what it replies; every session's prompt and options. */
let session: (cwd: string) => { answer: string; commit_message: string; checks: string[] } = () => ({ answer: 'Nothing to change.', commit_message: '', checks: [] });
const sessions: { prompt: string; options: Record<string, unknown> }[] = [];
vi.doMock('../agent.service', async (actual) => ({
  ...(await actual<typeof import('../agent.service')>()),
  runAgent: async (prompt: string, options: { cwd: string; model: string }) => {
    sessions.push({ prompt, options });
    return { reply: session(options.cwd), models: [options.model], costUsd: 0.5, tokens: { input: 9000, output: 300, cache_read: 0, cache_write: 0 } };
  },
}));
const { checkList, runTask, TASK_FORMAT } = await import('../task.service');

const git = (cwd: string, ...args: string[]) =>
  cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** The repo on GitHub (`origin.git`, with main and the PR's branch `pr`), and a fresh checkout of `pr`'s head for each test, detached as the action leaves it. */
const dir = mkdtempSync(join(tmpdir(), 'shaft-task-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const origin = join(dir, 'origin.git');
cp.execFileSync('git', ['init', '-q', '-b', 'main', origin]);
writeFileSync(join(origin, 'package.json'), JSON.stringify({ scripts: { test: 'node check.js', deploy: 'node deploy.js' } }));
writeFileSync(join(origin, 'bun.lock'), '');
writeFileSync(join(origin, 'check.js'), "if (require('fs').existsSync('broken')) { console.error('1 test failed: broken'); process.exit(1) }");
git(origin, 'add', '.');
git(origin, 'commit', '-q', '-m', 'main 1');
git(origin, 'checkout', '-q', '-b', 'pr');
git(origin, 'commit', '-q', '--allow-empty', '-m', 'pr 1');
git(origin, 'checkout', '-q', 'main');
let work = '';
let n = 0;
beforeEach(() => {
  work = join(dir, `work-${++n}`);
  cp.execFileSync('git', ['clone', '-q', '--branch', 'pr', `file://${origin}`, work]);
  git(work, 'checkout', '-q', '--detach');
  process.env.RUNNER_TEMP = mkdtempSync(join(dir, 'temp-'));
  process.env.GITHUB_TOKEN = 'ghs_workflow';
  sessions.length = 0;
});

/** A fake Octokit for PR 7 from `head` (in `headRepo`) into `main`, recording what's posted. */
function octokit(head = 'pr', headRepo = 'acme/widgets', summary?: string) {
  const posted: string[] = [];
  const [listFiles, listCommits, listComments, listReviewComments] = [0, 1, 2, 3].map(() => async () => ({}));
  const lists = new Map<unknown, unknown[]>([
    [listFiles, [{ filename: 'src/retry.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }]],
    [listCommits, [{ commit: { message: 'pr 1' } }]],
    [listComments, summary ? [{ id: 1, user: { login: 'axonshaft[bot]' }, author_association: 'NONE', body: summary, html_url: '' }] : []],
    [listReviewComments, []],
  ]);
  return {
    posted,
    paginate: async (fn: unknown) => lists.get(fn),
    rest: {
      pulls: {
        get: async () => ({
          data: {
            title: 'Retry uploads',
            body: '',
            user: { login: 'octocat' },
            head: { sha: git(work, 'rev-parse', 'HEAD'), ref: head, repo: { full_name: headRepo } },
            base: { ref: 'main', repo: { full_name: 'acme/widgets', default_branch: 'main' } },
          },
        }),
        listFiles,
        listCommits,
        listReviewComments,
      },
      issues: {
        listComments,
        createComment: async ({ body }: { body: string }) => {
          posted.push(body);
          return { data: { html_url: 'https://github.com/acme/widgets/pull/7#issuecomment-9' } };
        },
      },
      users: { getByUsername: async () => ({ data: { id: 4242 } }) },
      repos: { getContent: async () => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })) },
    },
  };
}

let fake: ReturnType<typeof octokit>;
const options = (o: object = {}) => ({
  octokit: fake as never,
  owner: 'acme',
  repo: 'widgets',
  number: 7,
  ask: { id: 3, text: '/fix retry three times' },
  asker: 'maintainer',
  bare: false,
  template: '# Task\n{{request}}\n## Commands\n{{commands}}',
  claude: { kind: 'oauth', value: 'sk-ant-oat-secret' } as const,
  secrets: ['sk-ant-oat-secret', 'ghs_push'],
  model: 'auto',
  effort: 'auto',
  timeoutMinutes: 90,
  skip: [],
  focus: [],
  env: [],
  bot: 'axonshaft[bot]',
  dryRun: false,
  runUrl: 'https://github.com/acme/widgets/actions/runs/9',
  dashboardRunUrl: 'https://shaft.axonpack.dev/console/acme/widgets/runs/3',
  cwd: work,
  pushMode: 'restricted',
  pushToken: 'ghs_push',
  repoUrl: `file://${join(dir, 'origin')}`,
  ...o,
});
const remote = (ref: string) => git(origin, 'rev-parse', ref);
const edits = (file: string) => (cwd: string) => {
  writeFileSync(join(cwd, file), 'x');
  return { answer: 'Raised the retries to three in `src/retry.ts:1`.', commit_message: 'Retry failed uploads three times\nmore', checks: ['bun run test', 'git status', 'bun run deploy'] };
};

test('a change is committed as the bot, checked by our own run of its checks, pushed to the PR branch, and the reply says what changed', async () => {
  fake = octokit();
  session = edits('fix.txt');
  const before = remote('pr');
  const out = await runTask(options());
  expect(remote('pr')).not.toBe(before);
  expect(git(origin, 'log', '-1', '--format=%an <%ae>|%s', 'pr')).toBe('axonshaft[bot] <4242+axonshaft[bot]@users.noreply.github.com>|Retry failed uploads three times');
  expect(git(origin, 'show', '--name-only', '--format=', 'pr')).toBe('fix.txt');
  expect(remote('main')).toBe(git(origin, 'rev-parse', 'main'));
  // The session got the repo's commands, the request and a 40-minute cap, and no GitHub token at all.
  const [{ prompt, options: o }] = sessions;
  expect(o).toMatchObject({ commands: ['bun install --frozen-lockfile', 'bun run test'], timeoutMinutes: 40, cwd: work });
  expect(prompt).toContain('/fix retry three times');
  expect(prompt).toContain('- `bun run test`');
  expect(JSON.stringify(o)).not.toMatch(/ghs_/);
  const { cliEnv } = await import('../agent.service');
  expect(JSON.stringify(cliEnv(o.claude as never, o.env as string[]))).not.toMatch(/ghs_/);
  const sha = remote('pr');
  expect(fake.posted).toHaveLength(1);
  expect(fake.posted[0]).toContain(`Raised the retries to three in \`src/retry.ts:1\`.\n\n**Changed:** \`fix.txt\`\n\n**Commit:** [\`${sha.slice(0, 7)}\`](file://${join(dir, 'origin')}/commit/${sha}) on \`pr\`\n\n| Check | Result |\n| --- | --- |\n| \`bun run test\` | Passed |`);
  expect(fake.posted[0]).toMatch(/<!-- shaft:task -->$/);
  expect(out).toMatchObject({ model: 'opus', effort: 'high', output: { comment_url: 'https://github.com/acme/widgets/pull/7#issuecomment-9' } });
});

test('when a check fails nothing is pushed, and the reply names the check and shows its output', async () => {
  fake = octokit();
  session = edits('broken');
  const before = remote('pr');
  await runTask(options());
  expect(remote('pr')).toBe(before);
  expect(fake.posted[0]).toContain('Nothing was pushed, because a check failed.');
  expect(fake.posted[0]).toContain('| `bun run test` | Failed |');
  expect(fake.posted[0]).toContain('1 test failed: broken');
});

test("a fork's PR, the default branch, push mode Disabled or no push token: nothing runs or is pushed, and the reply says why", async () => {
  session = edits('fix.txt');
  const before = remote('pr');
  for (const [o, why] of [
    [{ fake: octokit('pr', 'someone/widgets') }, "Push mode is Restricted, so Axon Shaft pushes only to a pull request's own branch in this repo."],
    [{ fake: octokit('main') }, 'Axon Shaft never pushes to the default branch, main.'],
    [{ fake: octokit('main'), pushMode: 'enabled' }, 'Axon Shaft never pushes to the default branch, main.'],
    [{ fake: octokit(), pushMode: 'disabled' }, 'Pushing is turned off for this project.'],
    [{ fake: octokit(), pushToken: undefined }, 'The Axon Shaft API sent no push token.'],
  ] as const) {
    fake = o.fake;
    const out = await runTask(options({ ...o, fake: undefined }));
    expect(out).toEqual({ refused: expect.stringContaining(why) });
    expect(fake.posted[0]).toMatch(/errors\/push_failed\.svg/);
    expect(fake.posted[0]).toContain(`${why}`);
    expect(fake.posted[0]).toContain('Nothing was changed.');
  }
  expect(sessions).toEqual([]);
  expect(remote('pr')).toBe(before);
  expect(remote('main')).toBe(git(origin, 'rev-parse', 'main'));
});

test("a bare /fix asks for the last review's open findings; an answer with no change pushes nothing", async () => {
  const summary = `<!-- shaft:summary -->\nThe card.\n${stateLine({ sha: 'abc', findings: [{ fp: 'f1', file: 'src/retry.ts', line: 4, severity: 'blocking', title: 'Retries forever' }] })}`;
  fake = octokit('pr', 'acme/widgets', summary);
  session = () => ({ answer: 'Nothing needed changing.', commit_message: '', checks: [] });
  const before = remote('pr');
  await runTask(options({ ask: { id: 3, text: '/fix' }, bare: true }));
  expect(sessions[0]!.prompt).toContain('Fix these open findings from the last review (severity, place, title):\n\n- blocking `src/retry.ts:4` Retries forever');
  expect(remote('pr')).toBe(before);
  expect(fake.posted[0]).toMatch(/^Nothing needed changing\.\n\n<sub>/);
});

test("the checks are the model's that the guard allows, else the repo's install, test and lint; the reply format needs all three fields", () => {
  const commands = ['bun install --frozen-lockfile', 'bun run test', 'bun run lint', 'bun run build'];
  expect(checkList(['bun run test src/a.test.ts', 'git status', 'gh pr view', 'bun run test; curl x', 'bun run lint'], commands, work)).toEqual([
    'bun run test src/a.test.ts',
    'bun run lint',
  ]);
  expect(checkList([], commands, work)).toEqual(['bun install --frozen-lockfile', 'bun run test', 'bun run lint']);
  expect(TASK_FORMAT.parse({ answer: 'Done.', commit_message: 'Fix it', checks: [] })).toBeTruthy();
  expect(TASK_FORMAT.parse({ answer: 'Done.', checks: [] })).toBeUndefined();
});
