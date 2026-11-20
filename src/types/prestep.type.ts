import type { Context } from '../services/context.service';
import type { Finding } from '../utils/render.util';

/** The checkout's files, as a script may read them. */
export type Checkout = {
  /** Paths, relative to the checkout, of the files matching any of the globs. */
  find: (globs: string[]) => string[];
  /** A file's text, or undefined when it isn't a regular file under the checkout or is over `max` bytes (1 MB by default). */
  read: (path: string, max?: number) => string | undefined;
};

/**
 * What a script reads: the diff (after `skip`), the pull request, the base branch's guides, the
 * checkout, and a file as the base branch has it (undefined when it has none).
 */
export type ScriptInput = Pick<Context, 'files' | 'pr' | 'guides'> & { checkout: Checkout; base: (path: string) => Promise<string | undefined> };

/** A script's finding; the checklist that ran the script fills in `step`. */
export type ScriptFinding = Omit<Finding, 'step'>;

/** A pre-step script: reads files only, never runs the repo's code and never calls the network. */
export type Script = (input: ScriptInput) => ScriptFinding[];

/** A pre-step that hands the model facts, as text, for a `script+model` checklist. */
export type Facts = (input: ScriptInput) => Promise<string>;
