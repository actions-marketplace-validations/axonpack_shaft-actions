import * as core from '@actions/core';
import { DASHBOARD_URL } from '../consts/api.const';
import { matches, pick } from '../utils/auto-pick.util';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { pushDenial, type PushTarget, runsCode } from '../utils/push.util';
import { parseState, prose, redact, type StateFinding } from '../utils/render.util';
import { toolDenial } from '../utils/tool-guard.util';
import { type ReplyFormat, runAgent } from './agent.service';
import { fetchPushToken } from './api.service';
import { type CheckResult, repoCommands, runCheck } from './commands.service';
import { collectContext } from './context.service';
import { assertHead, head, pushChanges, readChanges } from './push.service';
import { ANSWER_MAX, answerFooter, buildReplyPrompt, postInThread, type ReplyOptions, type ReplyOutcome } from './reply.service';
import { FALLBACK } from './review.service';
import type { Ask } from './route.service';
import { endSandboxes, prepareSandbox } from './sandbox.service';
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

/** A reply's options, plus a bare `/fix`, the project's push mode and the repo's page on GitHub, for the commit link. */
export type TaskOptions = ReplyOptions & { bare: boolean; pushMode: string; repoUrl: string };
/**
 * A finished task, or one that stopped before its session: `push_failed` when nothing could be
 * pushed, `nothing_to_fix` for a bare `/fix` with no open findings, `sandbox_unavailable` when the
 * runner can't start the sandbox the commands run in.
 */
export type TaskOutcome = ReplyOutcome | { refused: string; code: 'push_failed' | 'nothing_to_fix' | 'sandbox_unavailable' };

/** The request: the comment, or for a bare `/fix` the open findings the last review's summary keeps. */
export function taskRequest(ask: Ask, findings: StateFinding[]): string {
  if (!findings.length) return ask.text;
  return `Fix these open findings from the last review (severity, place, title):\n\n${findings.map((f) => `- ${f.severity} \`${f.file}:${f.line}\` ${f.title}`).join('\n')}`;
}

/**
 * The checks our code runs after the session: the ones the model ran that the guard allows (no git
 * command), in its order, or when it ran none, the repo's install, test and lint.
 */
export function checkList(listed: string[], commands: string[], cwd: string): string[] {
  const ok = listed.map((c) => c.trim()).filter((c) => !c.startsWith('git ') && !toolDenial('Bash', { command: c }, cwd, commands));
  return ok.length ? [...new Set(ok)] : commands.filter((c) => / (ci|install)\b/.test(c) || /\b(test|lint)$/.test(c));
}

const checksTable = (checks: CheckResult[]) =>
  checks.length
    ? ['| Check | Result |', '| --- | --- |', ...checks.map((c) => `| \`${c.command}\` | ${c.passed ? 'Passed' : 'Failed'} |`)].join('\n')
    : 'No checks were run.';

/**
 * Make the change asked for, then commit it as the app's bot and push it to the pull request's
 * branch, and reply where it was asked with what changed, the commit and the checks. The model's
 * commands and the checks run in the sandbox, and nothing there holds a GitHub token: only once our
 * own run of the checks passes does our code ask the API for the push token, and push through
 * GitHub's API. A push the mode refuses (a fork's PR, the default branch, push mode Disabled) is
 * caught before the session, which then doesn't run, and so is a bare `/fix` with no open findings
 * and a runner that can't start the sandbox.
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
  const findings = o.bare ? (parseState(ctx.summary?.body)?.findings ?? []) : [];
  if (o.bare && !findings.length) {
    const why = ctx.summary ? 'The last review has no open findings to fix.' : "There's nothing to fix yet: comment `/review` first.";
    await post(`${why}\n\n${TASK_MARKER}`);
    return { refused: why, code: 'nothing_to_fix' };
  }
  const unsandboxed = await step('Start the sandbox', async () => prepareSandbox(o.cwd));
  if (unsandboxed) {
    await post(`${failureMarkdown(new ShaftFailure('sandbox_unavailable', unsandboxed))}\n\n${TASK_MARKER}`);
    return { refused: unsandboxed, code: 'sandbox_unavailable' };
  }
  const base = head(o.cwd);

  const commands = repoCommands(o.cwd);
  const choice = pick({ mode: 'task', model: o.model, effort: o.effort, maxTurns: o.maxTurns });
  core.info(`Making the change with ${choice.model}, effort ${choice.effort}. The repo's commands: ${commands.join(', ') || 'none'}`);
  const files = ctx.files.filter((f) => !matches(f.filename, o.skip));
  const prompt = buildReplyPrompt({ ...ctx, files }, o.ask, o.asker, {
    template: o.template,
    focus: o.focus,
    slots: { request: taskRequest(o.ask, findings), commands: commands.map((c) => `- \`${c}\``).join('\n') },
  });
  try {
    const result = await step('Make the change', () =>
      runAgent(
        prompt,
        {
          claude: o.claude,
          model: choice.model,
          effort: choice.effort,
          fallbackModel: choice.autoModel ? FALLBACK[choice.model] : undefined,
          maxTurns: choice.maxTurns,
          timeoutMinutes: o.timeoutMinutes,
          cwd: o.cwd,
          env: o.env,
          commands,
        },
        TASK_FORMAT,
      ).finally(endSandboxes),
    );
    const lines = [prose(result.reply.answer)];
    const changes = readChanges(o.cwd, base);
    if (changes.length) {
      const paths = changes.map((c) => c.path);
      const name = (f: string) => `\`${f.replace(/[`\r\n]/g, '')}\``;
      lines.push(`**Changed:** ${paths.map(name).join(', ')}`);
      const runs = runsCode(paths);
      if (runs.length) lines.push(`**Read before merging:** ${runs.map(name).join(', ')} decide${runs.length === 1 ? 's' : ''} what runs on install and in CI.`);
      const checks = await step('Run the checks', async () => checkList(result.reply.checks, commands, o.cwd).map((c) => runCheck(o.cwd, c, o.env)));
      const failed = checks.filter((c) => !c.passed);
      if (failed.length) {
        core.warning(`Nothing was pushed: ${failed.map((c) => c.command).join(', ')} failed.`);
        lines.push(`Nothing was pushed, because ${failed.length === 1 ? 'a check' : 'some checks'} failed.`);
      } else if (o.dryRun) lines.push('Nothing was pushed: this was a dry run.');
      else {
        assertHead(o.cwd, base);
        const { data: bot } = await o.octokit.rest.users.getByUsername({ username: o.bot });
        const message = redact(result.reply.commit_message.split('\n')[0]!.trim(), o.secrets).slice(0, 100) || 'Make the change asked for with /fix';
        const author = { name: o.bot, email: `${bot.id}+${o.bot}@users.noreply.github.com` };
        // The push token exists only from here on: asked for after the checks, and revoked by the push.
        const grant = await step('Get the push token', fetchPushToken);
        const sha = await step('Push the commit', () => pushChanges(grant.push_token, { owner: o.owner, repo: o.repo, branch: grant.branch, base, changes, message, author }));
        lines.push(`**Commit:** [\`${sha.slice(0, 7)}\`](${o.repoUrl}/commit/${sha}) on \`${grant.branch}\``);
      }
      lines.push(checksTable(checks));
      for (const c of failed)
        lines.push(`<details><summary>Output of <code>${c.command}</code></summary>\n\n\`\`\`\`\n${prose(c.output).replace(/`{4,}/g, '```')}\n\`\`\`\`\n\n</details>`);
    }
    const answer = redact(lines.join('\n\n'), o.secrets).slice(0, ANSWER_MAX);
    const { sub, model } = answerFooter(o, ctx.pr.headSha, choice, result);
    const commentUrl = await post(`${answer}\n\n${sub}\n\n${TASK_MARKER}`);
    return { model, effort: choice.effort, tokens: result.tokens, costUsd: result.costUsd, output: { answer, comment_url: commentUrl } };
  } catch (e) {
    // The person who asked sees the same card as the job summary, where they asked.
    if (e instanceof ShaftFailure) {
      e.url ??= o.runUrl;
      await post(`${failureMarkdown(e)}\n\n${TASK_MARKER}`);
    }
    throw e;
  }
}
