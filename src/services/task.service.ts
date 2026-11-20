import { execFileSync } from 'node:child_process';
import * as core from '@actions/core';
import { DASHBOARD_URL } from '../consts/api.const';
import { matches, pick } from '../utils/auto-pick.util';
import { runnerEnv } from '../utils/env.util';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { pushDenial, type PushTarget } from '../utils/push.util';
import { parseState, prose, redact, type StateFinding } from '../utils/render.util';
import { toolDenial } from '../utils/tool-guard.util';
import { type ReplyFormat, runAgent } from './agent.service';
import { type CheckResult, repoCommands, runCheck } from './commands.service';
import { collectContext } from './context.service';
import { pushBranch } from './push.service';
import { ANSWER_MAX, answerFooter, buildReplyPrompt, postInThread, type ReplyOptions, type ReplyOutcome } from './reply.service';
import { FALLBACK } from './review.service';
import type { Ask } from './route.service';
import { step } from './step.service';

/** Ends everything a task posts. */
const TASK_MARKER = '<!-- shaft:task -->';
// ponytail: the push token lasts an hour from the grant, so the session gets at most 40 minutes of
// it; a longer task needs a second grant call at push time.
const TASK_MINUTES = 40;

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
 * A reply's options, plus a bare `/fix`, the project's push mode, the push token (none when the API
 * minted none) and the repo's page on GitHub, which the push and the commit link use.
 */
export type TaskOptions = ReplyOptions & { bare: boolean; pushMode: string; pushToken?: string; repoUrl: string };
/**
 * A finished task, or one that stopped before its session: `push_failed` when nothing could be
 * pushed, `nothing_to_fix` for a bare `/fix` with no open findings.
 */
export type TaskOutcome = ReplyOutcome | { refused: string; code: 'push_failed' | 'nothing_to_fix' };

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

/** git in the model's checkout: its hooks and file monitor off, and only the allowlisted environment, so nothing it left behind runs with a token. */
const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: runnerEnv(), encoding: 'utf8', stdio: 'pipe' });

/** The files the session changed, added or deleted. */
export const changedFiles = (cwd: string): string[] =>
  git(cwd, ['status', '--porcelain', '-z', '--untracked-files=all'])
    .split('\0')
    .filter(Boolean)
    .map((l) => l.slice(3));

const checksTable = (checks: CheckResult[]) =>
  checks.length
    ? ['| Check | Result |', '| --- | --- |', ...checks.map((c) => `| \`${c.command}\` | ${c.passed ? 'Passed' : 'Failed'} |`)].join('\n')
    : 'No checks were run.';

/**
 * Make the change asked for, then commit it as the app's bot and push it to the pull request's
 * branch, and reply where it was asked with what changed, the commit and the checks. The model
 * never holds a GitHub token: our code commits and pushes after its session has ended, and only when
 * our own run of the checks passes. A push the mode refuses (a fork's PR, the default branch, push
 * mode Disabled) is caught before the session, which then doesn't run, and so is a bare `/fix` with
 * no open findings.
 */
export async function runTask(o: TaskOptions): Promise<TaskOutcome> {
  const ctx = await step('Read the pull request', () => collectContext(o.octokit, o.owner, o.repo, o.number, o.bot));
  const post = (body: string) => postInThread(o, body);
  const target: PushTarget = { branch: ctx.pr.head, pullBranch: ctx.pr.head, defaultBranch: ctx.pr.defaultBranch, fork: ctx.pr.fork };
  const refused =
    pushDenial(o.pushMode, target) ?? (o.pushToken ? undefined : "The Axon Shaft API sent no push token. Check the project's Push mode on the dashboard.");
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
          timeoutMinutes: Math.min(o.timeoutMinutes, TASK_MINUTES),
          cwd: o.cwd,
          env: o.env,
          commands,
        },
        TASK_FORMAT,
      ),
    );
    const lines = [prose(result.reply.answer)];
    const changed = changedFiles(o.cwd);
    if (changed.length) {
      lines.push(`**Changed:** ${changed.map((f) => `\`${f.replace(/[`\r\n]/g, '')}\``).join(', ')}`);
      let sha = '';
      if (!o.dryRun) {
        const { data: bot } = await o.octokit.rest.users.getByUsername({ username: o.bot });
        const message = redact(result.reply.commit_message.split('\n')[0]!.trim(), o.secrets).slice(0, 100) || 'Make the change asked for with /fix';
        const who = ['-c', `user.name=${o.bot}`, '-c', `user.email=${bot.id}+${o.bot}@users.noreply.github.com`, '-c', 'commit.gpgsign=false'];
        git(o.cwd, ['add', '--all']);
        git(o.cwd, [...who, 'commit', '--quiet', '--no-verify', '-m', message]);
        sha = git(o.cwd, ['rev-parse', 'HEAD']).trim();
      }
      const checks = await step('Run the checks', async () => checkList(result.reply.checks, commands, o.cwd).map((c) => runCheck(o.cwd, c, o.env)));
      const failed = checks.filter((c) => !c.passed);
      if (failed.length) {
        core.warning(`Nothing was pushed: ${failed.map((c) => c.command).join(', ')} failed.`);
        lines.push(`Nothing was pushed, because ${failed.length === 1 ? 'a check' : 'some checks'} failed.`);
      } else if (o.dryRun) lines.push('Nothing was pushed: this was a dry run.');
      else {
        // A check is the repo's code: it may not move HEAD off the commit our code made.
        if (git(o.cwd, ['rev-parse', 'HEAD']).trim() !== sha) throw new ShaftFailure('push_failed', 'A check changed the commit after it was made, so nothing was pushed.');
        await step('Push the commit', async () => pushBranch(o.cwd, o.pushToken!, o.pushMode, target, `${o.repoUrl}.git`));
        lines.push(`**Commit:** [\`${sha.slice(0, 7)}\`](${o.repoUrl}/commit/${sha}) on \`${target.branch}\``);
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
