import { parse } from 'yaml';
import { DEFAULT_SKIP, SETTING_DEFAULTS } from '../consts/settings.const';

export type Settings = Record<keyof typeof SETTING_DEFAULTS, string>;

/** What the repo's review rules file (`.github/shaft.yml`) can set. */
export type RepoConfig = { rules?: string; skip?: string[]; focus?: string[] };

/** What the review applies: the rules text, and the globs to leave out and to look at closely. */
export type ReviewRules = { rules: string; skip: string[]; focus: string[] };

/** Each field from the first that sets it: the input, then the dashboard, then the default. */
export function mergeSettings(input: (name: string) => string, dashboard: Record<string, unknown> = {}): Settings {
  const pick = (name: keyof Settings) => {
    const saved = dashboard[name];
    return input(name) || (typeof saved === 'string' && saved) || SETTING_DEFAULTS[name];
  };
  return { model: pick('model'), effort: pick('effort'), depth: pick('depth'), nits: pick('nits') };
}

const isGlobs = (v: unknown): v is string[] => Array.isArray(v) && v.every((g) => typeof g === 'string');

/** Parse the review rules file. Bad YAML or a wrong type throws; unknown keys come back so the caller can warn. */
export function parseConfig(text: string | undefined, path: string): { config: RepoConfig; unknown: string[] } {
  let doc: unknown;
  try {
    doc = parse(text ?? '') ?? {};
  } catch (e) {
    throw new Error(`${path} isn't valid YAML: ${(e as Error).message}`);
  }
  if (typeof doc !== 'object' || Array.isArray(doc)) throw new Error(`${path} must be a map with rules, skip and focus.`);
  const { rules, skip, focus, ...rest } = doc as Record<string, unknown>;
  if (rules != null && typeof rules !== 'string') throw new Error(`${path}: rules must be text.`);
  if (skip != null && !isGlobs(skip)) throw new Error(`${path}: skip must be a list of globs.`);
  if (focus != null && !isGlobs(focus)) throw new Error(`${path}: focus must be a list of globs.`);
  return { config: { rules: rules ?? undefined, skip: skip ?? undefined, focus: focus ?? undefined }, unknown: Object.keys(rest) };
}

/** A dashboard glob setting: a list, or text with one glob per line. Null, missing or blank means not set there. */
const globs = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.split('\n').map((g) => g.trim()).filter(Boolean) : isGlobs(v) ? v : undefined;

/**
 * `rules`: the dashboard's (already repo over account), then the file's, added together.
 * `skip` and `focus`: the dashboard, then the file, then the default. No input sets these.
 */
export function mergeRules(dashboard: Record<string, unknown> = {}, file: RepoConfig = {}): ReviewRules {
  return {
    rules: [dashboard.rules, file.rules].filter((r): r is string => typeof r === 'string' && !!r.trim()).join('\n\n'),
    skip: globs(dashboard.skip) ?? file.skip ?? DEFAULT_SKIP,
    focus: globs(dashboard.focus) ?? file.focus ?? [],
  };
}
