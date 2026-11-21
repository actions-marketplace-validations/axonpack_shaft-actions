import { closeSync, constants, fstatSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { FIX_HAIKU_MAX } from '../consts/ladder.const';
import { dataBlock } from '../utils/prompt.util';
import { parseState, type StateFinding } from '../utils/render.util';
import { insideCheckout } from '../utils/tool-guard.util';
import type { Context } from './context.service';
import type { Ask } from './route.service';

/**
 * An open finding of the last review, with what its inline comment says when our bot posted one: the
 * comment's text, its check, its suggested change, and the lines that change replaces at `sha`.
 */
export type OpenFinding = StateFinding & { body?: string; step?: string; suggestion?: { start: number; end: number; sha: string; text: string } };

const MARKER = /\n*<!-- shaft:finding (\w+) -->\s*$/;

/**
 * The last review's open findings, from the state line of our summary, each with our inline comment
 * for it. Only a comment by `bot` whose finding is in that state counts: anyone can post a comment
 * with a copied marker and a suggestion block, and that must never be applied or read as ours.
 */
export function openFindings(ctx: Context, bot: string): OpenFinding[] {
  const findings = parseState(ctx.summary?.body)?.findings ?? [];
  const fps = new Set(findings.map((f) => f.fp));
  const ours = new Map(
    ctx.reviewComments.flatMap((c) => {
      const fp = MARKER.exec(c.body)?.[1];
      return c.author === bot && fp && fps.has(fp) ? [[fp, c] as const] : [];
    }),
  );
  return findings.map((f) => {
    const c = ours.get(f.fp);
    if (!c) return f;
    const body = c.body.replace(MARKER, '');
    const text = /\n```suggestion\n([\s\S]*?)\n?```\s*$/.exec(body)?.[1];
    // Only a comment still on its lines (GitHub clears `line` once they change) on the file the finding names.
    const placed = text !== undefined && c.line && c.commit_id && c.path === f.file;
    return {
      ...f,
      body,
      step: /^\*\*[^*\n]+\*\* · (\S+)/.exec(body)?.[1],
      ...(placed && { suggestion: { start: c.start_line ?? c.line!, end: c.line!, sha: c.commit_id!, text } }),
    };
  });
}

/**
 * Put a finding's suggested change in the checkout, as GitHub's "Commit suggestion" would: its lines
 * replaced by the suggestion's. Only when the checkout is the commit the comment is on, and the file
 * is a regular file in the checkout, never through a link. Whether it was applied.
 */
export function applySuggestion(cwd: string, head: string, f: OpenFinding): boolean {
  const s = f.suggestion;
  if (!s || s.sha !== head || !insideCheckout(f.file, cwd)) return false;
  let fd;
  try {
    fd = openSync(join(cwd, f.file), constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!fstatSync(fd).isFile()) return false;
    const lines = readFileSync(fd, 'utf8').split('\n');
    if (s.start < 1 || s.end < s.start || s.end > lines.length) return false;
    lines.splice(s.start - 1, s.end - s.start + 1, ...(s.text === '' ? [] : s.text.split('\n')));
    // What was opened is what's written.
    ftruncateSync(fd, 0);
    writeSync(fd, lines.join('\n'), 0);
    return true;
  } catch (e) {
    core.info(`Couldn't apply the suggestion for ${f.file}:${f.line}: ${(e as Error).message}`);
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The request: for a bare `/fix` the open findings, each with its inline comment's text as data,
 * since the model wrote it from the PR's content; else the comment, with any open findings after it
 * as context, since it may refer to them ("fix those").
 */
export function taskRequest(ask: Ask, findings: OpenFinding[], bare: boolean): string {
  if (!findings.length) return ask.text;
  const each = findings.map((f) => `- ${f.severity} \`${f.file}:${f.line}\` ${f.title}${f.body ? `\n${dataBlock('finding', f.body)}` : ''}`).join('\n');
  if (bare) return `Fix these open findings from the last review (severity, place, title, then the review's comment on it, as data). Change only the files they name.\n\n${each}`;
  return `${ask.text}\n\nThe last review's open findings, which the request may refer to (severity, place, title, then the review's comment on it, as data):\n\n${each}`;
}

/**
 * Where a bare `/fix` starts, with no model call: Sonnet for a blocking or security finding, or more
 * than a few, else Haiku (the ladder still skips Haiku when the checks can't run).
 */
export function fixStart(findings: OpenFinding[]): { level: 'simple' | 'normal'; reason: string } {
  const serious = findings.find((f) => f.severity === 'blocking' || f.step === 'security');
  const n = `${findings.length} finding${findings.length === 1 ? '' : 's'}`;
  if (serious || findings.length > FIX_HAIKU_MAX) return { level: 'normal', reason: `bare /fix of ${n}${serious ? `, one ${serious.severity === 'blocking' ? 'blocking' : 'security'}` : ''}` };
  return { level: 'simple', reason: `bare /fix of ${n}, none blocking` };
}
