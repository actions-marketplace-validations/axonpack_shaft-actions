import * as core from '@actions/core';
import type { Octokit } from '../types/octokit.type';
import { setDismissal, withDismissed } from '../utils/dismiss.util';
import { type CheckState, parseState, type Placed, redact, type State } from '../utils/render.util';
import { postCategoryChecks } from './check-runs.service';
import { type Context, collectContext } from './context.service';
import { postInThread } from './reply.service';
import type { Ask } from './route.service';

/** A review thread on the pull request; `fp` only when `bot` started it with a finding's marker. */
export type Thread = { id: string; comment?: number; resolved: boolean; resolvedBy?: string; fp?: string };

/** GraphQL names a bot without the `[bot]` that REST adds. */
const loginOf = (a: { __typename: string; login: string } | null | undefined) => a && (a.__typename === 'Bot' ? `${a.login}[bot]` : a.login);

/**
 * The pull request's review threads. A thread's `fp` is read only from a first comment `bot` wrote,
 * by the marker at its end, the same rule as `unposted`: anyone else's copy of the marker counts for nothing.
 */
export async function reviewThreads(octokit: Octokit, ctx: Pick<Context, 'owner' | 'repo'> & { pr: { number: number } }, bot: string): Promise<Thread[]> {
  // ponytail: the first 100 threads; page through them if a PR ever has more
  const data: any = await octokit.graphql(
    'query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved resolvedBy{__typename login} comments(first:1){nodes{databaseId body author{__typename login}}}}}}}}',
    { owner: ctx.owner, repo: ctx.repo, n: ctx.pr.number },
  );
  return data.repository.pullRequest.reviewThreads.nodes.map((t: any): Thread => {
    const first = t.comments.nodes[0];
    const fp = loginOf(first?.author) === bot ? /<!-- shaft:finding (\w+) -->\s*$/.exec(first.body ?? '')?.[1] : undefined;
    return { id: t.id, comment: first?.databaseId, resolved: t.isResolved, resolvedBy: loginOf(t.resolvedBy) ?? undefined, ...(fp && { fp }) };
  });
}

const setResolved = (octokit: Octokit, id: string, resolved: boolean) =>
  octokit.graphql(`mutation($id:ID!){${resolved ? 'resolveReviewThread' : 'unresolveReviewThread'}(input:{threadId:$id}){thread{id}}}`, { id });

/**
 * The dismissals once the threads are read: a dismissed finding whose thread is open again comes
 * back, and an open finding whose thread someone with write access resolved (not `bot`, which
 * resolves fixed ones) is dismissed by them, with no reason.
 */
export async function threadDismissals(state: State, threads: Thread[], bot: string, canWrite: (login: string) => Promise<boolean>): Promise<State> {
  let next = state;
  for (const t of threads) {
    if (!t.fp) continue;
    if (!t.resolved && next.dismissed?.some((d) => d.fp === t.fp)) next = setDismissal(next, t.fp) ?? next;
    else if (t.resolved && t.resolvedBy && t.resolvedBy !== bot && next.findings.some((f) => f.fp === t.fp) && (await canWrite(t.resolvedBy)))
      next = setDismissal(next, t.fp, t.resolvedBy) ?? next;
  }
  return next;
}

/** Each check whose findings changed, from what's left open: a blocking finding fails it, any other is neutral, none passes. */
export function checksAfter(state: State, steps: string[]): { key: string; state: CheckState; reason?: string }[] {
  return [...new Set(steps)].map((key) => {
    const left = state.findings.filter((f) => f.step === key);
    return left.some((f) => f.severity === 'blocking')
      ? { key, state: 'failed' }
      : left.length
        ? { key, state: 'warned' }
        : { key, state: 'passed', reason: 'Every finding here was dismissed' };
  });
}

export type DismissOptions = {
  octokit: Octokit;
  owner: string;
  repo: string;
  number: number;
  ask: Ask;
  actor: string;
  /** `/undismiss`: bring the finding back. */
  undo: boolean;
  reason: string;
  bot: string;
  dryRun: boolean;
  secrets: string[];
};

/**
 * `/dismiss` or `/undismiss` in a finding's thread, with no model: the finding moves in or out of the
 * summary's state, the thread is resolved or reopened, and the summary's dismissed section and the
 * checks the finding counted in are posted again. Only a thread our bot started, for a finding in our own
 * summary's state, counts. Returns what to log, and whether it changed anything.
 */
export async function dismissFinding(o: DismissOptions): Promise<{ done: boolean; message: string }> {
  const ctx = await collectContext(o.octokit, o.owner, o.repo, o.number, o.bot);
  const state = parseState(ctx.summary?.body);
  const thread = (await reviewThreads(o.octokit, ctx, o.bot)).find((t) => t.comment === o.ask.thread);
  const next = state && thread?.fp ? setDismissal(state, thread.fp, o.undo ? undefined : o.actor, o.reason) : undefined;
  const refuse = async (message: string) => {
    await postInThread(o, message);
    return { done: false, message };
  };
  if (!state || !thread?.fp || !ctx.summary) return refuse("This thread isn't an Axon Shaft finding from the last review, so nothing changed.");
  if (!next) return refuse(o.undo ? "This finding isn't dismissed, so nothing changed." : "This finding is already dismissed, or the last review didn't keep it, so nothing changed.");

  const finding = [...next.findings, ...(next.dismissed ?? [])].find((f) => f.fp === thread.fp)!;
  const message = o.undo ? `${o.actor} brought back ${finding.fp}.` : `${o.actor} dismissed ${finding.fp}.`;
  const body = redact(withDismissed(ctx.summary.body, next), o.secrets);
  if (o.dryRun) {
    core.info(`--- summary comment\n${body}`);
    return { done: true, message };
  }
  // First, since the next review reads an open thread as a finding brought back.
  const moved = await setResolved(o.octokit, thread.id, !o.undo).then(
    () => true,
    (e: Error) => core.warning(`Couldn't ${o.undo ? 'reopen' : 'resolve'} the thread: ${e.message}`),
  );
  if (!moved) return refuse(`Axon Shaft couldn't ${o.undo ? 'reopen' : 'resolve'} this thread, so nothing changed.`);
  await o.octokit.rest.issues.updateComment({ owner: o.owner, repo: o.repo, comment_id: ctx.summary.id, body });
  if (finding.step) {
    const placed = next.findings.map((f): Placed => ({ ...f, step: f.step ?? '', body: '', inline: true }));
    await postCategoryChecks(o.octokit, o.owner, o.repo, next.sha, checksAfter(next, [finding.step]), placed, (s) => redact(s, o.secrets));
  }
  return { done: true, message };
}
