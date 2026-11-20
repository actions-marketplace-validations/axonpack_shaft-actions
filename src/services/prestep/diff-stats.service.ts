import { basename } from 'node:path';
import type { Facts } from '../../types/prestep.type';
import { CODE, factsText, isDocs, TEST } from '../../utils/facts.util';
import { LOCKFILES } from '../../utils/lockfile.util';

/** A file's area: `packages/<name>`, `apps/<name>` and the like in a monorepo, else its top folder, or the root. */
const area = (path: string) => {
  const parts = path.split('/');
  if (parts.length === 1) return '(root)';
  return /^(?:packages|apps|libs|services|modules|crates|plugins)$/.test(parts[0]!) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
};
const kind = (path: string) =>
  LOCKFILES.some(([name]) => name.test(basename(path))) ? 'lockfiles' : TEST.test(path) ? 'tests' : isDocs(path) ? 'docs' : CODE.test(path) ? 'code' : 'other';

type Count = { files: number; added: number; removed: number };
const tally = (into: Map<string, Count>, key: string, f: { additions: number; deletions: number }) => {
  const c = into.get(key) ?? into.set(key, { files: 0, added: 0, removed: 0 }).get(key)!;
  c.files++;
  c.added += f.additions;
  c.removed += f.deletions;
};
const show = ([key, c]: [string, Count]) => `- ${key}: ${c.files} file${c.files === 1 ? '' : 's'}, +${c.added} -${c.removed}`;

/** The `diff-stats` facts: totals, then lines by area and by kind of file, then every file, largest first. */
export const diffStats: Facts = async ({ files }) => {
  if (!files.length) return 'The pull request changes no files.';
  const [areas, kinds] = [new Map<string, Count>(), new Map<string, Count>()];
  for (const f of files) {
    tally(areas, area(f.filename), f);
    tally(kinds, kind(f.filename), f);
  }
  const size = (c: Count) => c.added + c.removed;
  const sum = (key: 'additions' | 'deletions') => files.reduce((n, f) => n + f[key], 0);
  return factsText(
    [
      `${files.length} file${files.length === 1 ? '' : 's'} changed, +${sum('additions')} -${sum('deletions')}.`,
      'By area:',
      ...[...areas].sort(([, a], [, b]) => size(b) - size(a)).map(show),
      'By kind:',
      ...[...kinds].sort(([, a], [, b]) => size(b) - size(a)).map(show),
      'Files, largest first:',
      ...[...files].sort((a, b) => b.additions + b.deletions - a.additions - a.deletions).map((f) => `- ${f.filename} (${f.status}) +${f.additions} -${f.deletions}`),
    ],
    '',
  );
};
