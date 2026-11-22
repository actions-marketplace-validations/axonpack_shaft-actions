import { matchesGlob } from 'node:path';
import { HAIKU_MAX_PROMPT_TOKENS, LADDER_EFFORT, LADDERS, REVIEW_SIZE_FLOOR } from '../consts/ladder.const';

export type ChangedFile = { filename: string; additions: number; deletions: number; patch?: string };

export type Choice = {
  model: string;
  effort: string;
  /** Shown in the summary footer, so a user sees why. */
  reason: string;
  /** Set for `depth: deep`: the model the subagents run on. */
  subagentModel?: string;
  /** True when `model` came from the table, so a fallback may apply. */
  autoModel: boolean;
  maxTurns: number;
};

export type PickInput = {
  mode: 'review' | 'reply' | 'task';
  depth?: string;
  files?: ChangedFile[];
  /** From the dashboard. */
  focus?: string[];
  skip?: string[];
  model?: string;
  effort?: string;
  /** From the dashboard; unset picks one from the diff's size. */
  maxTurns?: number;
  /** A bare `/fix`'s open findings left for the model, which size its turn cap. */
  findings?: number;
};

/** The turn cap when the dashboard sets none: the API's default, lower for a small diff. */
export const DEFAULT_MAX_TURNS = 30;
const TURNS_BY_LINES: [below: number, turns: number][] = [
  [100, 12],
  [500, 20],
];
/** A bare `/fix` of a few findings needs fewer turns. */
const TURNS_BY_FINDINGS: [below: number, turns: number][] = [
  [4, 12],
  [8, 20],
];

const SENSITIVE =
  /(^|\/)\.github\/workflows\/|(^|[/._-])(auth|oauth|authentication|authorization|crypto|cryptography|payments?|billing|migrations?)([/._-]|$)/i;
const DOCS = /\.(md|mdx|markdown|txt|rst|adoc)$|(^|\/)(LICENSE|COPYING|NOTICE)[^/]*$/i;
const LOCKFILE =
  /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|go\.sum|Podfile\.lock|pubspec\.lock)$/;
const CONFIG = /\.(json|jsonc|json5|ya?ml|toml|ini|cfg|conf)$|(^|\/)\.[^/]+$/i;
const COMMENT = /^(\/\/|\/\*|\*|#|<!--|--)/;

export const matches = (file: string, globs: string[]) => globs.some((g) => matchesGlob(file, g));

function isSensitive(f: ChangedFile): boolean {
  if (/(^|\/)package\.json$/.test(f.filename)) return f.patch === undefined || /ependencies"/.test(f.patch); // ponytail: a deps block in the hunk's context counts too
  return SENSITIVE.test(f.filename);
}

export function onlyComments(patch: string | undefined): boolean {
  if (!patch) return false;
  return patch
    .split('\n')
    .filter((l) => /^[+-]/.test(l))
    .every((l) => {
      const code = l.slice(1).trim();
      return code === '' || COMMENT.test(code);
    });
}

const isLight = (f: ChangedFile) =>
  DOCS.test(f.filename) || LOCKFILE.test(f.filename) || CONFIG.test(f.filename) || onlyComments(f.patch);

/** The changed files after `skip`, and the first focus or sensitive one. */
export function sizeUp(input: PickInput) {
  const files = (input.files ?? []).filter((f) => !matches(f.filename, input.skip ?? []));
  const hot = files.find((f) => matches(f.filename, input.focus ?? []) || isSensitive(f));
  return { files, hot, lines: files.reduce((n, f) => n + f.additions + f.deletions, 0) };
}

/** The `auto` model and effort table from the plan. The first row that matches wins. */
export function pick(input: PickInput): Choice {
  const { files, hot, lines } = sizeUp(input);
  const size = `${lines} lines`;
  let row: Pick<Choice, 'model' | 'effort' | 'reason'>;

  if (input.mode === 'task') row = { model: 'opus', effort: 'high', reason: 'task' };
  else if (input.mode === 'reply') row = { model: 'sonnet', effort: 'medium', reason: 'question' };
  else if (hot) row = { model: 'opus', effort: 'high', reason: `${size}, touches ${hot.filename}` };
  else if (input.depth === 'deep') row = { model: 'opus', effort: 'high', reason: `${size}, deep` };
  else if (lines > 1000 || files.length > 30) row = { model: 'opus', effort: 'medium', reason: `${size}, ${files.length} files` };
  else if (files.length > 0 && files.every(isLight)) row = { model: 'haiku', effort: 'low', reason: `${size}, docs and config only` };
  else row = { model: 'sonnet', effort: 'medium', reason: size };

  const autoModel = !input.model || input.model === 'auto';
  const model = autoModel ? row.model : input.model!;
  // A deep review's main session runs the passes and checks their findings, so it keeps the full cap.
  const sized =
    input.mode === 'review' && input.depth !== 'deep'
      ? TURNS_BY_LINES.find(([below]) => lines < below)?.[1]
      : input.mode === 'task' && input.findings && TURNS_BY_FINDINGS.find(([below]) => input.findings! < below)?.[1];
  const maxTurns = input.maxTurns ?? (sized || DEFAULT_MAX_TURNS);
  return {
    ...row,
    reason: input.maxTurns === undefined && sized ? `${row.reason}, up to ${sized} turns` : row.reason,
    maxTurns,
    model,
    effort: !input.effort || input.effort === 'auto' ? row.effort : input.effort,
    // deep: opus verifies, sonnet runs the subagents. A model the user set runs both.
    subagentModel: input.depth === 'deep' ? (autoModel ? 'sonnet' : model) : undefined,
    autoModel,
  };
}


/**
 * The choices to try, in order. With the model and effort both `auto`, a job climbs its ladder from
 * `LADDERS`, each rung at low effort, without Haiku when the prompt is too big for it. A model or
 * effort the user set, and a deep review, run `pick`'s one choice. A big review starts no lower than
 * `REVIEW_SIZE_FLOOR` says. `checked`: a task's checks can run
 * on this runner. `promptChars`: the prompt's length, at about 4 characters a token. `start`: the
 * model triage picked, which drops the rungs below it, never the last one.
 */
export function ladder(input: PickInput & { checked?: boolean; promptChars?: number; start?: string }): Choice[] {
  const first = pick(input);
  if (!first.autoModel || (input.effort && input.effort !== 'auto') || input.depth === 'deep') return [first];
  const { files, hot, lines } = sizeUp(input);
  const [key, why]: [keyof typeof LADDERS, string] =
    input.mode === 'task'
      ? input.checked === false
        ? ['taskUnchecked', "task, and the repo's checks can't run on this runner"]
        : ['task', 'task']
      : input.mode === 'reply'
        ? ['reply', 'question']
        : hot
          ? ['reviewHot', `${lines} lines, touches ${hot.filename}`]
          : files.length > 0 && files.every(isLight)
            ? ['reviewLight', `${lines} lines, docs and config only`]
            : ['review', `${lines} lines`];
  // ponytail: about 4 characters a token; count tokens if the cut-off ever matters to the dollar
  const big = (input.promptChars ?? 0) / 4 > HAIKU_MAX_PROMPT_TOKENS;
  const allowed: string[] = LADDERS[key].filter((m) => !(big && m === 'haiku'));
  let models = allowed.slice(Math.max(0, Math.min(allowed.indexOf(input.start ?? ''), allowed.length - 1)));
  const floor = input.mode === 'review' ? REVIEW_SIZE_FLOOR.find(([above]) => lines > above)?.[1] : undefined;
  if (floor) {
    const order = ['haiku', 'sonnet', 'opus'];
    const kept = models.filter((m) => order.indexOf(m) >= order.indexOf(floor));
    models = kept.length ? kept : [floor];
  }
  const reason = `${why}; auto tries ${models.join(', then ')} at ${LADDER_EFFORT} effort, moving up only when an attempt doesn't work`;
  return models.map((model) => ({ ...first, model, effort: LADDER_EFFORT, reason }));
}
