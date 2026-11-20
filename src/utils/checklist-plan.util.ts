import type { Checklist } from '../services/api.service';
import { matches } from './auto-pick.util';

/** A checklist of the job with, when it doesn't run this time, why. */
export type Planned = Checklist & { skip?: string };

export const NO_MATCH = 'No matching files changed';
export const NOT_YET = "This version of the action doesn't have this checklist's script yet";

/** A glob's `**` and `*` never match a name starting with a dot, so `.github/` and `.env` are tried without their dots too. */
const undot = (s: string) => s.replace(/(^|\/)\./g, '$1');
const touches = (file: string, paths: string[]) => matches(file, paths) || matches(undot(file), paths.map(undot));

/**
 * Which of the job's checklists run on the changed files (after `skip`), in the job's order. One whose
 * `paths` match no file is skipped. A script checklist whose `prestep` isn't one of `scripts` (the
 * ones the action has) is skipped; light ones run in the main pass until it has a light pass.
 */
export const planChecklists = (checklists: Checklist[], files: { filename: string }[], scripts: string[] = []): Planned[] =>
  checklists.map((c) =>
    !files.some((f) => touches(f.filename, c.paths))
      ? { ...c, skip: NO_MATCH }
      : c.mode === 'script' && !scripts.includes(c.prestep ?? '')
        ? { ...c, skip: NOT_YET }
        : c,
  );

/** What fills the open prompt's `{{steps}}`: the steps come after the run's data, so everything before them reads the same whatever runs. */
export const STEPS_AT_END = 'They are at the end of this prompt, under "The steps for this run".';

/** The steps for this run, numbered from 1: what always runs first, each checklist that runs, then what always runs last. */
export const stepsBlock = (before: string[], run: Checklist[], after: string[]) =>
  `## The steps for this run\n\n${[...before, ...run.map((c) => c.prompt), ...after].map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`;
