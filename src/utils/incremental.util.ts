import { createHash } from 'node:crypto';
import { ACTION_VERSION } from '../consts/api.const';
import { SUMMARY_MARKER, type State } from './render.util';

const hash = (text: string, n: number) => createHash('sha256').update(text).digest('hex').slice(0, n);

/** ponytail: past this many files the state keeps no hashes (the comment has 65,536 characters), so the next push reviews in full. */
export const HASHED_FILES_MAX = 300;

/**
 * A file's diff hash, like `git patch-id`: the patch without its hunks' line numbers, so the same
 * change on a new base (a rebase) hashes the same. A file with no patch (binary, too large) has none,
 * so it always counts as changed.
 */
export const diffHash = (patch: string | undefined) => (patch === undefined ? undefined : hash(patch.replace(/^@@ [^@]* @@/gm, '@@'), 10));

/** Each file's diff hash, or none past `HASHED_FILES_MAX`. */
export function diffHashes(files: { filename: string; patch?: string }[]): Record<string, string> | undefined {
  if (files.length > HASHED_FILES_MAX) return;
  return Object.fromEntries(files.flatMap((f) => (diffHash(f.patch) ? [[f.filename, diffHash(f.patch)!]] : [])));
}

/** A hash of everything from the dashboard and the action that shapes a review: any change to it means a full review. */
export const configHash = (settings: unknown) => hash(JSON.stringify([ACTION_VERSION, settings]), 10);

/**
 * The files changed since the last review: added, changed or removed since its hashes. Undefined
 * when the last review can't be built on (an older action wrote it, the settings changed, or it
 * kept no hashes), which means a full review.
 */
export function changedSince(prior: State | undefined, hashes: Record<string, string> | undefined, config: string): string[] | undefined {
  if (!prior?.files || !prior.checked || prior.config !== config || !hashes) return;
  const was = prior.files;
  return [...new Set([...Object.keys(hashes), ...Object.keys(was)])].filter((f) => hashes[f] !== was[f] || !(f in hashes));
}

const NOTE = /^Nothing changed since the last review[^\n]*\n\n/m;

/** The summary with a line under its marker saying `sha` changed nothing, in place of any earlier one. */
export function nothingChangedNote(body: string, sha: string): string {
  const rest = body.replace(NOTE, '').slice(SUMMARY_MARKER.length).replace(/^\n/, '');
  return `${SUMMARY_MARKER}\nNothing changed since the last review, so \`${sha.slice(0, 7)}\` got no model call. The review below still holds.\n\n${rest}`;
}
