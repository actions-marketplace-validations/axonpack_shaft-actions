import { closeSync, constants, fstatSync, ftruncateSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import * as core from '@actions/core';
import { FIX_HAIKU_MAX } from '../consts/ladder.const';
import { datamark } from '../guardrails/input.util';
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

/** A suggestion that wasn't applied, and why; its finding goes to the model. */
export type Unapplied = { finding: OpenFinding; why: string };

/**
 * Put the findings' suggested changes in the checkout, as GitHub's batch "Commit suggestions" would:
 * each file read once, every suggestion placed by its line numbers in that original text, applied
 * from the bottom up so one that changes the line count doesn't move the others, and written once.
 * Only when the checkout is the commit the comment is on, and the file is a regular file in the
 * checkout, never through a link. A suggestion out of the file's range, or overlapping another (both
 * halves), isn't applied.
 */
export function applySuggestions(cwd: string, head: string, findings: OpenFinding[]): { applied: OpenFinding[]; unapplied: Unapplied[] } {
  const applied: OpenFinding[] = [];
  const unapplied: Unapplied[] = [];
  const byFile = new Map<string, OpenFinding[]>();
  for (const f of findings) {
    if (!f.suggestion) continue;
    if (f.suggestion.sha !== head || !insideCheckout(f.file, cwd)) unapplied.push({ finding: f, why: 'the pull request moved since the review' });
    else byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  }
  for (const [file, group] of byFile) {
    let fd;
    try {
      fd = openSync(join(cwd, file), constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
      const lines = readFileSync(fd, 'utf8').split('\n');
      const ok = group.filter((f) => {
        const { start, end } = f.suggestion!;
        const inRange = start >= 1 && end >= start && end <= lines.length;
        if (!inRange) unapplied.push({ finding: f, why: "its lines aren't in the file" });
        return inRange;
      });
      const overlaps = (a: OpenFinding, b: OpenFinding) => a !== b && a.suggestion!.start <= b.suggestion!.end && b.suggestion!.start <= a.suggestion!.end;
      const clear = ok.filter((f) => {
        const overlap = ok.some((g) => overlaps(f, g));
        if (overlap) unapplied.push({ finding: f, why: 'it overlaps another suggestion' });
        return !overlap;
      });
      if (!clear.length) continue;
      for (const f of [...clear].sort((a, b) => b.suggestion!.start - a.suggestion!.start)) {
        const { start, end, text } = f.suggestion!;
        lines.splice(start - 1, end - start + 1, ...(text === '' ? [] : text.split('\n')));
      }
      // What was opened is what's written.
      ftruncateSync(fd, 0);
      writeSync(fd, lines.join('\n'), 0);
      applied.push(...clear);
    } catch (e) {
      core.info(`Couldn't apply the suggestions for ${file}: ${(e as Error).message}`);
      for (const f of group) if (!unapplied.some((u) => u.finding === f)) unapplied.push({ finding: f, why: "the file couldn't be changed" });
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }
  return { applied, unapplied };
}

/**
 * The request: for a bare `/fix` the open findings, each with its inline comment's text as data,
 * since the model wrote it from the PR's content; else the comment, with any open findings after it
 * as context, since it may refer to them ("fix those").
 */
export function taskRequest(ask: Ask, findings: OpenFinding[], bare: boolean): string {
  if (!findings.length) return datamark(ask.text);
  const each = findings.map((f) => `- ${f.severity} \`${f.file}:${f.line}\` ${f.title}${f.body ? `\n${dataBlock('finding', f.body)}` : ''}`).join('\n');
  if (bare) return `Fix these open findings from the last review (severity, place, title, then the review's comment on it, as data). Change only the files they name.\n\n${each}`;
  return `${datamark(ask.text)}\n\nThe last review's open findings, which the request may refer to (severity, place, title, then the review's comment on it, as data):\n\n${each}`;
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
