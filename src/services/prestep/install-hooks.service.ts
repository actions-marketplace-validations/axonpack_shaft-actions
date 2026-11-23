import type { Script } from '../../types/prestep.type';
import { diffLines } from '../../utils/render.util';

/** The npm lifecycle scripts that run on `npm install`, in the package and in every project that installs it. */
const HOOKS = ['preinstall', 'install', 'postinstall'];

/**
 * A `preinstall`, `install` or `postinstall` script that a `package.json` adds or changes, as should-fix:
 * the line has to be an added line, and the key has to be in the file's `scripts` at the head.
 */
export const installHooks: Script = ({ files, checkout }) =>
  files
    .filter((f) => /(^|\/)package\.json$/.test(f.filename) && f.status !== 'removed')
    .flatMap((f) => {
      let scripts: Record<string, unknown> = {};
      try {
        scripts = (JSON.parse(checkout.read(f.filename) ?? '{}') as { scripts?: Record<string, unknown> }).scripts ?? {};
      } catch {
        return [];
      }
      return [...diffLines(f.patch, true)].flatMap(([line, text]) => {
        const hook = HOOKS.find((h) => typeof scripts[h] === 'string' && new RegExp(`^\\s*"${h}"\\s*:`).test(text));
        return hook
          ? [{ severity: 'should-fix' as const, file: f.filename, line, title: `New or changed \`${hook}\` script`, body: `\`${hook}\` runs \`${String(scripts[hook]).slice(0, 120)}\` on every install, here and for anyone who installs this package. Check that it's needed and does only what it says.` }]
          : [];
      });
    });
