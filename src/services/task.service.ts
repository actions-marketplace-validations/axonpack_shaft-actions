import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { DASHBOARD_URL } from '../consts/api.const';
import { TRIAGE_START } from '../consts/ladder.const';
import { ladder, matches } from '../utils/auto-pick.util';
import { failureMarkdown, noticeText, ShaftFailure } from '../utils/failure.util';
import { pushHits } from '../abuse/push.util';
import { recordEvent } from '../abuse/classify.service';
import { pushDenial, type PushTarget, runsCode, sameChanges, unaskedBuildInputs } from '../utils/push.util';
import { footer, prose, redact } from '../utils/render.util';
import { dataBlock } from '../utils/prompt.util';
import { type ReplyFormat, runAgent } from './agent.service';
import { fetchPushToken } from './api.service';
import { checkList, checksTable, repoCommands, runCheck, skippedNote } from './commands.service';
import { fetchBase, savedCredentials } from './checkout.service';
import { collectContext } from './context.service';
import { applySuggestions, fixStart, openFindings, taskRequest } from './fix.service';
import { climb, NotWorked, NO_SPEND, withSpent } from './ladder.service';
import { assertHead, fileAt, head, mergeInto, pushChanges, readChanges, resetTo } from './push.service';
import { ANSWER_MAX, answerFooter, buildReplyPrompt, postInThread, type ReplyOptions, type ReplyOutcome } from './reply.service';
import { FALLBACK } from './review.service';
import { commandIn, type FollowUp } from './route.service';
import { endSandboxes, prepareSandbox, which } from './sandbox.service';
import { triage, triagePrompt } from './triage.service';
import { step } from './step.service';

/** Ends everything a task posts. */
const TASK_MARKER = '<!-- shaft:task -->';

/** What the Task prompt asks the model for. */
export type TaskReply = { answer: string; commit_message: string; checks: string[] };
export const TASK_FORMAT: ReplyFormat<TaskReply> = {
  name: 'task',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'commit_message', 'checks'],
    properties: { answer: { type: 'string' }, commit_message: { type: 'string' }, checks: { type: 'array', items: { type: 'string' } } },
  },
  parse: (x) => {
    const r = x as Partial<TaskReply> | undefined;
    const ok = typeof r?.answer === 'string' && !!r.answer.trim() && typeof r.commit_message === 'string' && Array.isArray(r.checks) && r.checks.every((c) => typeof c === 'string');
    return ok ? (r as TaskReply) : undefined;
  },
};

/**
 * A reply's options, plus a bare `/fix`, the follow-up command when it's one, the project's push mode,
 * the repo's page on GitHub, for the commit link, and the run's GitHub token, which `/resolve` fetches the base branch with.
 */
export type TaskOptions = ReplyOptions & { bare: boolean; follow?: FollowUp; pushMode: string; repoUrl: string; githubToken: string };
/**
 * A finished task, or one that stopped before its session: `push_failed` when nothing could be
 * pushed, `nothing_to_fix` for a bare `/fix` with no open findings, `self_hosted_unsupported` on a
 * runner GitHub doesn't host, `credentials_in_checkout` for a checkout that kept its token, and
 * `sandbox_unavailable` when the runner can't start the sandbox the commands run in.
 */
export type TaskOutcome =
  | ReplyOutcome
  | {
      refused: string;
      code: 'push_failed' | 'nothing_to_fix' | 'nothing_to_resolve' | 'merge_needs_decision' | 'self_hosted_unsupported' | 'credentials_in_checkout' | 'sandbox_unavailable';
    };

/** Git's conflict markers, at the start of a line. */
const MARKERS = /^(<{7}|>{7})( |$)|^={7}$/m;
/** A regular file in the checkout that still holds conflict markers. A link or a binary file never does. */
export function marked(cwd: string, path: string): boolean {
  try {
    const file = join(cwd, path);
    return lstatSync(file).isFile() && MARKERS.test(readFileSync(file, 'utf8'));
  } catch {
    return false;
  }
}
/** Why git couldn't merge a file, by its `git status` code, when it isn't a text file both sides changed. */
const CONFLICT: Record<string, string> = {
  DD: 'both sides deleted it',
  AU: 'only this branch added it',
  UA: 'only the base branch added it',
  DU: 'this branch deleted it and the base branch changed it',
  UD: 'the base branch deleted it and this branch changed it',
};

/** Why a task refuses a checkout whose `.git/config` holds a credential. */
export const CREDENTIALS_IN_CHECKOUT =
  "The checkout's .git/config holds a GitHub credential, which the model could read, so nothing was changed. Set `persist-credentials: false` on the workflow's actions/checkout step.";

/**
 * Why a task can't run on this runner, or undefined when it can: only on a GitHub-hosted one, a
 * fresh VM per job. On a self-hosted runner a sandbox can't be trusted to be the only thing of the
 * runner's user (`endSandboxes`), and the machine outlives the job.
 */
export function selfHosted(): string | undefined {
  if (process.env.RUNNER_ENVIRONMENT === 'github-hosted') return;
  return 'Axon Shaft makes changes only on GitHub-hosted runners, and this job runs on a self-hosted one, so nothing was changed. Run the Axon Shaft job on `runs-on: ubuntu-latest`.';
}

/**
 * Make the change asked for, then commit it as the app's bot and push it to the pull request's
 * branch, and reply where it was asked with what changed, the commit and the checks. The model's
 * commands and the checks run in the sandbox, and nothing there holds a GitHub token: only once our
 * own run of the checks passes does our code ask the API for the push token, and push through
 * GitHub's API. A push the mode refuses (a fork's PR, the default branch, push mode Disabled) is
 * caught before the session, which then doesn't run, and so is a bare `/fix` with no open findings,
 * a self-hosted runner, a checkout that kept its token and a runner that can't start the sandbox.
 */
export async function runTask(o: TaskOptions): Promise<TaskOutcome> {
  const ctx = await step('Read the pull request', () => collectContext(o.octokit, o.owner, o.repo, o.number, o.bot));
  const post = (body: string) => postInThread(o, body);
  const target: PushTarget = { branch: ctx.pr.head, pullBranch: ctx.pr.head, defaultBranch: ctx.pr.defaultBranch, fork: ctx.pr.fork };
  const refused = pushDenial(o.pushMode, target);
  if (refused) {
    await post(`${failureMarkdown(new ShaftFailure('push_failed', `${refused} Nothing was changed.`, DASHBOARD_URL))}\n\n${TASK_MARKER}`);
    return { refused, code: 'push_failed' };
  }
  // A `/fix` asks for a change; `/axonshaft` may only ask a question. Any `/fix` gets the last review's open findings.
  const isFix = commandIn(o.ask.text) === 'fix';
  const findings = isFix ? openFindings(ctx, o.bot) : [];
  if (o.bare && !findings.length) {
    const why = ctx.summary ? 'The last review has no open findings to fix.' : "There's nothing to fix yet: comment `/review` first.";
    await post(`${why}\n\n${TASK_MARKER}`);
    return { refused: why, code: 'nothing_to_fix' };
  }
  const hosted = selfHosted();
  if (hosted) {
    await post(`${failureMarkdown(new ShaftFailure('self_hosted_unsupported', hosted))}\n\n${TASK_MARKER}`);
    return { refused: hosted, code: 'self_hosted_unsupported' };
  }
  if (savedCredentials(o.cwd)) {
    core.warning(CREDENTIALS_IN_CHECKOUT);
    await post(`${failureMarkdown(new ShaftFailure('credentials_in_checkout', CREDENTIALS_IN_CHECKOUT))}\n\n${TASK_MARKER}`);
    return { refused: CREDENTIALS_IN_CHECKOUT, code: 'credentials_in_checkout' };
  }
  const unsandboxed = await step('Start the sandbox', async () => prepareSandbox(o.cwd));
  if (unsandboxed) {
    await post(`${failureMarkdown(new ShaftFailure('sandbox_unavailable', unsandboxed))}\n\n${TASK_MARKER}`);
    return { refused: unsandboxed, code: 'sandbox_unavailable' };
  }
  const base = head(o.cwd);
  const name = (f: string) => `\`${f.replace(/[`\r\n]/g, '')}\``;
  // `/resolve` merges the base branch first. Only conflicts where both sides changed a text file go to the model.
  let merge: { theirs: string; conflicts: string[] } | undefined;
  if (o.follow === 'resolve') {
    const theirs = await step('Fetch the base branch', async () => fetchBase(o.cwd, ctx.pr.base, o.githubToken));
    const m = mergeInto(o.cwd, theirs);
    if (m.upToDate) {
      const why = `This pull request already has everything from \`${ctx.pr.base}\`, so there's nothing to resolve.`;
      await post(`${why}\n\n${TASK_MARKER}`);
      return { refused: why, code: 'nothing_to_resolve' };
    }
    const stuck = m.conflicts.filter((c) => !['UU', 'AA'].includes(c.code) || !marked(o.cwd, c.path));
    if (stuck.length) {
      resetTo(o.cwd, base);
      const why = `Merging \`${ctx.pr.base}\` needs a decision Axon Shaft can't make: ${stuck.map((c) => `${name(c.path)} (${CONFLICT[c.code] ?? 'a binary file both sides changed'})`).join(', ')}. Nothing was pushed. Merge it by hand, then comment \`/resolve\` again for any other conflicts.`;
      await post(`${why}\n\n${TASK_MARKER}`);
      return { refused: why, code: 'merge_needs_decision' };
    }
    merge = { theirs, conflicts: m.conflicts.map((c) => c.path) };
  }

  const commands = repoCommands(o.cwd);
  // A bare `/fix` applies the review's own suggested changes first, with no model; the model gets only the rest.
  const suggest = () => (o.bare ? applySuggestions(o.cwd, base, findings) : { applied: [], unapplied: [] });
  const { applied, unapplied } = suggest();
  const left = findings.filter((f) => !applied.includes(f));
  const prepared = applied.length ? readChanges(o.cwd, base) : [];
  // A fix of the review's findings may change only the files they name.
  const scope = o.bare ? new Set(findings.map((f) => f.file)) : undefined;
  /** What changed, read before the checks so that what they write isn't pushed, and the checks' results. */
  const settle = async (listed: string[]) => {
    const changes = readChanges(o.cwd, base);
    const outside = scope ? changes.map((c) => c.path).filter((p) => !scope.has(p)) : [];
    // Anything else may touch what runs on install and in CI only when the request asks for it.
    // A merge brings in the base branch's own changes, which nobody needs to ask for: only what differs from it counts.
    const own = merge ? changes.filter((c) => c.content?.toString('utf8') !== fileAt(o.cwd, merge!.theirs, c.path)) : changes;
    const unasked = scope ? [] : unaskedBuildInputs(own, (p) => fileAt(o.cwd, base, p), o.ask.text);
    // Lines that look like an attack (a download piped to a shell, the environment sent out) are never pushed.
    const blocked = pushHits(own, (p) => fileAt(o.cwd, base, p));
    // A conflict left unresolved fails like a check, so it's never pushed.
    const unresolved = (merge?.conflicts ?? []).filter((p) => marked(o.cwd, p)).map((p) => ({ command: `conflict markers in ${p}`, passed: false, output: `${p} still has conflict markers.` }));
    const checks = unresolved.length
      ? unresolved
      : changes.length && !outside.length && !unasked.length && !blocked.length
        ? await step('Run the checks', async () => checkList(listed, commands, o.cwd).map((cmd) => runCheck(o.cwd, cmd, o.env)))
        : [];
    return { changes, outside, unasked, blocked, checks, failed: checks.filter((r) => !r.passed) };
  };
  try {
    // A bare `/fix` whose suggestions all applied, and a `/resolve` with no conflicts, need no model.
    const noModel = (o.bare && !left.length) || (merge && !merge.conflicts.length);
    const ran = noModel ? { ...(await settle([])), result: undefined } : await withModel();
    const { changes, outside, unasked, blocked, checks, failed, result } = ran;
    const lines = [
      result
        ? prose(result.reply.answer)
        : merge
          ? `Merged \`${ctx.pr.base}\` with no conflicts, with no model call.`
          : `Applied the review's suggested change${applied.length === 1 ? '' : 's'}, with no model call.`,
    ];
    if (o.follow === 'tests' && !commands.some((c) => /\btest\b/.test(c)))
      lines.push("This repo has no test command Axon Shaft can run (a `test` script, a `make test` target, Cargo or Go), so the new tests weren't run here. The repo's CI runs them on the push.");
    let commit: string | undefined;
    if (applied.length) lines.push(`**Suggestions applied:** ${applied.map((f) => `${name(`${f.file}:${f.line}`)} ${prose(f.title)}`).join('; ')}`);
    if (unapplied.length) lines.push(`**Suggestions not applied:** ${unapplied.map((u) => `${name(`${u.finding.file}:${u.finding.line}`)} (${u.why})`).join('; ')}`);
    if (changes.length) {
      const paths = changes.map((c) => c.path);
      lines.push(`**Changed:** ${paths.map(name).join(', ')}`);
      const runs = runsCode(paths);
      if (runs.length) lines.push(`**Read before merging:** ${runs.map(name).join(', ')} decide${runs.length === 1 ? 's' : ''} what runs on install and in CI.`);
      if (outside.length) {
        core.warning(`Nothing was pushed: ${outside.join(', ')} isn't named by any finding.`);
        lines.push(`Nothing was pushed: a fix of the review's findings may change only the files they name, and this one also changed ${outside.map(name).join(', ')}.`);
      } else if (blocked.length) {
        const why = `Nothing was pushed: an abuse rule refused the change (${blocked.map((b) => `${b.name} in ${name(b.path)}`).join('; ')}).`;
        core.warning(noticeText(why, 'abuse_blocked'));
        recordEvent(o.askerId ? { id: o.askerId, login: o.asker } : undefined, { rule: blocked[0]!.rule, severity: 'strike', where: 'push', excerpt: blocked[0]!.line });
        lines.push(why);
      } else if (unasked.length) {
        core.warning(`Nothing was pushed: the request didn't ask to change ${unasked.join(', ')}.`);
        lines.push(
          `Nothing was pushed: the change touches what runs on install and in CI (${unasked.map(name).join(', ')}), and the request didn't ask for that. To allow it, ask again and name the file, or say dependency or script.`,
        );
      } else if (failed.length) {
        core.warning(`Nothing was pushed: ${failed.map((c) => c.command).join(', ')} failed.`);
        lines.push(`Nothing was pushed, because ${failed.length === 1 ? 'a check' : 'some checks'} failed.`);
      } else if (o.dryRun) lines.push('Nothing was pushed: this was a dry run.');
      else {
        assertHead(o.cwd, base);
        const { data: bot } = await o.octokit.rest.users.getByUsername({ username: o.bot });
        const message =
          (result && redact(result.reply.commit_message.split('\n')[0]!.trim(), o.secrets).slice(0, 100)) ||
          (merge && `Merge ${ctx.pr.base} into ${ctx.pr.head}`) ||
          (result ? `Make the change asked for with /${o.follow ?? 'fix'}` : "Apply the review's suggested changes");
        const author = { name: o.bot, email: `${bot.id}+${o.bot}@users.noreply.github.com` };
        // The push token exists only from here on: asked for after the checks, and revoked by the push.
        const grant = await step('Get the push token', fetchPushToken);
        const sha = await step('Push the commit', () =>
          pushChanges(grant.push_token, { owner: o.owner, repo: o.repo, branch: grant.branch, base, changes, message, author, merged: merge?.theirs }),
        );
        commit = sha;
        lines.push(`**Commit:** [\`${sha.slice(0, 7)}\`](${o.repoUrl}/commit/${sha}) on \`${grant.branch}\``);
      }
      const skipped = skippedNote(checks);
      if (!outside.length && !unasked.length && !blocked.length) lines.push(checksTable(checks), ...(skipped ? [skipped] : []));
      for (const c of failed)
        lines.push(`<details><summary>Output of <code>${c.command}</code></summary>\n\n\`\`\`\`\n${prose(c.output).replace(/`{4,}/g, '```')}\n\`\`\`\`\n\n</details>`);
    }
    const answer = redact(lines.join('\n\n'), o.secrets).slice(0, ANSWER_MAX);
    // For the run page: the follow-up that ran and the commit it pushed.
    const kind = { ...(o.follow && { command: o.follow }), ...(commit && { commit }) };
    if (!ran.result) {
      const sub = footer({ sha: ctx.pr.headSha, repo: `${o.owner}/${o.repo}`, runUrl: o.runUrl, dashboardRunUrl: o.dashboardRunUrl });
      const commentUrl = await post(`${answer}\n\n${sub}\n\n${TASK_MARKER}`);
      return { model: 'none', effort: 'none', tokens: NO_SPEND.tokens, costUsd: 0, output: { answer, comment_url: commentUrl, ...kind } };
    }
    const { sub, model } = answerFooter(o, ctx.pr.headSha, ran.choice, ran.result, ran.tried, ran.triaged);
    const commentUrl = await post(`${answer}\n\n${sub}\n\n${TASK_MARKER}`);
    return { model, effort: ran.choice.effort, tokens: ran.result.tokens, costUsd: ran.result.costUsd, output: { answer, comment_url: commentUrl, ...kind } };
  } catch (e) {
    // The person who asked sees the same card as the job summary, where they asked.
    if (e instanceof ShaftFailure) {
      e.url ??= o.runUrl;
      await post(`${failureMarkdown(e)}\n\n${TASK_MARKER}`);
    }
    throw e;
  }
  /** The model's part: the ladder's rungs in turn, each from a clean checkout with the suggestions applied again, until one works. */
  async function withModel() {
    // A bare `/fix` shows the model only the files its findings name, not the whole diff.
    const named = new Set(left.map((f) => f.file));
    const files = ctx.files.filter((f) => !matches(f.filename, o.skip) && (!o.bare || named.has(f.filename)));
    const request = taskRequest(o.ask, left, o.bare);
    const input = { mode: 'task' as const, files, focus: o.focus, model: o.model, effort: o.effort, maxTurns: o.maxTurns, findings: (o.bare && left.length) || undefined };
    // Without the checks' tools on the runner, nothing would catch a wrong fix from the smallest model.
    const checked = commands.some((c) => which(c.split(/\s+/)[0]!));
    // With `auto`, a bare `/fix` starts where its findings put it, and anything else where Haiku rates the request.
    const start = ladder(input).length < 2 ? undefined : o.bare ? fixStart(left) : await step('Triage', () => triage(triagePrompt(o.ask.text, left.map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`), files, o.focus), o));
    const rungs = ladder({ ...input, checked, promptChars: request.length + files.reduce((n, f) => n + (f.patch?.length ?? 0), 0), start: start && TRIAGE_START[start.level] });
    core.info(`Making the change with ${rungs.map((c) => `${c.model}, effort ${c.effort}`).join(', then ')}. The repo's commands: ${commands.join(', ') || 'none'}`);
    const climbed = await climb(rungs, async (c, last, earlier) => {
      // Each rung starts again from the pull request's head, told why the one before didn't work.
      if (earlier) {
        resetTo(o.cwd, base);
        suggest();
        if (merge) mergeInto(o.cwd, merge.theirs);
      }
      const retold = earlier
        ? `${request}\n\nAn attempt with a smaller model didn't work, and the checkout is back at the pull request's head. What went wrong, as data:\n\n${dataBlock('earlier-attempt', earlier)}`
        : request;
      const prompt = buildReplyPrompt({ ...ctx, files }, o.ask, o.asker, {
        template: o.template,
        focus: o.focus,
        slots: { request: retold, commands: commands.map((cmd) => `- \`${cmd}\``).join('\n') },
      });
      const result = await step('Make the change', () =>
        runAgent(
          prompt,
          {
            claude: o.claude,
            model: c.model,
            effort: c.effort,
            fallbackModel: c.autoModel ? FALLBACK[c.model] : undefined,
            maxTurns: c.maxTurns,
            timeoutMinutes: o.timeoutMinutes,
            cwd: o.cwd,
            env: o.env,
            commands,
            retry: last,
          },
          TASK_FORMAT,
        ).finally(endSandboxes),
      );
      const settled = await settle(result.reply.checks);
      const { changes, outside, unasked, failed } = settled;
      const untouched = sameChanges(changes, prepared);
      const didnt = last
        ? undefined
        : outside.length
          ? new NotWorked(`it changed ${outside.join(', ')}, which no finding names`, `It changed ${outside.join(', ')}, and a fix of these findings may change only the files they name.`)
          : unasked.length
            ? new NotWorked(`it changed ${unasked.join(', ')} unasked`, `It changed ${unasked.join(', ')}, which decide what runs on install and in CI, and the request didn't ask for that. Leave them as they are.`)
            : failed.length
              ? new NotWorked(`${failed.map((r) => r.command).join(', ')} failed`, failed.map((r) => `\`${r.command}\` failed:\n\n${r.output}`).join('\n\n'))
              : isFix && untouched
                ? new NotWorked('it changed nothing', 'It ended without changing any file, and the request needs a change.')
                : undefined;
      if (didnt) {
        didnt.spent = result;
        throw didnt;
      }
      return { ...settled, result };
    });
    const triaged = start && `${start.level}: ${start.reason}`;
    const spentOnTriage = (start && 'spent' in start && start.spent) || NO_SPEND;
    return { ...climbed.out, result: withSpent(withSpent(climbed.out.result, climbed.spent), spentOnTriage), choice: climbed.choice, tried: climbed.tried, triaged };
  }
}
