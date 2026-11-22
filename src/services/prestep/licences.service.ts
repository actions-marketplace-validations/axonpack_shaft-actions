import type { NetworkScript } from '../../types/prestep.type';
import { depsDiff } from './deps-diff.service';
import { checkPackages, packageKey } from './packages-check.service';

/** The registries that declare a package's licence. Go has none. */
const DECLARED = ['npm', 'PyPI', 'crates.io'];

/** What the Axon Shaft API answers for a version: the licence its registry declares, or `unknown`, and whether the deny list covers it. */
type Licence = { ecosystem: string; name: string; version: string; licence: string; denied: boolean };

/**
 * The licence of each public package a lockfile adds, from the Axon Shaft API, which asks npm, PyPI or
 * crates.io and checks it against the deny list (strong copyleft). Denied is blocking, none declared
 * should-fix. Upgrades of a package the repo already had are left out. Only the ecosystem, name and
 * version of public packages are sent, as for `osv`. An older API has no lookup, and when some went
 * unchecked and nothing was found, this throws, so the checklist is skipped and never passes.
 */
export const licences: NetworkScript = async (input) => {
  const pins = (await depsDiff(input)).flatMap(({ file, ecosystem, changes }) =>
    DECLARED.includes(ecosystem)
      ? changes.flatMap((c) => (c.kind === 'added' ? c.to.filter((p) => p.public && !p.name.startsWith('@')).map((p) => ({ ...p, file, ecosystem })) : []))
      : [],
  );
  if (!pins.length) return [];
  const api = await checkPackages<Licence>(pins, 'licences');
  if (!api) throw new Error("The Axon Shaft API doesn't look up licences yet, so no package was checked.");
  const found = pins.flatMap((p) => {
    const l = api.get(packageKey(p));
    if (!l || (!l.denied && l.licence !== 'unknown')) return [];
    return [
      l.denied
        ? {
            severity: 'blocking' as const,
            file: p.file,
            line: p.line,
            title: `${p.name} ${p.version} is licensed ${l.licence}`,
            body: `\`${p.name}\` ${p.version} declares the licence \`${l.licence}\`, which is strong copyleft and on the deny list. Pick another package, or say in the pull request why it's fine here.`,
          }
        : {
            severity: 'should-fix' as const,
            file: p.file,
            line: p.line,
            title: `${p.name} ${p.version} declares no licence`,
            body: `\`${p.name}\` ${p.version} declares no licence on ${p.ecosystem}, so it isn't clear the project may use it. Check the package's own licence file, or pick another package.`,
          },
    ];
  });
  const checked = pins.filter((p) => api.has(packageKey(p))).length;
  if (checked < pins.length && !found.length) throw new Error(`The Axon Shaft API checked only ${checked} of the ${pins.length} licences, finding nothing.`);
  return found;
};
