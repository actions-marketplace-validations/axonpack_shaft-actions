import * as core from '@actions/core';
import { datamark } from '../abuse/input.util';
import { guardrails, matchesAny } from '../utils/guardrails.util';
import { abuseEvents, ruleName } from '../abuse/classify.service';
import { type Flagged, flaggedLines } from '../abuse/output.util';
import { type Choice, ladder, matches } from '../utils/auto-pick.util';
import { planChecklists, STEPS_AT_END, stepsBlock } from '../utils/checklist-plan.util';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { GUIDE_CAP } from '../consts/settings.const';
import type { Octokit } from '../types/octokit.type';
import type { ScriptInput } from '../types/prestep.type';
import type { ClaudeToken, GrantJob, MissingPermission, RunOutput } from './api.service';
import { type AgentResult, REVIEW_FORMAT, reviewSchema, runAgent, type Tokens } from './agent.service';
import { openAdvisories } from './advisory.service';
import { checkoutFiles } from './checkout.service';
import { type LightResult, lightPass } from './light-pass.service';
import { LIGHT_PASS, MAIN_PASS_ONLY } from '../consts/ladder.const';
import { factsBlock, quietChecklists, runScripts, SCRIPTS } from './prestep/prestep.service';
import { baseFile, type Context, collectContext } from './context.service';
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
import { climb, modelLabel, NotWorked, partialReview, type Tried, withSpent } from './ladder.service';
import { step } from './step.service';
import { reviewThreads, threadDismissals } from './dismiss.service';
import { hasWriteAccess } from './route.service';
import { dedupe } from '../utils/dedupe.util';
import { changedSince, configHash, diffHashes, nothingChangedNote } from '../utils/incremental.util';
import { type Ignore, ignored, verdictAfter, withDismissed } from '../utils/dismiss.util';
import {
  type CheckItem,
  type Finding,
  checkStates,
  failedSummary,
  idleSummary,
  inlineBody,
  parseState,
  place,
  type Placed,
  redact,
  renderSummary,
  type Review,
  type State,
  STEPS,
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
  /** The job's checklists, from an API that sends them with `prompt.open`; without, the review runs `prompt.template` as 1.5 did. */
  checklists?: GrantJob['checklists'];
  dryRun: boolean;
  runUrl?: string;
  /** The run's page on the dashboard, when the API sends it. */
  dashboardRunUrl?: string;
  /** A newer v1 release than this run's, for a line under the summary's card. */
  latestAction?: { version: string; url: string };
  /** GitHub's web editor for the workflow file, linked with that line. */
  workflowEditUrl?: string;
  /** Open a private draft advisory for each blocking security finding (the API's `settings.advisories`). */
  advisories?: boolean;
  /** Repo-wide ignores from the repo's `.github/axonshaft.yml`: a finding that matches one is left out like a dismissed one. */
  ignore?: Ignore[];
  /** Why the API left the repo's config file out, for a warning in the summary. */
  repoConfig?: { path: string; problems: string[] };
  /** The users the API says have active strikes, for the summary's Abuse protection lines. */
  flagged?: Flagged[];
  /** Permissions the installation hasn't approved, for the footer's table. */
  missingPermissions?: MissingPermission[];
  /** The follow-up commands the project keeps on (the API's `settings.commands`), for the summary to list. */
  commands?: string[];
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

/** The light pass's model as the run reported it, or its alias when it reported none. */
const lightModel = (l: LightResult) => l.spent.models.find((m) => m.includes(LIGHT_PASS.model)) ?? LIGHT_PASS.model;
const subtract = (a: Tokens, b: Tokens): Tokens => ({ input: a.input - b.input, output: a.output - b.output, cache_read: a.cache_read - b.cache_read, cache_write: a.cache_write - b.cache_write });

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
    title: datamark(pr.title),
    author: pr.author,
    body: datamark(pr.body),
    commits: ctx.commits.map((m) => `- ${m}`).join('\n'),
    comments: trustedComments([...ctx.comments, ...ctx.reviewComments]),
    diff: diffText(ctx.files, o.focus, ctx.generated),
  });
}

/**
 * Resolve the threads of fixed findings. Only a thread `bot` started counts, by the marker at the
 * end of its first comment, the same rule as `unposted`: anyone else's thread with our marker in it
 * stays open.
 */
export async function resolveThreads(octokit: Octokit, ctx: Context, fps: string[], bot: string): Promise<void> {
  for (const t of await reviewThreads(octokit, ctx, bot)) {
    if (!t.resolved && t.fp && fps.includes(t.fp)) await octokit.graphql('mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}', { id: t.id });
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
  let prior = parseState(ctx.summary?.body);
  // A thread someone resolved since the last review dismisses its finding; one reopened brings it back.
  if (prior && !o.dryRun) {
    const read = prior;
    prior = await reviewThreads(octokit, ctx, o.bot)
      .then((threads) => threadDismissals(read, threads, o.bot, (login) => hasWriteAccess(octokit, ctx.owner, ctx.repo, login)))
      .catch((e: Error) => {
        core.warning(`Reading the review threads failed, so resolved threads count as before: ${e.message}`);
        return read;
      });
  }
  const files = ctx.files.filter((f) => !matches(f.filename, o.skip));
  const skipped = ctx.files.length - files.length;
  // Only the checklists whose paths match a changed file run; the others get a skipped check run.
  const planned = Array.isArray(o.checklists) && typeof o.prompt.open === 'string' ? planChecklists(o.checklists, files, Object.keys(SCRIPTS)) : undefined;
  const fired = planned?.filter((c) => !c.skip);
  // What the next push builds on, and the files changed since the review this one builds on (none: nothing changed).
  const memo = { files: diffHashes(files), config: configHash([o.prompt, o.checklists, o.nits, o.ignore, o.gates, o.focus, o.skip, o.depth, o.model, o.effort, o.checks]) };
  const changed = changedSince(prior, memo.files, memo.config);
  // On a push, only the checklists whose paths the changed files touch run again; the rest keep the last review's findings.
  const rerun = changed?.length && planned ? planChecklists(o.checklists!, changed.map((filename) => ({ filename })), Object.keys(SCRIPTS)).filter((c) => !c.skip).map((c) => c.key) : undefined;
  const carried = rerun?.length ? (fired?.filter((c) => !rerun.includes(c.key)).map((c) => c.key) ?? []) : [];
  const running = fired?.filter((c) => !carried.includes(c.key));
  // Script checklists' findings are their result: they never reach the model.
  let scripted = running?.filter((c) => c.mode === 'script') ?? [];
  let modelled = running?.filter((c) => c.mode !== 'script');
  // What the footer says about the run, whichever way it goes.
  const facts = {
    sha,
    repo: `${ctx.owner}/${ctx.repo}`,
    runUrl: o.runUrl,
    dashboardRunUrl: o.dashboardRunUrl,
    lines: files.reduce((n, f) => n + f.additions + f.deletions, 0),
    files: files.length,
    skipped,
    missingPermissions: o.missingPermissions,
  };
  const pickInput = { mode: 'review' as const, depth: o.depth, files, focus: o.focus, model: o.model, effort: o.effort, maxTurns: o.maxTurns, checklists: modelled?.length };
  let rungs = ladder(pickInput);
  let choice = rungs[0]!;
  let tried: Tried[] = [];
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
  const postChecks = async (states: CheckItem[], placed: Placed[]) => {
    if (!o.dryRun) return canCheck ? postCategoryChecks(octokit, ctx.owner, ctx.repo, sha, states, placed, clean) : undefined;
    for (const c of states) if (CATEGORY_CONCLUSION[c.state]) core.info(`Would post the ${categoryCheck(c.key)} check: ${CATEGORY_CONCLUSION[c.state]}`);
  };

  // No checklist runs: no model call, unless merge gates need judging, since a gate is never passed by omission.
  if (planned && !fired!.length && !o.gates?.length) {
    const states = planned.map((c): CheckItem => ({ key: c.key, label: c.name, state: 'not_checked', reason: c.skip }));
    const body = idleSummary(states, prior, { ...facts, checklists: planned });
    if (o.dryRun) core.info(`--- summary comment\n${clean(body)}`);
    else await writeSummary(body);
    await postChecks(states, []);
    const none = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const url = o.dryRun ? '' : (summary?.html_url ?? '');
    return {
      verdict: 'looks-good',
      findings: 0,
      summaryUrl: url,
      model: 'none',
      effort: 'none',
      tokens: none,
      costUsd: 0,
      bySeverity: { blocking: 0, should_fix: 0, nit: 0 },
      output: {
        headline: 'No checklist ran, so no model was called.',
        claim: '',
        impact: '',
        scope: '',
        not_checked: "Every checklist. Each one's check run says why.",
        type: '',
        confidence: 0,
        comment_url: url,
        checks: states.slice(0, 60),
        passes: [],
        findings: [],
        fixed: 0,
      },
    };
  }

  // The same diff as the last review, after a rerun or a rebase: its result carries over with no model call.
  if (changed?.length === 0 && ctx.summary && (!o.gates?.length || prior!.gates)) {
    const kept: State = { ...prior!, sha, ...memo };
    const placed = kept.findings.map((f): Placed => ({ ...f, step: f.step ?? '', body: '', inline: true }));
    const headline = 'Nothing changed since the last review, so no model was called.';
    const review: Review = { verdict: verdictAfter(kept.verdict ?? 'looks-good', placed) as Review['verdict'], type: '', confidence: 0, headline, claim: '', impact: '', scope: '', findings: [], resolved: [], checked: kept.checked ?? [], not_checked: '' };
    const body = withDismissed(nothingChangedNote(ctx.summary.body, sha), kept);
    if (o.dryRun) core.info(`--- summary comment\n${clean(body)}`);
    else await writeSummary(body);
    const gates = o.gates?.length ? gateResults(o.gates, kept.gates) : undefined;
    if (gates && o.dryRun) core.info(`Would post the ${GATES_CHECK} check: ${gatesConclusion(gates)}`);
    else if (gates && canCheck) await postGatesCheck(octokit, ctx.owner, ctx.repo, sha, gates, clean);
    const states = checkStates(review, placed, o.checks, planned);
    await postChecks(states, placed);
    const url = o.dryRun ? '' : (summary?.html_url ?? '');
    const count = (s: Placed['severity']) => placed.filter((p) => p.severity === s).length;
    return {
      verdict: review.verdict,
      findings: placed.filter((p) => p.severity !== 'nit').length,
      summaryUrl: url,
      model: 'none',
      effort: 'none',
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      costUsd: 0,
      bySeverity: { blocking: count('blocking'), should_fix: count('should-fix'), nit: count('nit') },
      output: {
        headline,
        claim: '',
        impact: '',
        scope: '',
        not_checked: '',
        type: '',
        confidence: 0,
        comment_url: url,
        checks: states.slice(0, 60),
        passes: [],
        findings: placed.slice(0, 200).map((p) => ({ severity: p.severity, check: p.step, file: p.file, line: Math.max(1, p.line), title: p.title, body: '', inline: true })),
        fixed: 0,
      },
    };
  }
  if (carried.length) core.info(`Only ${rerun!.join(', ')} run again; ${carried.join(', ')} keep the last review's findings`);

  // What the scripts read. Each base-branch file is fetched once, however many scripts ask for it.
  const reads = new Map<string, Promise<string | undefined>>();
  const input: ScriptInput = {
    files,
    pr: ctx.pr,
    guides: ctx.guides,
    commits: ctx.commits,
    checkout: checkoutFiles(o.cwd),
    base: (path) => reads.get(path) ?? reads.set(path, baseFile(octokit, ctx.owner, ctx.repo, ctx.pr.base, path)).get(path)!,
    octokit,
  };
  const scriptFindings = scripted.length ? await step('Run the script checklists', async () => runScripts(scripted, input)) : [];
  // No script hit, no model call: a script+model checklist whose script found nothing passes as a script checklist would.
  const quiet = modelled?.length ? await quietChecklists(modelled, input) : [];
  if (quiet.length) {
    modelled = modelled!.filter((c) => !quiet.includes(c));
    scripted = [...scripted, ...quiet];
  }
  // With only script checklists to run, no model is called, unless merge gates need judging.
  const useModel = !modelled || modelled.length > 0 || !!o.gates?.length;

  let result: AgentResult<Review>;
  // The checklists marked `light` run first on Haiku, when the main pass has work of its own; if that pass doesn't work, the main pass runs them.
  const lightRun = modelled && o.depth !== 'deep' ? modelled.filter((c) => c.model === 'light' && !MAIN_PASS_ONLY.includes(c.key)) : [];
  let light: LightResult | undefined;
  let steps = modelled;
  if (useModel && lightRun.length && (lightRun.length < modelled!.length || o.gates?.length)) {
    await progress('Review', 'Running the light checklists with Haiku');
    light = await step('Light pass', () => lightPass(lightRun, { ...ctx, files }, prior, input, { ...o, skipped }));
    if (light.out) steps = modelled!.filter((c) => !lightRun.includes(c));
  }
  const lightKeys = light?.out ? lightRun.map((c) => c.key) : [];
  if (useModel) {
    // With checklists the run's data comes first and the steps last, so the part before them reads the same whatever runs.
    const pack = buildPrompt({ ...ctx, files }, prior && { ...prior, findings: prior.findings.filter((f) => !carried.includes(f.step ?? '') && !lightKeys.includes(f.step ?? '')) }, { template: steps ? o.prompt.open!.split('{{steps}}').join(STEPS_AT_END) : o.prompt.template, focus: o.focus, skipped });
    const prompt = steps ? `${pack}\n${stepsBlock(o.prompt.before ?? [], steps, o.prompt.after ?? [])}${await factsBlock(steps, input)}` : pack;

    rungs = ladder({ ...pickInput, checklists: steps?.length, promptChars: prompt.length });
    try {
      const climbed = await step('Review', () =>
        climb(rungs, async (c, last) => {
          // An alias reads as a name (`sonnet` as Sonnet); a full model ID stays as written.
          const model = /^[a-z]+$/.test(c.model) ? c.model[0]!.toUpperCase() + c.model.slice(1) : c.model;
          await progress('Review', `Reviewing with ${model}, effort ${c.effort}`);
          const out = await runAgent(
            prompt,
            {
              claude: o.claude,
              model: c.model,
              effort: c.effort,
              fallbackModel: c.autoModel ? FALLBACK[c.model] : undefined,
              subagentModel: c.subagentModel,
              passes,
              maxTurns: c.maxTurns,
              timeoutMinutes: o.timeoutMinutes,
              cwd: o.cwd,
              env: o.env,
              // On a lower rung a bad reply moves up a model instead of asking the same one again.
              retry: last,
            },
            steps ? { ...REVIEW_FORMAT, schema: reviewSchema(steps.map((c) => c.key)) } : REVIEW_FORMAT,
          );
          // A partial review below the last rung moves up one, counting what it used; the last rung's stands.
          const partial = last ? undefined : partialReview(out.reply, steps?.map((c) => c.key) ?? []);
          if (partial) throw Object.assign(new NotWorked(partial), { spent: out });
          return out;
        }),
      );
      ({ choice, tried } = climbed);
      result = withSpent(climbed.out, climbed.spent);
    } catch (e) {
      // runAgent's failures are all review_* ones; the PR shows the same card as the job summary.
      if (e instanceof ShaftFailure) {
        e.url ??= o.runUrl;
        if (light && e.spent) e.spent = { ...withSpent(e.spent, light.spent), models: e.spent.models };
        await writeSummary(failedSummary(e, prior));
      }
      throw e;
    }
    core.info(`Models used ${result.models.join(', ')}, about $${result.costUsd.toFixed(2)}`);
    if (light) {
      // The light pass's findings, checklists and resolved fingerprints join the main pass's; its tokens always count.
      const l = light.out?.reply;
      const main = withSpent(result, light.spent);
      result = l ? { ...main, reply: { ...main.reply, findings: [...main.reply.findings, ...l.findings], checked: [...main.reply.checked, ...l.checked], resolved: [...main.reply.resolved, ...l.resolved] } } : main;
    }
  } else {
    const headline = `Only script checklists ran (${scripted.map((c) => c.name).join(', ')}), so no model was called.`;
    const reply: Review = { verdict: 'looks-good', type: '', confidence: 100, headline, claim: '', impact: '', scope: '', findings: [], resolved: [], checked: [], not_checked: '' };
    result = { reply, models: [], costUsd: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } };
  }
  // Only the project's own gates, each with the review's result; any other gates in the reply are dropped.
  const gates = o.gates?.length ? gateResults(o.gates, result.reply.gates) : undefined;
  const { reply } = result;
  // Two checklists on the same lines leave one finding (dedupe.util). A script's or the light pass's blocking or should-fix finding raises the verdict the main pass gave.
  const raising = [...scriptFindings, ...(light?.out?.reply.findings ?? [])];
  const verdict = raising.some((f) => f.severity === 'blocking')
    ? 'blocking'
    : raising.some((f) => f.severity === 'should-fix') && reply.verdict === 'looks-good'
      ? 'needs-changes'
      : reply.verdict;
  const review: Review = { ...reply, verdict, gates, findings: dedupe([...reply.findings, ...scriptFindings], planned?.map((c) => c.key) ?? [...STEPS]), checked: [...reply.checked, ...scripted.filter((c) => !c.skip).map((c) => c.key), ...carried.filter((k) => prior!.checked!.includes(k))] };
  await progress('Post the review', 'Posting the review');
  core.startGroup('Post the review');

  // A dismissed finding (by fingerprint, or a line or two away) isn't posted, counted or checked again.
  // Nor is one the repo config file's `ignore` matches, which the summary only counts.
  const dismissed = prior?.dismissed ?? [];
  // A carried finding goes through `place` again, so it keeps its fingerprint and only its first inline comment.
  const kept = (prior?.findings ?? []).filter((f) => carried.includes(f.step ?? '')).map((f): Finding => ({ ...f, step: f.step!, body: 'Found by an earlier review. Its checklist had nothing new to check on this push.' }));
  const all = place([...review.findings, ...kept], files, o.nits, [...(prior?.findings ?? []), ...dismissed]);
  // A finding on a file the project's guardrails cover is never posted, nor its suggestion.
  const { no_edit, no_read } = guardrails();
  const unguarded = all.filter((p) => !matchesAny(p.file, [...no_edit, ...no_read]));
  const placed = unguarded.filter((p) => !dismissed.some((d) => d.fp === p.fp) && !ignored(p, o.ignore ?? []));
  if (placed.length < all.length) review.verdict = verdictAfter(review.verdict, placed) as Review['verdict'];
  // A carried finding raises the verdict as a script's does.
  const old = placed.filter((p) => carried.includes(p.step));
  if (old.some((p) => p.severity === 'blocking')) review.verdict = 'blocking';
  else if (old.some((p) => p.severity === 'should-fix') && review.verdict === 'looks-good') review.verdict = 'needs-changes';
  // Before anything is posted, so a withheld finding's details never reach the PR.
  const advisories = o.advisories ? await openAdvisories(placed, { pull: ctx.pr.number, sha: ctx.pr.headSha, dryRun: o.dryRun, clean }) : undefined;
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

  const models = useModel ? chosenModels(result.models, choice, !!choice.subagentModel && passes.length > 0) : undefined;
  const body = renderSummary(
    review,
    placed,
    prior,
    {
    ...facts,
    memo,
    advisories,
    checks: o.checks,
    checklists: planned,
    latestAction: o.latestAction,
    workflowEditUrl: o.workflowEditUrl,
    ignored: unguarded.filter((p) => !dismissed.some((d) => d.fp === p.fp)).length - placed.length,
    guardrailed: all.length - unguarded.length,
    repoConfig: o.repoConfig,
    flagged: flaggedLines(o.flagged ?? [], abuseEvents(), ruleName),
    // `/resolve` only when GitHub says the pull request has conflicts.
    commands: o.commands?.filter((c) => c !== 'resolve' || ctx.pr.conflicts),
    ...(models && {
      models: { main: models.main, fellBackFrom: models.fellBack ? choice.model : undefined, subagents: models.subagents },
      effort: choice.effort,
      reason: choice.reason,
      tried,
      maxTurns: choice.maxTurns,
      tokens: result.tokens,
      light: light && { model: lightModel(light), maxTurns: LIGHT_PASS.maxTurns, tokens: light.spent.tokens, checklists: lightRun.map((c) => c.name), failed: !light.out },
      // On a subscription the SDK's price is only an estimate, so the footer weighs the tokens instead.
      costUsd: o.claude.kind === 'api_key' ? result.costUsd : undefined,
    }),
    },
    dismissed,
  );
  if (o.dryRun) core.info(`--- summary comment\n${clean(body)}`);
  else await writeSummary(body);

  if (gates && o.dryRun) core.info(`Would post the ${GATES_CHECK} check: ${gatesConclusion(gates)}`);
  else if (gates && canCheck) await postGatesCheck(octokit, ctx.owner, ctx.repo, sha, gates, clean);

  const states = checkStates(review, placed, o.checks, planned);
  await postChecks(states, placed);

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
    checks: states.slice(0, 60),
    ...(modelled && {
      passes: models
        ? [
            { name: 'main', model: models.main, tokens: light ? subtract(result.tokens, light.spent.tokens) : result.tokens, checklists: steps!.slice(0, 60).map((c) => c.key), max_turns: choice.maxTurns },
            ...(light ? [{ name: 'light', model: lightModel(light), tokens: light.spent.tokens, checklists: lightKeys.slice(0, 60), max_turns: LIGHT_PASS.maxTurns }] : []),
          ]
        : [],
    }),
    findings: placed.slice(0, 200).map((p) => ({
      severity: p.severity,
      check: p.step,
      file: cut(p.file, 500),
      line: Math.max(1, p.line),
      ...(p.end_line ? { end_line: p.end_line } : {}),
      title: cut(clean(p.title), 300),
      body: cut(clean(p.body), 5000),
      ...(p.suggestion ? { suggestion: cut(clean(p.suggestion), 5000) } : {}),
      // A link cut short would lead nowhere, so one over the API's limit is left out.
      ...(p.url && p.url.length <= 500 ? { url: p.url } : {}),
      inline: p.inline,
    })),
    fixed: fixed.length,
    ...(dismissed.length && {
      dismissed: dismissed.slice(0, 200).map((d) => ({ severity: d.severity, file: cut(d.file, 500), line: Math.max(1, d.line), title: cut(clean(d.title), 300), by: cut(d.by, 39), reason: cut(clean(d.reason), 300) })),
    }),
  };
  return {
    output,
    verdict: review.verdict,
    findings: placed.filter((p) => p.severity !== 'nit').length,
    summaryUrl: o.dryRun ? '' : (summary?.html_url ?? ''),
    model: models ? modelLabel([models.main, ...models.subagents].join(', '), tried) : 'none',
    effort: useModel ? choice.effort : 'none',
    tokens: result.tokens,
    costUsd: result.costUsd,
    bySeverity: {
      blocking: placed.filter((p) => p.severity === 'blocking').length,
      should_fix: placed.filter((p) => p.severity === 'should-fix').length,
      nit: placed.filter((p) => p.severity === 'nit').length,
    },
  };
}
