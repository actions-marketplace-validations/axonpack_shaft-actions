import { matchesGlob } from 'node:path';

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
};

export type PickInput = {
  mode: 'review' | 'task';
  depth?: string;
  files?: ChangedFile[];
  /** From `.github/shaft.yml` (Phase 3); empty until then. */
  focus?: string[];
  skip?: string[];
  model?: string;
  effort?: string;
};

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

function onlyComments(patch: string | undefined): boolean {
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

/** The `auto` model and effort table from the plan. The first row that matches wins. */
export function pick(input: PickInput): Choice {
  const files = (input.files ?? []).filter((f) => !matches(f.filename, input.skip ?? []));
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const size = `${lines} lines`;
  let row: Pick<Choice, 'model' | 'effort' | 'reason'>;

  const hot = files.find((f) => matches(f.filename, input.focus ?? []) || isSensitive(f));
  if (input.mode === 'task') row = { model: 'opus', effort: 'high', reason: 'task' };
  else if (hot) row = { model: 'opus', effort: 'high', reason: `${size}, touches ${hot.filename}` };
  else if (input.depth === 'deep') row = { model: 'opus', effort: 'high', reason: `${size}, deep` };
  else if (lines > 1000 || files.length > 30) row = { model: 'opus', effort: 'medium', reason: `${size}, ${files.length} files` };
  else if (files.length > 0 && files.every(isLight)) row = { model: 'haiku', effort: 'low', reason: `${size}, docs and config only` };
  else row = { model: 'sonnet', effort: 'medium', reason: size };

  const autoModel = !input.model || input.model === 'auto';
  const model = autoModel ? row.model : input.model!;
  return {
    ...row,
    model,
    effort: !input.effort || input.effort === 'auto' ? row.effort : input.effort,
    // deep: opus verifies, sonnet runs the subagents. A model the user set runs both.
    subagentModel: input.depth === 'deep' ? (autoModel ? 'sonnet' : model) : undefined,
    autoModel,
  };
}
