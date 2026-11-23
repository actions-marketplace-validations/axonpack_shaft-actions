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

/**
 * A review of more changed lines (after `skip`) than a row's starts at that row's model or above, on
 * any review ladder. The first row that matches wins.
 */
export const REVIEW_SIZE_FLOOR: [above: number, model: 'opus' | 'sonnet'][] = [
  [2000, 'opus'],
  [400, 'sonnet'],
];

/**
 * A review attempt below the last rung is partial, and moves up a rung, when more than this share of
 * the checklists it should run come back not checked, when the model says it only partly reviewed the
 * diff, or when its confidence is under `REVIEW_MIN_CONFIDENCE`.
 */
export const PARTIAL_SHARE = 1 / 3;
export const REVIEW_MIN_CONFIDENCE = 60;

/** The rung a triage level starts at, never below the job's ladder: a `/ask` or `/fix <words>` asks Haiku for the level first. */
export const TRIAGE_START = { simple: 'haiku', normal: 'sonnet', hard: 'opus' } as const;
export type TriageLevel = keyof typeof TRIAGE_START;

/** A bare `/fix` starts at Sonnet with a blocking or security finding, or more than this many. */
export const FIX_HAIKU_MAX = 5;

/** Past this many prompt tokens Haiku costs more than the models above it, so the ladder skips it. */
export const HAIKU_MAX_PROMPT_TOKENS = 100_000;

/**
 * The review's light pass: the checklists marked `light`, on Haiku with only their facts and hunks,
 * Read and Grep, and a short turn cap. Its time limit is the job's, up to `timeoutMinutes`.
 */
export const LIGHT_PASS = { model: 'haiku', effort: 'low', maxTurns: 6, timeoutMinutes: 5, allowed: ['Read', 'Grep'] } as const;
