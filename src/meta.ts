import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';
import { ACTION_VERSION } from './consts/api.const';
import { ACTION_CODES } from './consts/codes.const';
import { GUIDE_CAP, GUIDE_FILES } from './consts/settings.const';
import { FACTS, SCRIPTS } from './services/prestep/prestep.service';
import { LOCKFILES } from './utils/lockfile.util';

// `bun run build` runs this after the bundle: `dist/meta.json` is what the shaft docs generator reads
// about this build. Data only, never code.
const action = parse(readFileSync(new URL('../action.yml', import.meta.url), 'utf8'));
const meta = {
  version: ACTION_VERSION,
  inputs: action.inputs,
  outputs: action.outputs,
  codes: ACTION_CODES,
  // The `prestep` keys this build has: scripts for `script` checklists, facts for `script+model` ones.
  scripts: Object.keys(SCRIPTS),
  facts: Object.keys(FACTS),
  guideFiles: GUIDE_FILES,
  guideCap: GUIDE_CAP,
  // Each lockfile name as a regular expression, with its ecosystem.
  lockfiles: LOCKFILES.map(([name, ecosystem]) => ({ pattern: name.source, ecosystem })),
};
writeFileSync(new URL('../dist/meta.json', import.meta.url), `${JSON.stringify(meta, null, 2)}\n`);
