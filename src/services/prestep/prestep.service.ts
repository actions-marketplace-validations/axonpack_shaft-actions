import * as core from '@actions/core';
import type { Checklist } from '../api.service';
import type { Facts, NetworkScript, Script, ScriptInput } from '../../types/prestep.type';
import type { Planned } from '../../utils/checklist-plan.util';
import type { Finding } from '../../utils/render.util';
import { depsDiffFacts } from './deps-diff.service';
import { envVars } from './env-vars.service';
import { osv } from './osv.service';
import { prMeta } from './pr-meta.service';
import { schemaPairs } from './schema-pairs.service';
import { secrets } from './secrets.service';
import { callers } from './callers.service';
import { unused } from './unused.service';
import { imports } from './imports.service';

/** The pre-step scripts built into the action, by the `prestep` key the API sends. */
export const SCRIPTS: Record<string, Script | NetworkScript> = { secrets, 'pr-meta': prMeta, 'env-vars': envVars, 'schema-pairs': schemaPairs, osv };

/** The pre-steps that hand the model facts for `script+model` checklists, by `prestep` key. */
export const FACTS: Record<string, Facts> = {
  'deps-diff': depsDiffFacts,
  callers,
  unused,
  imports,
};

/**
 * The findings of each script checklist, under its key. Every checklist passed here has its script in
 * `SCRIPTS`. One whose script throws (it couldn't check what it should) gets the error's message as
 * its `skip`, so it shows as not checked, never as passed.
 */
export async function runScripts(run: Planned[], input: ScriptInput): Promise<Finding[]> {
  const found = await Promise.all(
    run.map(async (c) => {
      try {
        return (await SCRIPTS[c.prestep!]!(input)).map((f) => ({ ...f, step: c.key }));
      } catch (e) {
        c.skip = e instanceof Error ? e.message : String(e);
        core.warning(`${c.name} wasn't checked: ${c.skip}`);
        return [];
      }
    }),
  );
  return found.flat();
}

/**
 * The facts for the `script+model` checklists that run, after the steps: each pre-step once, under
 * the checklists that use it. A pre-step that fails says so in its place, and its checklists still run.
 */
export async function factsBlock(run: Checklist[], input: ScriptInput): Promise<string> {
  const keys = [...new Set(run.filter((c) => c.mode === 'script+model' && c.prestep && FACTS[c.prestep]).map((c) => c.prestep!))];
  const parts = await Promise.all(
    keys.map(async (k) => {
      const facts = await FACTS[k]!(input).catch((e: Error) => `Not available: ${e.message}`);
      return `### ${k}, for ${run.filter((c) => c.prestep === k).map((c) => c.key).join(', ')}\n\n${facts}`;
    }),
  );
  return parts.length ? `\n## Facts from the pre-steps\n\n${parts.join('\n\n')}\n` : '';
}
