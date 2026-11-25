import { expect, test } from 'vitest';
import { commitFormat } from '../commit-format.service';
import { input } from './fixtures/input';

test('a title or commit subject outside Conventional Commits is a nit; merges and good subjects pass', () => {
  const pr = { ...input([]).pr, title: 'Update stuff' };
  const commits = ['feat(api): add x\n\nbody', 'wip', "Merge branch 'main' into feature", 'fix!: drop y'];
  expect(commitFormat(input([], {}, { pr, commits })).map((f) => `${f.file}:${f.line}`)).toEqual(['pull request title:1', 'commit messages:2']);
  expect(commitFormat(input([], {}, { commits: ['chore: z'] }))).toEqual([]);
});
