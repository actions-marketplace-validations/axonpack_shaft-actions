import type { Script, ScriptFinding } from '../../types/prestep.type';
import { CONVENTIONAL } from './pr-meta.service';

/** Subjects git or GitHub writes, which no one picks the type of. */
const MADE = /^(?:Merge |Revert "|fixup! |squash! )/;

/** The pull request's title and each commit subject that isn't a Conventional Commit, as nits. Opt-in: a repo turns it on when it uses them. */
export const commitFormat: Script = ({ pr, commits }) => {
  const out: ScriptFinding[] = [];
  const body = (what: string) => `${what} doesn't start with a type such as \`fix:\` or \`feat(scope):\`, which this repo's Conventional Commits need.`;
  if (!CONVENTIONAL.test(pr.title)) out.push({ severity: 'nit', file: 'pull request title', line: 1, title: `Title isn't a Conventional Commit: "${pr.title.slice(0, 80)}"`, body: body('The title') });
  commits.forEach((m, i) => {
    const subject = m.split('\n', 1)[0]!.trim();
    if (!MADE.test(subject) && !CONVENTIONAL.test(subject))
      out.push({ severity: 'nit', file: 'commit messages', line: i + 1, title: `Commit subject isn't a Conventional Commit: "${subject.slice(0, 80)}"`, body: body(`Commit ${i + 1}'s subject`) });
  });
  return out;
};
