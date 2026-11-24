import * as core from '@actions/core';
import { context, getOctokit } from '@actions/github';
import { APP_BOT, DASHBOARD_URL } from './consts/api.const';
import { stopAgents, type Tokens } from './services/agent.service';
import { fetchGrant, reportRun } from './services/api.service';
import { checkoutHead } from './services/checkout.service';
import { dismissFinding } from './services/dismiss.service';
import { ignoresOf } from './utils/dismiss.util';
import { type Ending, finalize, trackRun } from './services/finalize.service';
import { type Reaction, reactEnd, reactStart } from './services/reaction.service';
import { replyToComment } from './services/reply.service';
import { addShaftMcp } from './services/mcp-setup.service';
import { reviewPullRequest } from './services/review.service';
import { commentOnce, hasWriteAccess, pullRequestOf, REVIEW_COMMAND, route } from './services/route.service';
import { step } from './services/step.service';
import { runTask } from './services/task.service';
import { failureMarkdown, noticeText, ShaftFailure } from './utils/failure.util';
import { redact, workflowEditUrl } from './utils/render.util';
import { classifierTokens, configureGuardrails, guardrailEvents, guardTexts, ruleName } from './guardrails/classify.service';
import { CANARY, SIZE_MAX } from './guardrails/guardrail.const';
import { setServerRules } from './guardrails/input.util';
import { type Flagged, flaggedLines } from './guardrails/output.util';

/** A setting from the Axon Shaft API, checked before the run starts. */
function oneOf(name: string, allowed: string[], value: unknown): string {
  if (typeof value === 'string' && allowed.includes(value)) return value;
  throw new ShaftFailure('api_error', `The Axon Shaft API sent ${name} "${value}", which isn't one of ${allowed.join(', ')}. Check the repo's settings on the dashboard.`, DASHBOARD_URL);
}

function positive(name: string, value: unknown): number {
  const n = Number(value);
  if (n > 0) return n;
  throw new ShaftFailure('api_error', `The Axon Shaft API sent ${name} "${value}", which isn't a positive number. Check the repo's settings on the dashboard.`, DASHBOARD_URL);
}

const globs = (v: unknown) => (Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []);
/** The API's report of a repo config file it left out: its path and problems, as text only. */
const repoConfigOf = (v: unknown) => {
  const c = v as { path?: unknown; problems?: unknown } | undefined;
  return typeof c?.path === 'string' ? { path: c.path, problems: globs(c.problems).slice(0, 5) } : undefined;
};

/** Set once the API has opened the run's row: a failure after that is reported to it, so the dashboard shows it. */
let reportFailure: ((e: unknown) => Promise<void>) | undefined;
/** The 👀 on the comment that started the run, or on the pull request, swapped at the end for 🚀 when `done` is set, or 😕. */
let reaction: Reaction | undefined;
let done = false;

async function run(): Promise<void> {
  const started = Date.now();
  const r = route(context.eventName, context.payload);
  if (r.mode === 'skip') return r.code ? core.notice(noticeText(r.reason, r.code)) : core.info(r.reason);

  const dryRun = core.getBooleanInput('dry_run');
  const cwd = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const { owner, repo } = context.repo;
  const pull_request = pullRequestOf(context.payload);
  const grant = await step('Config from the dashboard', () =>
    fetchGrant(
      r.mode === 'review'
        ? { job: 'review', event: r.event, fork: r.fork, pull_request }
        : // A comment on a line of the diff: the API replies on its thread itself when it refuses the run.
          {
            job: r.mode === 'dismiss' && r.undo ? 'undismiss' : r.mode,
            ...(r.mode === 'task' && r.follow && { command: r.follow }),
            pull_request,
            ...(context.eventName === 'pull_request_review_comment' && 'ask' in r && { comment: { id: r.ask.id } }),
          },
    ),
  );
  // `/dismiss` and `/undismiss` run no model: the API sends only a token to change the finding's state with.
  if (r.mode === 'dismiss' && !grant.run && grant.dismiss && typeof grant.github_token === 'string') {
    const gh = getOctokit(grant.github_token);
    if (!(await hasWriteAccess(gh, owner, repo, r.actor)))
      return core.notice(noticeText(`${r.actor} has no write access, so nothing was dismissed. Only people with write access can use /dismiss and /undismiss.`, 'no_write_access'));
    reaction = await reactStart(gh, context, dryRun);
    const out = await step(r.undo ? 'Bring the finding back' : 'Dismiss the finding', () =>
      dismissFinding({ octokit: gh, owner, repo, number: r.number, ask: r.ask, actor: r.actor, undo: r.undo, reason: r.reason, bot: APP_BOT, dryRun, secrets: [grant.github_token!] }),
    );
    done = out.done;
    return out.done ? core.info(out.message) : core.notice(noticeText(out.message, 'not_a_finding'));
  }
  if (!grant.run) {
    // The API's comment to post once: how to start a fork's review, or the list of commands for /help.
    if (typeof grant.github_token === 'string') {
      const gh = getOctokit(grant.github_token);
      if (typeof grant.comment === 'string') {
        reaction = await reactStart(gh, context, dryRun);
        if (dryRun) core.info(`--- comment\n${grant.comment}`);
        else await commentOnce(gh, owner, repo, r.number, grant.comment, APP_BOT);
        done = true;
      }
    }
    const code = grant.code ?? grant.notice;
    // The cap stops every run until an admin acts, so it gets a card in the job summary like a failure.
    if (code === 'spending_cap' || code === 'user_blocked') await writeSummary(failureMarkdown(new ShaftFailure(code, grant.reason)));
    return core.notice(noticeText(grant.reason, code));
  }
  const octokit = getOctokit(grant.github_token);
  // What the installation hasn't approved yet: each warning once, and the review's footer names them.
  const missing = Array.isArray(grant.missing_permissions) ? grant.missing_permissions : [];
  for (const w of new Set(missing.map((p) => p.warning))) core.warning(w);

  if (r.mode === 'help') return core.notice('The Axon Shaft API sent a run for /help, which runs nothing.');
  if (r.actor && !(await hasWriteAccess(octokit, owner, repo, r.actor))) {
    const what =
      r.mode === 'review'
        ? `no review was started. Only people with write access can start one with ${REVIEW_COMMAND}`
        : r.mode === 'reply'
          ? "the question wasn't answered. Only people with write access can ask with /ask"
          : `nothing was changed. Only people with write access can start a change with ${r.mode === 'task' && r.follow ? `/${r.follow}` : '/fix or /axonshaft'}`;
    return core.notice(noticeText(`${r.actor} has no write access, so ${what}.`, 'no_write_access'));
  }
  // A review no comment started gets its 👀 on the pull request, swapped like a comment's at the end.
  reaction = await reactStart(octokit, context, dryRun, r.mode === 'review' ? r.number : undefined);
  // The project's own variables pass to the model's commands and the checks, so their values are
  // masked in the log and taken out of anything posted, like the tokens.
  const envValues = globs(grant.settings.env).flatMap((n) => process.env[n] ?? []);
  for (const v of envValues) core.setSecret(v);
  const secrets = [CANARY, grant.claude_token.value, grant.github_token, Buffer.from(`x-access-token:${grant.github_token}`).toString('base64'), ...envValues];
  reportFailure = (e) =>
    reportRun({
      error: { code: e instanceof ShaftFailure ? e.code : 'review_failed', message: redact(e instanceof Error ? e.message : String(e), secrets) },
      duration_ms: Date.now() - started,
    });
  configureGuardrails({ claude: grant.claude_token, cwd, secrets });
  // The API's extra input rules, added to the built-in ones (never in place of them).
  setServerRules(grant.guardrail?.rules);
  const flagged = Array.isArray(grant.guardrail?.flagged) ? grant.guardrail.flagged : [];
  // The commenter's own command: a harmful one never reaches the model, and strikes them.
  const sender = context.payload.comment?.user ?? context.payload.sender;
  const askerId = typeof sender?.id === 'number' ? sender.id : undefined;
  if ((r.mode === 'task' || r.mode === 'reply') && (await guardTexts([{ text: r.ask.text, where: 'command', user: askerId ? { id: askerId, login: r.actor } : undefined }], { text: SIZE_MAX.command, line: SIZE_MAX.line }))[0]!.blocked) {
    const why = 'A guardrail rule refused this command, so no model ran. An admin can see the rule on the dashboard.';
    core.notice(noticeText(why, 'guardrail_blocked'));
    await writeGuardrailSummary(flagged);
    return reportRun({ error: { code: 'guardrail_blocked', message: why }, duration_ms: Date.now() - started });
  }
  const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;
  trackRun({ token: grant.github_token, owner, repo, runUrl, started, secrets });
  // On pull_request the checkout is the PR merged into its base; anywhere else it's the base branch.
  if (context.eventName !== 'pull_request') await step('Check out the pull request', async () => checkoutHead(cwd, r.number, grant.github_token));

  const { settings, job } = grant;
  // What a review, a reply and a task all run with.
  const common = {
    octokit,
    owner,
    repo,
    number: r.number,
    claude: grant.claude_token,
    secrets,
    model: String(settings.model ?? ''),
    effort: oneOf('effort', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], settings.effort),
    // Not set on the dashboard (the API's default, or none): the review picks a cap from the diff's size.
    maxTurns: settings.maxTurns == null || settings.maxTurnsDefault === true ? undefined : positive('maxTurns', settings.maxTurns),
    timeoutMinutes: positive('timeLimit', settings.timeLimit),
    skip: globs(settings.skip),
    focus: globs(settings.focus),
    env: globs(settings.env),
    bot: APP_BOT,
    dryRun,
    runUrl,
    dashboardRunUrl: grant.run_url,
    cwd,
  };
  // What the run used, for the dashboard; the cost only on an API key.
  const usage = (o: { tokens: Tokens; costUsd: number }) => ({
    duration_ms: Date.now() - started,
    tokens: addTokens(o.tokens, classifierTokens()),
    ...(grant.claude_token.kind === 'api_key' ? { cost_usd: o.costUsd } : {}),
  });

  if (r.mode === 'task') {
    const out = await runTask({
      ...common,
      ask: r.ask,
      asker: r.actor,
      askerId,
      bare: r.bare,
      follow: r.follow,
      template: job.prompt.template,
      pushMode: String(settings.pushMode),
      githubToken: grant.github_token,
      repoUrl: `${context.serverUrl}/${owner}/${repo}`,
    });
    await writeGuardrailSummary(flagged);
    if (!('refused' in out)) {
      done = true;
      return reportRun({ model: out.model, effort: out.effort, ...usage(out), output: out.output });
    }
    core.notice(noticeText(out.refused, out.code));
    return reportRun({ error: { code: out.code, message: redact(out.refused, secrets) }, duration_ms: Date.now() - started });
  }
  if (r.mode === 'reply') {
    await writeGuardrailSummary(flagged);
    const out = await replyToComment({ ...common, ask: r.ask, asker: r.actor, askerId, template: job.prompt.template });
    done = true;
    return reportRun({ model: out.model, effort: out.effort, ...usage(out), output: out.output });
  }
  // The review model reaches Axon Shaft only through its MCP server, added to Claude Code's config here.
  await step("Connect Axon Shaft's MCP server", addShaftMcp);
  const out = await reviewPullRequest({
    ...common,
    depth: oneOf('depth', ['standard', 'deep'], job.options.depth),
    nits: oneOf('nits', ['summary', 'inline', 'off'], job.options.nits),
    gates: globs(settings.gates),
    prompt: job.prompt,
    checks: job.checks,
    checklists: job.checklists,
    latestAction: grant.latest_action,
    missingPermissions: missing,
    advisories: settings.advisories === true,
    ignore: ignoresOf(settings.ignore),
    repoConfig: repoConfigOf(settings.repoConfig),
    commands: globs(settings.commands),
    workflowEditUrl: workflowEditUrl(process.env.GITHUB_WORKFLOW_REF, context.payload.repository?.default_branch),
    flagged,
  });
  await writeGuardrailSummary(flagged);
  core.setOutput('verdict', out.verdict);
  core.setOutput('findings', out.findings);
  core.setOutput('summary_url', out.summaryUrl);
  done = true;
  await reportRun({ verdict: out.verdict, model: out.model, effort: out.effort, findings: out.bySeverity, ...usage(out), output: out.output });
}

/** Fail the step; a known failure also puts its card, message and link in the job summary. */
async function fail(e: unknown): Promise<void> {
  core.setFailed(e instanceof Error ? e.message : String(e));
  await reportFailure?.(e);
  if (e instanceof ShaftFailure) await writeSummary(failureMarkdown(e));
}

const addTokens = (a: Tokens, b: Tokens): Tokens => ({ input: a.input + b.input, output: a.output + b.output, cache_read: a.cache_read + b.cache_read, cache_write: a.cache_write + b.cache_write });

/** The guardrail lines for people with strikes, in the job summary. */
async function writeGuardrailSummary(flagged: Flagged[]): Promise<void> {
  const lines = flaggedLines(flagged, guardrailEvents(), ruleName);
  if (lines.length) await writeSummary(lines.join('\n\n'));
}

function writeSummary(markdown: string): Promise<unknown> {
  return core.summary
    .addRaw(markdown)
    .write()
    .catch((w: Error) => core.warning(`Couldn't write the job summary: ${w.message}`));
}

let ending: Ending = { kind: 'finished' };
run()
  .catch((e) => {
    ending = { kind: 'failed', error: e };
    return fail(e);
  })
  .finally(() => Promise.all([finalize(ending), reaction && reactEnd(reaction, done)]));

/**
 * A cancel (or the job's time limit) sends SIGINT, then SIGTERM 7.5 s later, then kills the process
 * 2.5 s after that. The cleanup gets 5 s, then the session stops and the step exits; anything still
 * open by then, the post step closes.
 */
function cancel(): void {
  const cleanup = Promise.all([finalize({ kind: 'cancelled', message: 'The workflow was cancelled before the review finished.' }), reaction && reactEnd(reaction, false)]);
  Promise.race([cleanup, new Promise((r) => setTimeout(r, 5000))]).finally(() => {
    stopAgents();
    process.exit(1);
  });
}
process.once('SIGINT', cancel);
process.once('SIGTERM', cancel);
