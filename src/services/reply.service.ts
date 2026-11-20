import * as core from '@actions/core';
import { type Choice, matches, pick } from '../utils/auto-pick.util';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { diffText, fillSlots, trustedComments } from '../utils/prompt.util';
import { footer, prose, redact } from '../utils/render.util';
import { type AgentResult, type ReplyFormat, runAgent, type Tokens } from './agent.service';
import { type Context, collectContext } from './context.service';
import { chosenModels, FALLBACK, type ReviewOptions } from './review.service';
import type { Ask } from './route.service';
import { step } from './step.service';

/** The most of an answer that is posted and kept, as the Axon Shaft API takes it. */
export const ANSWER_MAX = 20_000;
/** Ends everything a reply posts. */
const REPLY_MARKER = '<!-- shaft:reply -->';

/** What the Reply prompt asks the model for: `answer`, in GitHub Markdown, never empty. */
export const ANSWER_FORMAT: ReplyFormat<string> = {
  name: 'reply',
  schema: { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } },
  parse: (x) => {
    const answer = (x as { answer?: unknown } | undefined)?.answer;
    return typeof answer === 'string' && answer.trim() ? answer : undefined;
  },
};

/** The review's options a reply uses too, the comment it answers, who asked, and the Reply prompt from the dashboard. */
export type ReplyOptions = Pick<
  ReviewOptions,
  'octokit' | 'claude' | 'secrets' | 'model' | 'effort' | 'maxTurns' | 'timeoutMinutes' | 'skip' | 'focus' | 'bot' | 'dryRun' | 'runUrl' | 'dashboardRunUrl' | 'cwd' | 'env'
> & { owner: string; repo: string; number: number; ask: Ask; asker: string; template: string };

export type ReplyOutcome = {
  model: string;
  effort: string;
  tokens: Tokens;
  costUsd: number;
  /** For the run's page on the dashboard: the answer as posted, and the comment it's in. */
  output: { answer: string; comment_url: string };
};

/**
 * The Reply prompt: the dashboard's template with the run's data in its slots. `ctx.files` is the
 * diff after `skip`. The question itself is left out of the comments, which it would repeat.
 */
export function buildReplyPrompt(ctx: Context, ask: Ask, asker: string, o: { template: string; focus: string[]; slots?: Record<string, string> }): string {
  const { pr } = ctx;
  // A file name can hold a backtick or a line break; neither may reach the prompt's own text.
  const path = ask.path?.replace(/[`\r\n]/g, '');
  return fillSlots(o.template, {
    repo: `${ctx.owner}/${ctx.repo}`,
    number: pr.number,
    head: pr.head,
    base: pr.base,
    sha: pr.headSha,
    place: path ? `on \`${path}\`${ask.line ? ` line ${ask.line}` : ''}` : "in the pull request's conversation",
    asker,
    question: ask.text,
    title: pr.title,
    author: pr.author,
    body: pr.body,
    commits: ctx.commits.map((m) => `- ${m}`).join('\n'),
    comments: trustedComments([...ctx.comments, ...ctx.reviewComments].filter((c) => c.id !== ask.id)),
    diff: diffText(ctx.files, o.focus),
    // A task's own: its request and the repo's commands.
    ...o.slots,
  });
}

/** Where an answer goes, and how it's posted. */
type Thread = Pick<ReplyOptions, 'octokit' | 'owner' | 'repo' | 'number' | 'ask' | 'dryRun' | 'secrets'>;

/**
 * Post `body`, redacted, where the comment was made: under the thread for a comment on a line, else
 * on the pull request. Its URL, or '' on a dry run, which only logs it.
 */
export async function postInThread(o: Thread, body: string): Promise<string> {
  if (o.dryRun) {
    core.info(`--- reply\n${body}`);
    return '';
  }
  const req = { owner: o.owner, repo: o.repo, body: redact(body, o.secrets) };
  const { data } = o.ask.thread
    ? await o.octokit.rest.pulls.createReplyForReviewComment({ ...req, pull_number: o.number, comment_id: o.ask.thread })
    : await o.octokit.rest.issues.createComment({ ...req, issue_number: o.number });
  return data.html_url;
}

/** The footer under an answer, and the model that answered, from the session's result. */
export function answerFooter(
  o: Pick<ReplyOptions, 'owner' | 'repo' | 'runUrl' | 'dashboardRunUrl' | 'claude'>,
  sha: string,
  choice: Choice,
  result: Pick<AgentResult<unknown>, 'models' | 'tokens' | 'costUsd'>,
): { sub: string; model: string } {
  const models = chosenModels(result.models, choice, false);
  const sub = footer({
    sha,
    repo: `${o.owner}/${o.repo}`,
    runUrl: o.runUrl,
    dashboardRunUrl: o.dashboardRunUrl,
    models: models.main + (models.fellBack ? ` (${choice.model} unavailable)` : ''),
    effort: choice.effort,
    reason: choice.reason,
    tokens: result.tokens,
    // On a subscription the SDK's price is only an estimate, so the footer weighs the tokens instead.
    costUsd: o.claude.kind === 'api_key' ? result.costUsd : undefined,
  });
  return { sub, model: models.main };
}

/**
 * Answer the question with read-only tools and post the answer where it was asked: under the thread
 * for a comment on a line, else on the pull request. A failure posts its card there too, then throws.
 */
export async function replyToComment(o: ReplyOptions): Promise<ReplyOutcome> {
  const ctx = await step('Read the pull request', () => collectContext(o.octokit, o.owner, o.repo, o.number, o.bot));
  const post = (body: string) => postInThread(o, body);
  const choice = pick({ mode: 'reply', model: o.model, effort: o.effort, maxTurns: o.maxTurns });
  core.info(`Answering with ${choice.model}, effort ${choice.effort}`);
  const files = ctx.files.filter((f) => !matches(f.filename, o.skip));
  let result;
  try {
    result = await step('Answer', () =>
      runAgent(
        buildReplyPrompt({ ...ctx, files }, o.ask, o.asker, { template: o.template, focus: o.focus }),
        {
          claude: o.claude,
          model: choice.model,
          effort: choice.effort,
          fallbackModel: choice.autoModel ? FALLBACK[choice.model] : undefined,
          maxTurns: choice.maxTurns,
          timeoutMinutes: o.timeoutMinutes,
          cwd: o.cwd,
          env: o.env,
        },
        ANSWER_FORMAT,
      ),
    );
  } catch (e) {
    // The asker sees the same card as the job summary, where they asked.
    if (e instanceof ShaftFailure) {
      e.url ??= o.runUrl;
      await post(`${failureMarkdown(e)}\n\n${REPLY_MARKER}`);
    }
    throw e;
  }
  const answer = redact(prose(result.reply), o.secrets).slice(0, ANSWER_MAX);
  const { sub, model } = answerFooter(o, ctx.pr.headSha, choice, result);
  const commentUrl = await post(`${answer}\n\n${sub}\n\n${REPLY_MARKER}`);
  return { model, effort: choice.effort, tokens: result.tokens, costUsd: result.costUsd, output: { answer, comment_url: commentUrl } };
}
