import * as core from '@actions/core';
import { type Choice, matches, pick } from '../utils/auto-pick.util';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { GUIDE_CAP } from '../consts/settings.const';
import type { Octokit } from '../types/octokit.type';
import type { ClaudeToken, GrantJob, RunOutput } from './api.service';
import { REVIEW_FORMAT, runAgent, type Tokens } from './agent.service';
import { type Context, collectContext } from './context.service';
import {
  CATEGORY_CONCLUSION,
  categoryCheck,
  gateResults,
  GATES_CHECK,
  gatesConclusion,
  postCategoryChecks,
  postCheck,
  postGatesCheck,
  progressSummary,
  REVIEW_CHECK,
  type ReviewStep,
} from './check-runs.service';
import { step } from './step.service';
import {
  checkStates,
  failedSummary,
  inlineBody,
  parseState,
  place,
  redact,
  renderSummary,
  type State,
  startSummary,
  unposted,
} from '../utils/render.util';
import { diffText, fillSlots, trustedComments } from '../utils/prompt.util';

export type ReviewOptions = {
  /** Unused on a dry run with a context built by hand. */
  octokit: Octokit;
  claude: ClaudeToken;
  /** Values that must never reach GitHub. */
  secrets: string[];
  model: string;
  effort: string;
  depth: string;
  nits: string;
  /** From the dashboard; unset picks one from the diff's size. */
  maxTurns?: number;
  timeoutMinutes: number;
  /** Globs from the dashboard: changed files to leave out of the review, and to mark for a closer look. */
  skip: string[];
  focus: string[];
  /** The login our comments come from. Only its markers are read back. */
  bot: string;
  /** The review prompt from the dashboard: the template to fill, and the deep review's passes. */
  prompt: GrantJob['prompt'];
  /** The catalog checks the project keeps on; the others show as turned off on the card. */
  checks: string[];
  dryRun: boolean;
  runUrl?: string;
  /** The run's page on the dashboard, when the API sends it. */
  dashboardRunUrl?: string;
  cwd: string;
  /** The project's own variables the agent's commands get, by name. */
  env?: string[];
  /** The project's merge gates: with any, the summary reports each and the gates check is posted. */
  gates?: string[];
};

export type ReviewOutcome = {
  verdict: string;
  findings: number;
  summaryUrl: string;
  /** For the run history on the dashboard. */
  model: string;
  effort: string;
  bySeverity: { blocking: number; should_fix: number; nit: number };
  tokens: Tokens;
  /** The SDK's price for the run, in US dollars. */
  costUsd: number;
  /** The card, for the run's page on the dashboard. */
  output: RunOutput;
};

/** One step down when the plan behind the token can't use the picked model. */
export const FALLBACK: Record<string, string> = { opus: 'sonnet,haiku', sonnet: 'haiku' };

/**
 * The models the action chose, named as the run reported them (an alias such as `sonnet` becomes
 * its full ID): the review's, or the fallback the plan allowed, then the subagents' on a deep
 * review. Models the CLI used for its own housekeeping aren't listed.
 */
export function chosenModels(used: string[], choice: Choice, deep: boolean): { main: string; fellBack: boolean; subagents: string[] } {
  const named = (want: string) => used.find((m) => m === want || m.includes(want));
  const fallbacks = choice.autoModel ? (FALLBACK[choice.model]?.split(',') ?? []) : [];
  const picked = named(choice.model);
  const main = picked ?? fallbacks.map(named).find(Boolean) ?? choice.model;
  const subagents = deep && choice.subagentModel ? [named(choice.subagentModel) ?? choice.subagentModel] : [];
  return { main, fellBack: !picked && fallbacks.length > 0, subagents };
}

/** The guides as prompt text: each cut at `GUIDE_CAP.file`, and all of them at `GUIDE_CAP.total`. */
export function guidesText(guides: Context['guides']): string {
  let left = GUIDE_CAP.total;
  return guides
    .map(({ path, text }) => {
      const room = Math.min(GUIDE_CAP.file, left);
      if (room <= 0) return `<guide path="${path}">\n(left out: the guides reached ${GUIDE_CAP.total.toLocaleString('en')} characters)\n</guide>`;
      left -= Math.min(text.length, room);
      const cut = text.length > room ? `\n(cut here: ${text.length.toLocaleString('en')} characters, the first ${room.toLocaleString('en')} shown)` : '';
      return `<guide path="${path}">\n${text.slice(0, room)}${cut}\n</guide>`;
    })
    .join('\n\n');
}

/**
 * The prompt: the dashboard's template with each `{{slot}}` filled with the run's data, and nothing
 * else changed. An empty value reads `None.`. `ctx.files` is the diff after `skip`; `skipped` is
 * how many files that left out.
 */
export function buildPrompt(ctx: Context, prior: State | undefined, o: { template: string; focus: string[]; skipped: number }): string {
  const { pr } = ctx;
  const previous = prior?.findings.length
    ? `Findings from the review of \`${prior.sha.slice(0, 7)}\` (fingerprint, severity, place, title):\n\n${prior.findings
        .map((f) => `- ${f.fp} ${f.severity} \`${f.file}:${f.line}\` ${f.title}`)
        .join('\n')}`
    : '';
  return fillSlots(o.template, {
    repo: `${ctx.owner}/${ctx.repo}`,
    number: pr.number,
    head: pr.head,
    base: pr.base,
    sha: pr.headSha,
    skipped: o.skipped,
    guides: guidesText(ctx.guides),
    previous,
    title: pr.title,
    author: pr.author,
    body: pr.body,
    commits: ctx.commits.map((m) => `- ${m}`).join('\n'),
    comments: trustedComments([...ctx.comments, ...ctx.reviewComments]),
    diff: diffText(ctx.files, o.focus),
  });
}

/**
 * Resolve the threads of fixed findings. Only a thread `bot` started counts, by the marker at the
 * end of its first comment, the same rule as `unposted`: anyone else's thread with our marker in it
 * stays open.
 */
export async function resolveThreads(octokit: Octokit, ctx: Context, fps: string[], bot: string): Promise<void> {
  // ponytail: the first 100 threads; page through them if a PR ever has more
  const data: any = await octokit.graphql(
    'query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved comments(first:1){nodes{body author{__typename login}}}}}}}}',
    { owner: ctx.owner, repo: ctx.repo, n: ctx.pr.number },
  );
  for (const t of data.repository.pullRequest.reviewThreads.nodes) {
    const first = t.comments.nodes[0];
    // GraphQL names a bot without the `[bot]` that REST adds.
    const author = first?.author && (first.author.__typename === 'Bot' ? `${first.author.login}[bot]` : first.author.login);
    const fp = author === bot ? /<!-- shaft:finding (\w+) -->\s*$/.exec(first.body ?? '')?.[1] : undefined;
    if (!t.isResolved && fp && fps.includes(fp)) {
      await octokit.graphql('mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}', { id: t.id });
    }
  }
}

export async function reviewPullRequest(o: ReviewOptions & { owner: string; repo: string; number: number }): Promise<ReviewOutcome> {
  return reviewContext(await step('Read the pull request', () => collectContext(o.octokit, o.owner, o.repo, o.number, o.bot)), o);
}

/**
 * Review a collected PR and post the result (or print it, on a dry run). Progress shows only in ways
 * that email no one: the `Axon Shaft / review` check run, in progress until the result, with its
 * title and summary updated once at the start of each step.
 */
export async function reviewContext(ctx: Context, o: ReviewOptions): Promise<ReviewOutcome> {
  const { octokit } = o;
  const { owner, repo } = ctx;
  const sha = ctx.pr.headSha;
  const clean = (text: string) => redact(text, o.secrets);
  let check: number | undefined;
  if (o.dryRun) core.info(`Would start the ${REVIEW_CHECK} check`);
  else {
    const started = { name: REVIEW_CHECK, title: `Reviewing ${sha.slice(0, 7)}`, summary: 'The review is running.', detailsUrl: o.runUrl };
    check = await postCheck(octokit, owner, repo, sha, started, clean);
  }
  const startedAt = Date.now();
  let live = true;
  // One update per step, never on a timer. After a refused update (which postCheck warns about) the rest are skipped.
  const progress = async (now: ReviewStep, title: string) => {
    if (o.dryRun) return core.info(`Would update the ${REVIEW_CHECK} check: ${title}`);
    if (!check || !live) return;
    live = (await postCheck(octokit, owner, repo, sha, { name: REVIEW_CHECK, id: check, title, summary: progressSummary(now, Date.now() - startedAt) }, clean)) !== undefined;
  };
  const finish = async (c: { conclusion: 'success' | 'failure'; title: string; summary: string; detailsUrl?: string }) => {
    if (check) await postCheck(octokit, owner, repo, sha, { name: REVIEW_CHECK, id: check, ...c }, clean);
  };
  try {
    // A token that refused the review check would refuse the others too, so they're skipped and the log warns once.
    const out = await postReview(ctx, o, o.dryRun || check !== undefined, progress);
    await finish({ conclusion: 'success', title: `Reviewed ${sha.slice(0, 7)}`, summary: `${out.output.headline}\n\n[The summary comment](${out.summaryUrl})`, detailsUrl: out.summaryUrl });
    return out;
  } catch (e) {
    const failure = e instanceof ShaftFailure ? e : new ShaftFailure('review_failed', e instanceof Error ? e.message : String(e), o.runUrl);
    await finish({ conclusion: 'failure', title: 'The review failed', summary: failureMarkdown(failure), detailsUrl: failure.url ?? o.runUrl });
    throw e;
  }
}

async function postReview(
  ctx: Context,
  o: ReviewOptions,
  canCheck: boolean,
  progress: (now: ReviewStep, title: string) => Promise<void>,
): Promise<ReviewOutcome> {
  const { octokit } = o;
  const sha = ctx.pr.headSha;
  const clean = (text: string) => redact(text, o.secrets);
  const prior = parseState(ctx.summary?.body);
  const files = ctx.files.filter((f) => !matches(f.filename, o.skip));
  const skipped = ctx.files.length - files.length;
  const choice = pick({ mode: 'review', depth: o.depth, files, focus: o.focus, model: o.model, effort: o.effort, maxTurns: o.maxTurns });
  const { passes } = o.prompt;
  core.info(`Reviewing ${sha.slice(0, 7)} with ${choice.model}, effort ${choice.effort} (${choice.reason})`);

  let summary = ctx.summary && { id: ctx.summary.id, html_url: ctx.summary.html_url };
  const writeSummary = async (body: string) => {
    if (o.dryRun) return;
    const req = { owner: ctx.owner, repo: ctx.repo, body: clean(body) };
    const { data } = summary
      ? await octokit.rest.issues.updateComment({ ...req, comment_id: summary.id })
      : await octokit.rest.issues.createComment({ ...req, issue_number: ctx.pr.number });
    summary = { id: data.id, html_url: data.html_url };
  };

  // Only an edit: a new comment emails everyone on the PR, so the first review's comment waits for the result.
  if (summary) await writeSummary(startSummary(sha, prior));
  // An alias reads as a name (`sonnet` as Sonnet); a full model ID stays as written.
  const model = /^[a-z]+$/.test(choice.model) ? choice.model[0]!.toUpperCase() + choice.model.slice(1) : choice.model;
  await progress('Review', `Reviewing with ${model}, effort ${choice.effort}`);
  let result;
  try {
    result = await step('Review', () =>
      runAgent(buildPrompt({ ...ctx, files }, prior, { template: o.prompt.template, focus: o.focus, skipped }), {
      claude: o.claude,
      model: choice.model,
      effort: choice.effort,
      fallbackModel: choice.autoModel ? FALLBACK[choice.model] : undefined,
      subagentModel: choice.subagentModel,
      passes,
      maxTurns: choice.maxTurns,
      timeoutMinutes: o.timeoutMinutes,
      cwd: o.cwd,
      env: o.env,
    }, REVIEW_FORMAT),
    );
  } catch (e) {
    // runAgent's failures are all review_* ones; the PR shows the same card as the job summary.
    if (e instanceof ShaftFailure) {
      e.url ??= o.runUrl;
      await writeSummary(failedSummary(e, prior));
    }
    throw e;
  }
  // Only the project's own gates, each with the review's result; any other gates in the reply are dropped.
  const gates = o.gates?.length ? gateResults(o.gates, result.reply.gates) : undefined;
  const review = { ...result.reply, gates };
  core.info(`Models used ${result.models.join(', ')}, about $${result.costUsd.toFixed(2)}`);
  await progress('Post the review', 'Posting the review');
  core.startGroup('Post the review');

  const placed = place(review.findings, files, o.nits);
  const fresh = unposted(placed, ctx.reviewComments, o.bot);
  const comments = fresh.map((p) => {
    const end = Math.max(p.end_line ?? p.line, p.line);
    return {
      path: p.file,
      line: end,
      side: 'RIGHT' as const,
      ...(end > p.line ? { start_line: p.line, start_side: 'RIGHT' as const } : {}),
      body: clean(inlineBody(p)),
    };
  });
  if (o.dryRun) {
    for (const c of comments) core.info(`--- inline comment on ${c.path}:${c.line}\n${c.body}`);
  } else if (comments.length) {
    try {
      await octokit.rest.pulls.createReview({
        owner: ctx.owner,
        repo: ctx.repo,
        pull_number: ctx.pr.number,
        commit_id: sha,
        event: 'COMMENT',
        body: `Axon Shaft left ${comments.length} new comment${comments.length === 1 ? '' : 's'} on \`${sha.slice(0, 7)}\`. The summary is in the PR conversation.`,
        comments,
      });
    } catch (e) {
      core.warning(`Posting the inline comments failed, so they go in the summary: ${(e as Error).message}`);
      for (const p of fresh) p.inline = false;
    }
  }

  const models = chosenModels(result.models, choice, !!choice.subagentModel && passes.length > 0);
  const body = renderSummary(review, placed, prior, {
    sha,
    repo: `${ctx.owner}/${ctx.repo}`,
    checks: o.checks,
    runUrl: o.runUrl,
    dashboardRunUrl: o.dashboardRunUrl,
    models:
      models.main +
      (models.fellBack ? ` (${choice.model} unavailable)` : '') +
      (models.subagents.length ? ` · subagents: ${models.subagents.join(', ')}` : ''),
    effort: choice.effort,
    reason: choice.reason,
    tokens: result.tokens,
    // On a subscription the SDK's price is only an estimate, so the footer weighs the tokens instead.
    costUsd: o.claude.kind === 'api_key' ? result.costUsd : undefined,
    skipped,
  });
  if (o.dryRun) core.info(`--- summary comment\n${clean(body)}`);
  else await writeSummary(body);

  if (gates && o.dryRun) core.info(`Would post the ${GATES_CHECK} check: ${gatesConclusion(gates)}`);
  else if (gates && canCheck) await postGatesCheck(octokit, ctx.owner, ctx.repo, sha, gates, clean);

  const states = checkStates(review, placed, o.checks);
  if (o.dryRun) {
    for (const c of states) if (CATEGORY_CONCLUSION[c.state]) core.info(`Would post the ${categoryCheck(c.key)} check: ${CATEGORY_CONCLUSION[c.state]}`);
  } else if (canCheck) await postCategoryChecks(octokit, ctx.owner, ctx.repo, sha, states, placed, clean);

  const fixed = prior?.findings.filter((p) => review.resolved.includes(p.fp)).map((p) => p.fp) ?? [];
  if (fixed.length && o.dryRun) core.info(`Would resolve the threads of ${fixed.join(', ')}`);
  else if (fixed.length) {
    await resolveThreads(octokit, ctx, fixed, o.bot).catch((e) => core.warning(`Resolving fixed threads failed: ${e.message}`));
  }

  core.endGroup();

  // Cut to the API's limits, so one long finding never loses the whole report.
  const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const prose = (text: string) => cut(clean(text), 2000);
  const output: RunOutput = {
    headline: prose(review.headline),
    claim: prose(review.claim),
    impact: prose(review.impact),
    scope: prose(review.scope),
    not_checked: prose(review.not_checked),
    type: cut(review.type, 40),
    confidence: Math.min(100, Math.max(0, Math.round(review.confidence))),
    comment_url: o.dryRun ? '' : (summary?.html_url ?? ''),
    checks: states,
    findings: placed.slice(0, 200).map((p) => ({
      severity: p.severity,
      check: p.step,
      file: cut(p.file, 500),
      line: Math.max(1, p.line),
      ...(p.end_line ? { end_line: p.end_line } : {}),
      title: cut(clean(p.title), 300),
      body: cut(clean(p.body), 5000),
      ...(p.suggestion ? { suggestion: cut(clean(p.suggestion), 5000) } : {}),
      inline: p.inline,
    })),
    fixed: fixed.length,
  };
  return {
    output,
    verdict: review.verdict,
    findings: placed.filter((p) => p.severity !== 'nit').length,
    summaryUrl: o.dryRun ? '' : (summary?.html_url ?? ''),
    model: [models.main, ...models.subagents].join(', '),
    effort: choice.effort,
    tokens: result.tokens,
    costUsd: result.costUsd,
    bySeverity: {
      blocking: placed.filter((p) => p.severity === 'blocking').length,
      should_fix: placed.filter((p) => p.severity === 'should-fix').length,
      nit: placed.filter((p) => p.severity === 'nit').length,
    },
  };
}
