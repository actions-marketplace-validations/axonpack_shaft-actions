import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { ACTION_VERSION } from './consts/api.const';
import { ACTION_CODES } from './consts/codes.const';
import { GUIDE_CAP, GUIDE_FILES } from './consts/settings.const';
import { FACTS, SCRIPTS } from './services/prestep/prestep.service';
import { LOCKFILES } from './utils/lockfile.util';

// `bun run build` runs this before the bundle. It writes only data: the Claude Code binaries' hashes,
// which the bundle carries, and `dist/meta.json`, which the shaft docs generator reads.

// The sha512 bun.lock records for each platform's Claude Code binary package, by `name@version`.
// `claude-binary.service.ts` checks the tarball npm downloads against it before unpacking it.
const lock = createRequire(import.meta.url)('../bun.lock'); // Bun parses its own lockfile
const sdk = lock.packages['@anthropic-ai/claude-agent-sdk'];
const binaries = Object.fromEntries(Object.keys(sdk[2].optionalDependencies).map((name) => [lock.packages[name][0], lock.packages[name][3]]));
writeFileSync(
  new URL('./consts/claude-binary.const.ts', import.meta.url),
  `// Written by \`bun run build\` (src/meta.ts) from bun.lock. Don't edit.\n\n/** The sha512 of each Claude Code binary package, by \`name@version\`. */\nexport const CLAUDE_BINARIES: Record<string, string> = ${JSON.stringify(binaries, null, 2)};\n`,
);

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
