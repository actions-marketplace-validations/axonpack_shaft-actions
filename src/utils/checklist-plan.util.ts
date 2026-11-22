import type { Checklist } from '../services/api.service';
import { matches } from './auto-pick.util';

/** A checklist of the job with, when it doesn't run this time, why, and the changed files its `exclude` leaves out. */
export type Planned = Checklist & { skip?: string; leftOut?: string[] };

export const NO_MATCH = 'No matching files changed';
export const ONLY_EXCLUDED = 'Only files it leaves out changed';
export const NOT_YET = "This version of the action doesn't have this checklist's script yet";

/** A glob's `**` and `*` never match a name starting with a dot, so `.github/` and `.env` are tried without their dots too. */
const undot = (s: string) => s.replace(/(^|\/)\./g, '$1');
const touches = (file: string, paths: string[]) => matches(file, paths) || matches(undot(file), paths.map(undot));

/**
 * Which of the job's checklists run on the changed files (after `skip`), in the job's order. One whose
 * `paths` match no file is skipped, and so is one whose matching files all match its `exclude`; the
 * excluded ones of a checklist that runs are its `leftOut`. A script checklist whose `prestep` isn't one of `scripts` (the
 * ones the action has) is skipped; light ones run in the main pass until it has a light pass.
 */
export const planChecklists = (checklists: Checklist[], files: { filename: string }[], scripts: string[] = []): Planned[] =>
  checklists.map((c) => {
    const covered = files.filter((f) => touches(f.filename, c.paths)).map((f) => f.filename);
    const leftOut = c.exclude?.length ? covered.filter((f) => touches(f, c.exclude!)) : [];
    if (!covered.length) return { ...c, skip: NO_MATCH };
    if (leftOut.length === covered.length) return { ...c, skip: ONLY_EXCLUDED };
    if (c.mode === 'script' && !scripts.includes(c.prestep ?? '')) return { ...c, skip: NOT_YET };
    return leftOut.length ? { ...c, leftOut } : { ...c };
  });

/** A checklist's step, with the changed files its `exclude` leaves out, so the model doesn't report in them. */
const stepOf = (c: Checklist & { leftOut?: string[] }) =>
  c.leftOut?.length ? `${c.prompt}\n   - Leave these changed files out of this check: ${c.leftOut.map((f) => `\`${f}\``).join(', ')}.` : c.prompt;

/** What fills the open prompt's `{{steps}}`: the steps come after the run's data, so everything before them reads the same whatever runs. */
export const STEPS_AT_END = 'They are at the end of this prompt, under "The steps for this run".';

/** The steps for this run, numbered from 1: what always runs first, each checklist that runs, then what always runs last. */
export const stepsBlock = (before: string[], run: (Checklist & { leftOut?: string[] })[], after: string[]) =>
  `## The steps for this run\n\n${[...before, ...run.map(stepOf), ...after].map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`;
