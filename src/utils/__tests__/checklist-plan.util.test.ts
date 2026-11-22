import { expect, test } from 'vitest';
import type { Checklist } from '../../services/api.service';
import { NO_MATCH, NOT_YET, ONLY_EXCLUDED, planChecklists, stepsBlock } from '../checklist-plan.util';

const checklist = (key: string, paths: string[], mode: Checklist['mode'] = 'model'): Checklist => ({ key, name: key, mode, model: 'main', paths, prestep: null, prompt: `**${key}.** Look.` });

test('a checklist runs when a changed file matches its paths, in the job order; the others say why not', () => {
  const plan = planChecklists(
    [checklist('correctness', ['**/*.ts']), checklist('migrations', ['**/migrations/**']), checklist('secrets', ['**'], 'script'), checklist('docs', ['**/*.md'], 'script+model')],
    [{ filename: 'src/a.ts' }, { filename: 'README.md' }],
  );
  expect(plan.map((c) => `${c.key}:${c.skip ?? 'runs'}`)).toEqual(['correctness:runs', `migrations:${NO_MATCH}`, `secrets:${NOT_YET}`, 'docs:runs']);
});

test('paths match files under dot folders and dotfiles, so ** is any change', () => {
  const runs = (paths: string[], filename: string) => !planChecklists([checklist('c', paths)], [{ filename }])[0]!.skip;
  expect(runs(['**'], '.github/workflows/ci.yml')).toBe(true);
  expect(runs(['**/*.ts'], '.storybook/main.ts')).toBe(true);
  expect(runs(['**/.env*'], '.env.example')).toBe(true);
  expect(runs(['.github/workflows/**'], 'src/workflows/a.yml')).toBe(false);
  expect(runs(['**/*.ts'], 'src/a.md')).toBe(false);
});

test('a script checklist runs when the action has its script', () => {
  const secrets = { ...checklist('secrets', ['**'], 'script'), prestep: 'secrets' };
  expect(planChecklists([secrets], [{ filename: 'a.ts' }], ['secrets'])[0]!.skip).toBeUndefined();
  expect(planChecklists([secrets], [{ filename: 'a.ts' }], ['pr-meta'])[0]!.skip).toBe(NOT_YET);
});

test('with no changed files nothing runs', () => {
  expect(planChecklists([checklist('c', ['**'])], [])[0]!.skip).toBe(NO_MATCH);
});

test('the steps are numbered from 1: before, each checklist that runs, then after', () => {
  expect(stepsBlock(['**Read.** The PR.'], [checklist('correctness', [])], ['**Verify.** Each finding.'])).toBe(
    '## The steps for this run\n\n1. **Read.** The PR.\n2. **correctness.** Look.\n3. **Verify.** Each finding.\n',
  );
});

test("a checklist doesn't run when every file it covers matches its exclude, and is told to leave out the ones that do", () => {
  const c = { ...checklist('@acme/query-limits', ['src/**/*.ts']), exclude: ['**/*.test.ts', 'src/generated/**'] };
  const files = (...names: string[]) => names.map((filename) => ({ filename }));
  expect(planChecklists([c], files('src/a.test.ts', 'src/generated/db.ts', 'README.md'))[0]!.skip).toBe(ONLY_EXCLUDED);
  const [runs] = planChecklists([c], files('src/a.ts', 'src/a.test.ts', 'README.md'));
  expect(runs).toMatchObject({ leftOut: ['src/a.test.ts'] });
  expect(runs!.skip).toBeUndefined();
  expect(stepsBlock([], [runs!], [])).toBe(
    '## The steps for this run\n\n1. **@acme/query-limits.** Look.\n   - Leave these changed files out of this check: `src/a.test.ts`.\n',
  );
  // Nothing excluded changed: its step is as sent, and an empty exclude changes nothing.
  expect(planChecklists([c], files('src/a.ts'))[0]).not.toHaveProperty('leftOut');
  expect(planChecklists([{ ...c, exclude: [] }], files('src/a.test.ts'))[0]!.skip).toBeUndefined();
});
