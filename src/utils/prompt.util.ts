import type { Comment } from '../services/context.service';
import { type ChangedFile, matches } from './auto-pick.util';

const MAX_DIFF = 200_000; // ponytail: a bigger diff is cut; the model reads the rest from the checkout

/** The diff as prompt text: each file's patch, marked `focus` when it matches those globs, cut at `MAX_DIFF`. */
export function diffText(files: (ChangedFile & { status: string })[], focus: string[]): string {
  const diff = files
    .map(
      (f) =>
        `diff --git a/${f.filename} b/${f.filename} (${f.status}${matches(f.filename, focus) ? ', focus' : ''})\n${f.patch ?? '(no patch: binary or too large, read the file)'}`,
    )
    .join('\n');
  return diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n(the diff is cut here; read the remaining files from the checkout)` : diff;
}

/** The comments of people inside the repo as prompt text, one per line, with the line a review comment is on. */
export const trustedComments = (comments: Comment[]): string =>
  comments
    // Only people inside the repo reach the prompt: anyone else could write instructions aimed at the model.
    .filter((c) => c.trusted)
    .map((c) => `- ${c.author}${c.path ? ` on ${c.path}:${c.line ?? '?'}` : ''}: ${c.body.slice(0, 2000)}`)
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
