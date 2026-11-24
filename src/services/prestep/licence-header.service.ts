import type { Script } from '../../types/prestep.type';
import { CODE } from '../../utils/facts.util';

/** How far down a file the header may start, after a shebang or a `'use client'`. */
const TOP = 10;

/**
 * A source file the pull request adds whose first lines don't hold the header's first line, as
 * should-fix. The header is the project's own rules on the checklist (`data.rules`); with none, it's off.
 */
export const licenceHeader: Script = ({ files, checkout }, data) => {
  const first = typeof data?.rules === 'string' ? data.rules.split(/\r?\n/).find((l) => l.trim())?.trim() : undefined;
  if (!first) return [];
  return files
    .filter((f) => f.status === 'added' && CODE.test(f.filename))
    .filter((f) => !(checkout.read(f.filename) ?? '').split(/\r?\n/, TOP).some((l) => l.includes(first)))
    .map((f) => ({ severity: 'should-fix' as const, file: f.filename, line: 1, title: 'Licence header missing', body: `This new file doesn't start with the repo's licence header (\`${first.slice(0, 120)}\`). Add it at the top.` }));
};
