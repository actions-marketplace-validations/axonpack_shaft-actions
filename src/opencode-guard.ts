import { writeFileSync } from 'node:fs';
import { fatalRetry, type GuardOptions, opencodeDenial } from './utils/opencode-guard.util';
import { setGuardrails } from './utils/guardrails.util';

// The OpenCode plugin that checks every tool call, built into dist/opencode-guard.js and shipped in
// the release: OpenCode loads it from the path the action writes in the run's config, never from the
// network. It only exports this one function, as OpenCode's plugin loader expects.

/**
 * Write the marker the action checks after the run, then refuse every call `opencodeDenial` refuses.
 * A retry OpenCode would wait out (a usage limit) is written to `stop`, and the action ends the run.
 */
export const ShaftGuard = async (_input: unknown, options: GuardOptions) => {
  setGuardrails(options.guardrails);
  writeFileSync(options.marker, '');
  return {
    event: async ({ event }: { event: unknown }) => {
      const why = fatalRetry(event);
      if (why && options.stop) writeFileSync(options.stop, why);
    },
    'tool.execute.before': async (input: { tool: string }, output: { args: Record<string, unknown> }) => {
      const why = opencodeDenial(input.tool, output.args ?? {}, options);
      if (why) throw new Error(why);
    },
  };
};
