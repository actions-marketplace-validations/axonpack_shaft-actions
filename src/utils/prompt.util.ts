import { datamark } from '../injection/input.util';
import type { Comment } from '../services/context.service';
import { type ChangedFile, LOCKFILE, matches } from './auto-pick.util';

const MAX_DIFF = 200_000; // ponytail: a bigger diff is cut; the model reads the rest from the checkout

/** Snapshots, minified files and build output: their diffs are noise to a reviewer. */
const GENERATED = /\.snap$|\.min\.(js|css)$|(^|\/)dist\//;

/** The globs `.gitattributes` marks `linguist-generated` (not `=false`), as `matches` reads them. */
export function generatedGlobs(gitattributes: string | undefined): string[] {
  return (gitattributes ?? '').split('\n').flatMap((l) => {
    const [pattern, ...attrs] = l.trim().split(/\s+/);
    if (!pattern || pattern.startsWith('#') || !attrs.some((a) => a === 'linguist-generated' || a === 'linguist-generated=true')) return [];
    // Git matches a pattern without a slash (a trailing one aside) at any depth, and one with a slash from the root.
    const glob = pattern.replace(/\/$/, '');
    return [glob.includes('/') ? glob.replace(/^\//, '') : `**/${glob}`];
  });
}

/** Whether a file's diff is left out of the prompt: a lockfile, a snapshot, a minified or generated file. */
export const trimmed = (file: string, generated: string[] = []) => LOCKFILE.test(file) || GENERATED.test(file) || matches(file, generated) || matches(file, generated.map((g) => `${g}/**`));

/**
 * The diff as prompt text: each file's patch, marked `focus` when it matches those globs, cut at
 * `MAX_DIFF`. A trimmed file (lockfile, snapshot, generated) shows as one line with its counts.
 */
export function diffText(files: (ChangedFile & { status: string })[], focus: string[], generated: string[] = []): string {
  const diff = files
    .map((f) => {
      const head = `diff --git a/${f.filename} b/${f.filename} (${f.status}${matches(f.filename, focus) ? ', focus' : ''})`;
      if (trimmed(f.filename, generated)) return `${head}\n(left out: a lockfile or generated file, +${f.additions} -${f.deletions} lines; read it from the checkout if it matters)`;
      return `${head}\n${f.patch ?? '(no patch: binary or too large, read the file)'}`;
    })
    .join('\n');
  return diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n(the diff is cut here; read the remaining files from the checkout)` : diff;
}

/** The comments of people inside the repo as prompt text, one per line, with the line a review comment is on. */
export const trustedComments = (comments: Comment[]): string =>
  comments
    // Only people inside the repo reach the prompt: anyone else could write instructions aimed at the model.
    .filter((c) => c.trusted)
    .map((c) => `- ${c.author}${c.path ? ` on ${c.path}:${c.line ?? '?'}` : ''}: ${datamark(c.body.slice(0, 2000))}`)
    .join('\n');

/**
 * The dashboard's template with each `{{slot}}` filled, and nothing else changed. An empty value
 * reads `None.`. One pass with a function: a `$` in the data is never a replacement pattern, and a
 * `{{slot}}` in the data stays as written.
 */
export function fillSlots(template: string, slots: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (slot, name: string) => {
    if (!Object.hasOwn(slots, name)) return slot;
    const value = String(slots[name]);
    return value.trim() ? value : 'None.';
  });
}

/**
 * Text the model should read as data, never as instructions, inside `<tag>`: a finding's body, a
 * request to rate, why an earlier attempt failed. A closing tag in the text is taken out, so it can't
 * end the block early.
 */
export const dataBlock = (tag: string, text: string): string => `<${tag}>\n${text.replace(new RegExp(`</?${tag}\\b[^>]*>`, 'gi'), '')}\n</${tag}>`;
