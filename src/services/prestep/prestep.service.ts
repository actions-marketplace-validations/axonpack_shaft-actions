import * as core from '@actions/core';
import type { Checklist } from '../api.service';
import type { Facts, NetworkScript, Script, ScriptInput } from '../../types/prestep.type';
import type { Planned } from '../../utils/checklist-plan.util';
import type { Finding } from '../../utils/render.util';
import { depsDiffFacts } from './deps-diff.service';
import { envVars } from './env-vars.service';
import { osv } from './osv.service';
import { licences } from './licences.service';
import { prMeta } from './pr-meta.service';
import { schemaPairs } from './schema-pairs.service';
import { secrets } from './secrets.service';
import { changeset } from './changeset.service';
import { codeQuality } from './code-quality.service';
import { diffStats } from './diff-stats.service';
import { docsTouched } from './docs-touched.service';
import { flags } from './flags.service';
import { logLines } from './log-lines.service';
import { newFiles } from './new-files.service';
import { testPairs } from './test-pairs.service';
import { typeEscapes } from './type-escapes.service';
import { callers } from './callers.service';
import { unused } from './unused.service';
import { imports } from './imports.service';
import { exportsDiff } from './exports-diff.service';
import { routes } from './routes.service';
import { localeKeys } from './locale-keys.service';
import { rawValues } from './raw-values.service';
import { nativeChanges } from './native-changes.service';
import { actionlint } from './actionlint.service';
import { hadolint } from './hadolint.service';
import { migrationLint } from './migration-lint.service';
import { tflint } from './tflint.service';
import { contractDiff } from './contract-diff.service';
import { focusedTests } from './focused-tests.service';
import { largeFiles } from './large-files.service';
import { installHooks } from './install-hooks.service';
import { debugOutput } from './debug-output.service';
import { todoRefs } from './todo-refs.service';
import { licenceHeader } from './licence-header.service';
import { docLinks } from './doc-links.service';
import { commitFormat } from './commit-format.service';
import { migrationDown } from './migration-down.service';
import { sqlStrings } from './sql-strings.service';

/** The pre-step scripts built into the action, by the `prestep` key the API sends. */
export const SCRIPTS: Record<string, Script | NetworkScript> = {
  secrets,
  'pr-meta': prMeta,
  'env-vars': envVars,
  'schema-pairs': schemaPairs,
  osv,
  licences,
  'code-quality': codeQuality,
  'focused-tests': focusedTests,
  'large-files': largeFiles,
  'install-hooks': installHooks,
  'debug-output': debugOutput,
  'todo-refs': todoRefs,
  'licence-header': licenceHeader,
  'doc-links': docLinks,
  'commit-format': commitFormat,
  'migration-down': migrationDown,
};

/** The pre-steps that hand the model facts for `script+model` checklists, by `prestep` key. */
export const FACTS: Record<string, Facts> = {
  'deps-diff': depsDiffFacts,
  changeset,
  'docs-touched': docsTouched,
  'test-pairs': testPairs,
  'new-files': newFiles,
  'diff-stats': diffStats,
  'log-lines': logLines,
  flags,
  'type-escapes': typeEscapes,
  callers,
  unused,
  imports,
  'exports-diff': exportsDiff,
  routes,
  'locale-keys': localeKeys,
  'raw-values': rawValues,
  'native-changes': nativeChanges,
  // The pinned linters (consts/tools.const.ts), run in the sandbox. One that can't run leaves its checklist to the model alone.
  actionlint,
  hadolint,
  'migration-lint': migrationLint,
  tflint,
  'contract-diff': contractDiff,
  'sql-strings': sqlStrings,
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
        return (await SCRIPTS[c.prestep!]!(input, c.data)).map((f) => ({ ...f, step: c.key }));
      } catch (e) {
        c.skip = e instanceof Error ? e.message : String(e);
        core.warning(`${c.name} wasn't checked: ${c.skip}`);
        return [];
      }
    }),
  );
  return found.flat();
}

/** The `script+model` checklists the model judges even when their script finds nothing, since a quiet script isn't proof the change is safe. */
export const ALWAYS_MODEL = ['breakage', 'scope', 'access-control'];

/** Each pre-step's facts, once per run: the check for quiet scripts and the prompt read the same text. */
const ran = new WeakMap<ScriptInput, Map<string, Promise<string>>>();
function factsOf(key: string, input: ScriptInput): Promise<string> {
  const m = ran.get(input) ?? new Map<string, Promise<string>>();
  ran.set(input, m);
  if (!m.has(key)) m.set(key, FACTS[key]!(input).catch((e: Error) => `Not available: ${e.message}`));
  return m.get(key)!;
}

/** The `script+model` checklists whose script found nothing (its facts are empty): no hit, no model call. They pass with no findings. */
export async function quietChecklists(run: Planned[], input: ScriptInput): Promise<Planned[]> {
  const asked = run.filter((c) => c.mode === 'script+model' && c.prestep && FACTS[c.prestep] && !ALWAYS_MODEL.includes(c.key));
  const empty = await Promise.all(asked.map(async (c) => (await factsOf(c.prestep!, input)) === ''));
  return asked.filter((_, i) => empty[i]);
}

/**
 * The facts for the `script+model` checklists that run, after the steps: each pre-step once, under
 * the checklists that use it. A pre-step that fails says so in its place, and its checklists still run.
 */
export async function factsBlock(run: Checklist[], input: ScriptInput): Promise<string> {
  const keys = [...new Set(run.filter((c) => c.mode === 'script+model' && c.prestep && FACTS[c.prestep]).map((c) => c.prestep!))];
  const parts = await Promise.all(
    keys.map(async (k) => `### ${k}, for ${run.filter((c) => c.prestep === k).map((c) => c.key).join(', ')}\n\n${await factsOf(k, input)}`),
  );
  return parts.length ? `\n## Facts from the pre-steps\n\n${parts.join('\n\n')}\n` : '';
}
