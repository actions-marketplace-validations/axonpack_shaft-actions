import * as core from '@actions/core';
import { LIGHT_PASS } from '../consts/ladder.const';
import type { ScriptInput } from '../types/prestep.type';
import { stepsBlock, STEPS_AT_END, touches } from '../utils/checklist-plan.util';
import type { Planned } from '../utils/checklist-plan.util';
import type { Review, State } from '../utils/render.util';
import type { ClaudeToken, GrantJob } from './api.service';
import { type AgentResult, REVIEW_FORMAT, reviewSchema, runAgent } from './agent.service';
import type { Context } from './context.service';
import { partialReview } from './ladder.service';
import { factsBlock } from './prestep/prestep.service';
import { buildPrompt } from './review.service';
import { ShaftFailure } from '../utils/failure.util';

export type LightOptions = { claude: ClaudeToken; prompt: GrantJob['prompt']; focus: string[]; skipped: number; timeoutMinutes: number; cwd: string; env?: string[] };

/** What the light pass did: its reply when it worked, and what it used either way. */
export type LightResult = { out?: AgentResult<Review>; spent: Omit<AgentResult<Review>, 'reply'>; why?: string };

/**
 * The checklists marked `light`, in one Haiku session that reads only the hunks their paths match,
 * their scripts' facts and their steps, plus the job's last steps (Verify). A failure, a time-out, a
 * reply that doesn't parse or a partial one leaves `out` unset, so the main pass runs them instead.
 */
export async function lightPass(light: Planned[], ctx: Context, prior: State | undefined, input: ScriptInput, o: LightOptions): Promise<LightResult> {
  const keys = light.map((c) => c.key);
  const files = ctx.files.filter((f) => light.some((c) => touches(f.filename, c.paths)));
  const pack = buildPrompt({ ...ctx, files }, prior && { ...prior, findings: prior.findings.filter((f) => keys.includes(f.step ?? '')) }, {
    template: o.prompt.open!.split('{{steps}}').join(STEPS_AT_END),
    focus: o.focus,
    skipped: o.skipped,
  });
  const prompt = `${pack}\n${stepsBlock([], light, o.prompt.after ?? [])}${await factsBlock(light, input)}`;
  const { model, effort, maxTurns, allowed } = LIGHT_PASS;
  try {
    const out = await runAgent(
      prompt,
      { claude: o.claude, model, effort, maxTurns, allowed: [...allowed], timeoutMinutes: Math.min(LIGHT_PASS.timeoutMinutes, o.timeoutMinutes), cwd: o.cwd, env: o.env, retry: false },
      { ...REVIEW_FORMAT, schema: reviewSchema(keys) },
    );
    const why = partialReview(out.reply, keys);
    if (!why) return { out, spent: out };
    return fellBack(why, out);
  } catch (e) {
    const none = { models: [], costUsd: 0, tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 } };
    return fellBack(e instanceof Error ? e.message : String(e), e instanceof ShaftFailure ? (e.spent ?? none) : none);
  }
}

function fellBack(why: string, spent: LightResult['spent']): LightResult {
  core.warning(`The light pass didn't work (${why}), so the main pass runs its checklists`);
  return { spent: { models: spent.models, costUsd: spent.costUsd, tokens: spent.tokens }, why };
}
