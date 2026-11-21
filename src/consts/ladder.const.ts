/**
 * The `auto` ladder for each job: the models tried in order, each at `LADDER_EFFORT`, moving up only
 * when an attempt doesn't work. A better model at low effort beats a smaller one at high effort. These
 * are the action's defaults until the API sends them in the grant.
 */
export const LADDERS = {
  /** A `/fix` whose checks can run, so a wrong fix is caught. */
  task: ['haiku', 'sonnet', 'opus'],
  /** A `/fix` whose checks can't run on the runner: nothing would catch a wrong fix from Haiku. */
  taskUnchecked: ['sonnet', 'opus'],
  reply: ['haiku', 'sonnet', 'opus'],
  /** A review of docs and config only. */
  reviewLight: ['haiku', 'sonnet'],
  review: ['sonnet', 'opus'],
  /** A review that touches a focus or sensitive file. */
  reviewHot: ['opus'],
} as const;

export const LADDER_EFFORT = 'low';

/** The rung a triage level starts at, never below the job's ladder: a `/ask` or `/fix <words>` asks Haiku for the level first. */
export const TRIAGE_START = { simple: 'haiku', normal: 'sonnet', hard: 'opus' } as const;
export type TriageLevel = keyof typeof TRIAGE_START;

/** A bare `/fix` starts at Sonnet with a blocking or security finding, or more than this many. */
export const FIX_HAIKU_MAX = 5;

/** Past this many prompt tokens Haiku costs more than the models above it, so the ladder skips it. */
export const HAIKU_MAX_PROMPT_TOKENS = 100_000;
