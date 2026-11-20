import type { Checklist } from '../api.service';
import type { Script, ScriptInput } from '../../types/prestep.type';
import type { Finding } from '../../utils/render.util';
import { envVars } from './env-vars.service';
import { prMeta } from './pr-meta.service';
import { schemaPairs } from './schema-pairs.service';
import { secrets } from './secrets.service';

/** The pre-step scripts built into the action, by the `prestep` key the API sends. */
export const SCRIPTS: Record<string, Script> = { secrets, 'pr-meta': prMeta, 'env-vars': envVars, 'schema-pairs': schemaPairs };

/** The findings of each script checklist, under its key. Every checklist passed here has its script in `SCRIPTS`. */
export const runScripts = (run: Checklist[], input: ScriptInput): Finding[] =>
  run.flatMap((c) => SCRIPTS[c.prestep!]!(input).map((f) => ({ ...f, step: c.key })));
