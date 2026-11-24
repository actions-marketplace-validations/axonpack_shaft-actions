import { beforeEach, expect, test, vi } from 'vitest';
import { parseState, type State, stateLine } from '../../utils/render.util';

vi.doMock('@actions/core', () => ({ info: () => {}, warning: () => {}, saveState: () => {} }));
let summary: { id: number; body: string } | undefined;
vi.doMock('../context.service', () => ({ collectContext: async () => ({ owner: 'o', repo: 'r', pr: { number: 7 }, summary, reviewComments: [] }) }));
const { checksAfter, dismissFinding, threadDismissals } = await import('../dismiss.service');

const BOT = 'axonshaft[bot]';
const a = { fp: 'aaa111', file: 'src/a.ts', line: 3, severity: 'blocking' as const, title: 'Wrong sum', step: 'correctness' };
const b = { fp: 'bbb222', file: 'src/a.ts', line: 9, severity: 'should-fix' as const, title: 'Slow', step: 'correctness' };
const state: State = { sha: 'abc1234def', findings: [a, b] };

test('a thread resolved by someone with write access dismisses its finding; reopened, it comes back; the bot and others count for nothing', async () => {
  const canWrite = async (login: string) => login === 'maintainer';
  const resolved = (fp: string, by: string) => ({ id: fp, resolved: true, resolvedBy: by, fp });
  const out = await threadDismissals(state, [resolved('aaa111', 'maintainer'), resolved('bbb222', 'author')], BOT, canWrite);
  expect(out.dismissed).toEqual([{ ...a, by: 'maintainer', reason: '' }]);
  expect(out.findings).toEqual([b]);
  expect(await threadDismissals(state, [resolved('aaa111', BOT)], BOT, canWrite)).toEqual(state);
  const back = await threadDismissals(out, [{ id: 't', resolved: false, fp: 'aaa111' }], BOT, canWrite);
  expect(back.dismissed).toEqual([]);
  expect(back.findings).toEqual([b, a]);
});

test("a check's state comes from the findings left open in it", () => {
  expect(checksAfter(state, ['correctness'])).toEqual([{ key: 'correctness', state: 'failed' }]);
  expect(checksAfter({ ...state, findings: [b] }, ['correctness', 'correctness'])).toEqual([{ key: 'correctness', state: 'warned' }]);
  expect(checksAfter({ ...state, findings: [] }, ['correctness'])).toEqual([{ key: 'correctness', state: 'passed', reason: 'Every finding here was dismissed' }]);
});

/** A GitHub that answers with the threads given and keeps what the dismissal posts. */
function github(threads: object[]) {
  const calls: { what: string; args: any }[] = [];
  const octokit = {
    graphql: async (query: string, args: object) => {
      if (query.startsWith('mutation')) return calls.push({ what: /\{(\w+)\(/.exec(query)![1]!, args });
      return { repository: { pullRequest: { reviewThreads: { nodes: threads } } } };
    },
    rest: {
      issues: { updateComment: async (args: object) => calls.push({ what: 'updateComment', args }) },
      pulls: {
        createReplyForReviewComment: async (args: object) => {
          calls.push({ what: 'reply', args });
          return { data: { html_url: 'u' } };
        },
      },
      checks: {
        create: async (args: object) => {
          calls.push({ what: 'check', args });
          return { data: { id: 1 } };
        },
      },
    },
  };
  return { octokit: octokit as any, calls };
}
const thread = (author: string, body: string, isResolved = false) => ({
  id: 'T1',
  isResolved,
  resolvedBy: null,
  comments: { nodes: [{ databaseId: 600, body, author: { __typename: 'Bot', login: author } }] },
});
const opts = (octokit: any, undo = false) => ({ octokit, owner: 'o', repo: 'r', number: 7, ask: { id: 601, text: '/dismiss', thread: 600 }, actor: 'maintainer', undo, reason: 'fine here', bot: BOT, dryRun: false, secrets: [] });

beforeEach(() => {
  summary = { id: 55, body: `<!-- shaft:summary -->\ncard\n${stateLine(state)}` };
});

test("/dismiss resolves the thread, rewrites the summary's state and section, and posts the finding's check again from what's left", async () => {
  const { octokit, calls } = github([thread('axonshaft', '**Blocking** · correctness\n\nx\n\n<!-- shaft:finding aaa111 -->')]);
  expect(await dismissFinding(opts(octokit))).toEqual({ done: true, message: 'maintainer dismissed aaa111.' });
  expect(calls.map((c) => c.what)).toEqual(['resolveReviewThread', 'updateComment', 'check']);
  const body = calls[1]!.args.body as string;
  expect(body).toContain('| 🔴 | `src/a.ts:3` | Wrong sum | maintainer | fine here |');
  expect(parseState(body)).toEqual({ ...state, findings: [b], dismissed: [{ ...a, by: 'maintainer', reason: 'fine here' }] });
  expect(calls[2]!.args).toMatchObject({ name: 'Axon Shaft / correctness', head_sha: 'abc1234def', conclusion: 'neutral' });

  // /undismiss brings it back and reopens the thread.
  summary = { id: 55, body };
  const again = github([thread('axonshaft', '<!-- shaft:finding aaa111 -->', true)]);
  expect(await dismissFinding(opts(again.octokit, true))).toEqual({ done: true, message: 'maintainer brought back aaa111.' });
  expect(again.calls.map((c) => c.what)).toEqual(['unresolveReviewThread', 'updateComment', 'check']);
  expect(parseState(again.calls[1]!.args.body)?.dismissed).toEqual([]);
  expect(again.calls[2]!.args).toMatchObject({ conclusion: 'failure' });
});

test("a thread someone else started with our marker, or a finding not in our state, changes nothing and gets a reply", async () => {
  for (const t of [thread('stranger', '<!-- shaft:finding aaa111 -->'), thread('axonshaft', '<!-- shaft:finding zzz999 -->')]) {
    const { octokit, calls } = github([t]);
    expect((await dismissFinding(opts(octokit))).done).toBe(false);
    expect(calls.map((c) => c.what)).toEqual(['reply']);
  }
  const { octokit, calls } = github([thread('axonshaft', '<!-- shaft:finding aaa111 -->')]);
  expect(await dismissFinding(opts(octokit, true))).toEqual({ done: false, message: "This finding isn't dismissed, so nothing changed." });
  expect(calls.map((c) => c.what)).toEqual(['reply']);
});
