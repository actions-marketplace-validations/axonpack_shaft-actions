import type { ScriptInput } from '../../../../types/prestep.type';
import { matches } from '../../../../utils/auto-pick.util';

/** A changed file whose patch adds `added` from line 1 and removes `removed`. */
export const changed = (filename: string, added: string[], removed: string[] = []) => ({
  filename,
  status: 'modified',
  additions: added.length,
  deletions: removed.length,
  patch: `@@ -1,${removed.length} +1,${added.length} @@\n${[...removed.map((l) => `-${l}`), ...added.map((l) => `+${l}`)].join('\n')}`,
});

/** A script's input: the changed files, a checkout holding `tree`, a base branch with none of the files, and the PR and guides given. */
export const input = (files: ScriptInput['files'], tree: Record<string, string> = {}, extra: Partial<ScriptInput> = {}): ScriptInput => ({
  files,
  pr: { number: 7, title: 'fix: a thing', body: '', author: 'a', headSha: 'abc1234', base: 'main', head: 'feature', fork: false, defaultBranch: 'main' },
  guides: [],
  checkout: { find: (globs) => Object.keys(tree).filter((p) => matches(p, globs)), read: (p) => tree[p] },
  base: async () => undefined,
  octokit: {} as ScriptInput['octokit'],
  ...extra,
});
