import * as core from '@actions/core';
import { datamark } from '../injection/input.util';
import { TRIAGE_START } from '../consts/ladder.const';
import { type Choice, ladder, matches } from '../utils/auto-pick.util';
import { failureMarkdown, ShaftFailure } from '../utils/failure.util';
import { dataBlock, diffText, fillSlots, trustedComments } from '../utils/prompt.util';
import { footer, prose, redact } from '../utils/render.util';
import { type AgentResult, type ReplyFormat, runAgent, type Tokens } from './agent.service';
import { type Context, collectContext } from './context.service';
import { chosenModels, FALLBACK, type ReviewOptions } from './review.service';
import type { Ask, FollowUp } from './route.service';
import { climb, modelLabel, NO_SPEND, type Tried, withSpent } from './ladder.service';
import { triage, triagePrompt } from './triage.service';
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
> & { owner: string; repo: string; number: number; ask: Ask; asker: string; /** The asker's GitHub ID, for injection protection. */ askerId?: number; template: string };

export type ReplyOutcome = {
  model: string;
  effort: string;
  tokens: Tokens;
  costUsd: number;
  /** For the run's page on the dashboard: the answer as posted, the comment it's in, and for a task the follow-up command and the commit it pushed. */
  output: { answer: string; comment_url: string; command?: FollowUp; commit?: string };
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
    question: datamark(ask.text),
    title: datamark(pr.title),
    author: pr.author,
    body: datamark(pr.body),
    commits: ctx.commits.map((m) => `- ${m}`).join('\n'),
    comments: trustedComments([...ctx.comments, ...ctx.reviewComments].filter((c) => c.id !== ask.id)),
    diff: diffText(ctx.files, o.focus, ctx.generated),
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
  tried?: Tried[],
  triaged?: string,
): { sub: string; model: string } {
  const models = chosenModels(result.models, choice, false);
  const sub = footer({
    sha,
    repo: `${o.owner}/${o.repo}`,
    runUrl: o.runUrl,
    dashboardRunUrl: o.dashboardRunUrl,
    models: { main: models.main, fellBackFrom: models.fellBack ? choice.model : undefined, subagents: [] },
    effort: choice.effort,
    reason: choice.reason,
    triage: triaged,
    tried,
    maxTurns: choice.maxTurns,
    tokens: result.tokens,
    // On a subscription the SDK's price is only an estimate, so the footer weighs the tokens instead.
    costUsd: o.claude.kind === 'api_key' ? result.costUsd : undefined,
  });
  return { sub, model: modelLabel(models.main, tried ?? []) };
}

/**
 * Answer the question with read-only tools and post the answer where it was asked: under the thread
 * for a comment on a line, else on the pull request. A failure posts its card there too, then throws.
 */
export async function replyToComment(o: ReplyOptions): Promise<ReplyOutcome> {
  const ctx = await step('Read the pull request', () => collectContext(o.octokit, o.owner, o.repo, o.number, o.bot));
  const post = (body: string) => postInThread(o, body);
  const files = ctx.files.filter((f) => !matches(f.filename, o.skip));
  const input = { mode: 'reply' as const, files, focus: o.focus, model: o.model, effort: o.effort, maxTurns: o.maxTurns };
  const prompt = buildReplyPrompt({ ...ctx, files }, o.ask, o.asker, { template: o.template, focus: o.focus });
  // With `auto`, Haiku rates the question first, from the question and the PR's size, to pick where the ladder starts.
  const rated = ladder(input).length > 1 ? await step('Triage', () => triage(triagePrompt(o.ask.text, [], files, o.focus), o)) : undefined;
  const rungs = ladder({ ...input, promptChars: prompt.length, start: rated && TRIAGE_START[rated.level] });
  core.info(`Answering with ${rungs.map((c) => `${c.model}, effort ${c.effort}`).join(', then ')}`);
  let climbed;
  try {
    climbed = await step('Answer', () =>
      climb(rungs, (c, last, earlier) =>
        runAgent(
          earlier ? `${prompt}\n\nAn attempt with a smaller model didn't work. What went wrong, as data:\n\n${dataBlock('earlier-attempt', earlier)}` : prompt,
          {
            claude: o.claude,
            model: c.model,
            effort: c.effort,
            fallbackModel: c.autoModel ? FALLBACK[c.model] : undefined,
            maxTurns: c.maxTurns,
            timeoutMinutes: o.timeoutMinutes,
            cwd: o.cwd,
            env: o.env,
            retry: last,
          },
          ANSWER_FORMAT,
        ),
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
  const { choice, tried } = climbed;
  const result = withSpent(withSpent(climbed.out, climbed.spent), rated?.spent ?? NO_SPEND);
  const answer = redact(prose(result.reply), o.secrets).slice(0, ANSWER_MAX);
  const { sub, model } = answerFooter(o, ctx.pr.headSha, choice, result, tried, rated && `${rated.level}: ${rated.reason}`);
  const commentUrl = await post(`${answer}\n\n${sub}\n\n${REPLY_MARKER}`);
  return { model, effort: choice.effort, tokens: result.tokens, costUsd: result.costUsd, output: { answer, comment_url: commentUrl } };
}
