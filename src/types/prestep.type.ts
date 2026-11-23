import type { Context } from '../services/context.service';
import type { Finding } from '../utils/render.util';
import type { Octokit } from './octokit.type';

/** The checkout's files, as a script may read them. */
export type Checkout = {
  /** Paths, relative to the checkout, of the files matching any of the globs. */
  find: (globs: string[]) => string[];
  /** A file's text, or undefined when it isn't a regular file under the checkout or is over `max` bytes (1 MB by default). */
  read: (path: string, max?: number) => string | undefined;
  /** A regular file's size in bytes, or undefined when it isn't one under the checkout. */
  size: (path: string) => number | undefined;
};

/**
 * What a script reads: the diff (after `skip`), the pull request, the base branch's guides, the
 * checkout, a file as the base branch has it (undefined when it has none), and the run's GitHub client.
 */
export type ScriptInput = Pick<Context, 'files' | 'pr' | 'guides'> & { checkout: Checkout; base: (path: string) => Promise<string | undefined>; octokit: Octokit };

/** A script's finding; the checklist that ran the script fills in `step`. */
export type ScriptFinding = Omit<Finding, 'step'>;

/**
 * A pre-step script: reads files only, never runs the repo's code and never calls the network. `data`
 * is its checklist's settings from the API (thresholds, globs), plain values the script checks itself.
 */
export type Script = (input: ScriptInput, data?: Record<string, unknown>) => ScriptFinding[];

/** A pre-step script that calls the network (`osv`, `licences`, `code-quality`): the Axon Shaft API, and for `osv` on an older API osv.dev, for public packages only. */
export type NetworkScript = (input: ScriptInput) => Promise<ScriptFinding[]>;

/** A pre-step that hands the model facts, as text, for a `script+model` checklist. */
export type Facts = (input: ScriptInput) => Promise<string>;
