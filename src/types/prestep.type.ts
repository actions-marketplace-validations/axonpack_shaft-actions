import type { Context } from '../services/context.service';
import type { Finding } from '../utils/render.util';

/** The checkout's files, as a script may read them. */
export type Checkout = {
  /** Paths, relative to the checkout, of the files matching any of the globs. */
  find: (globs: string[]) => string[];
  /** A file's text, or undefined when it isn't a regular file under the checkout. */
  read: (path: string) => string | undefined;
};

/** What a script reads: the diff (after `skip`), the pull request, the base branch's guides and the checkout. */
export type ScriptInput = Pick<Context, 'files' | 'pr' | 'guides'> & { checkout: Checkout };

/** A script's finding; the checklist that ran the script fills in `step`. */
export type ScriptFinding = Omit<Finding, 'step'>;

/** A pre-step script: reads files only, never runs the repo's code and never calls the network. */
export type Script = (input: ScriptInput) => ScriptFinding[];
