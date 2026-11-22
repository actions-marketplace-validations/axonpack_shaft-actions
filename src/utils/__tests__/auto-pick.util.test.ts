import { expect, test } from 'vitest';
import { type ChangedFile, ladder, pick } from '../auto-pick.util';

const file = (filename: string, lines = 10, patch?: string): ChangedFile => ({ filename, additions: lines, deletions: 0, patch });

test('task mode: opus, high', () => {
  expect(pick({ mode: 'task', files: [file('src/a.ts')] })).toMatchObject({ model: 'opus', effort: 'high' });
});

test('reply mode: sonnet, medium, with the full turn cap whatever the diff, and what the dashboard sets wins', () => {
  expect(pick({ mode: 'reply', files: [file('src/auth/session.ts')] })).toMatchObject({ model: 'sonnet', effort: 'medium', maxTurns: 30, reason: 'question' });
  expect(pick({ mode: 'reply', model: 'opus', effort: 'high', maxTurns: 8 })).toMatchObject({ model: 'opus', effort: 'high', maxTurns: 8 });
});

test('a sensitive path: opus, high', () => {
  for (const f of ['src/auth/session.ts', '.github/workflows/ci.yml', 'db/migrations/001.sql', 'lib/crypto.ts', 'src/payments/charge.ts']) {
    expect(pick({ mode: 'review', files: [file('README.md'), file(f)] })).toMatchObject({ model: 'opus', effort: 'high' });
  }
});

test('package.json counts as sensitive only when its deps change', () => {
  const deps = '@@ -10,3 +10,3 @@\n   "dependencies": {\n-    "a": "1.0.0",\n+    "a": "2.0.0",';
  const version = '@@ -1,3 +1,3 @@\n   "name": "x",\n-  "version": "1.0.0",\n+  "version": "1.1.0",';
  expect(pick({ mode: 'review', files: [file('package.json', 2, deps)] }).model).toBe('opus');
  expect(pick({ mode: 'review', files: [file('package.json', 2, version)] }).model).toBe('haiku');
});

test('a focus path: opus, high', () => {
  expect(pick({ mode: 'review', files: [file('src/core/engine.ts')], focus: ['src/core/**'] })).toMatchObject({ model: 'opus', effort: 'high' });
});

test('depth deep: opus verifies, sonnet subagents, high', () => {
  expect(pick({ mode: 'review', depth: 'deep', files: [file('src/a.ts')] })).toMatchObject({ model: 'opus', effort: 'high', subagentModel: 'sonnet' });
});

test('over 1,000 lines or over 30 files: opus, medium', () => {
  expect(pick({ mode: 'review', files: [file('src/a.ts', 1001)] })).toMatchObject({ model: 'opus', effort: 'medium' });
  const many = Array.from({ length: 31 }, (_, i) => file(`src/f${i}.ts`, 1));
  expect(pick({ mode: 'review', files: many })).toMatchObject({ model: 'opus', effort: 'medium' });
});

test('lines in skipped paths do not count', () => {
  expect(pick({ mode: 'review', files: [file('src/a.ts'), file('src/__snapshots__/a.snap', 5000)], skip: ['**/*.snap'] })).toMatchObject({ model: 'sonnet' });
});

test('only docs, comments, lockfiles or config: haiku, low', () => {
  const comments = '@@ -1,2 +1,2 @@\n-// old note\n+// new note\n const x = 1;';
  const files = [file('README.md'), file('bun.lock', 400), file('tsconfig.json'), file('src/a.ts', 2, comments)];
  expect(pick({ mode: 'review', files })).toMatchObject({ model: 'haiku', effort: 'low' });
});

test('any other review: sonnet, medium', () => {
  const r = pick({ mode: 'review', files: [file('src/a.ts', 400), file('README.md', 12)] });
  expect(r).toMatchObject({ model: 'sonnet', effort: 'medium', reason: '412 lines, up to 20 turns' });
});

test('setting model or effort turns auto off for that one only', () => {
  expect(pick({ mode: 'review', files: [file('src/a.ts')], model: 'opus' })).toMatchObject({ model: 'opus', effort: 'medium', autoModel: false });
  expect(pick({ mode: 'review', files: [file('src/a.ts')], effort: 'max' })).toMatchObject({ model: 'sonnet', effort: 'max', autoModel: true });
});

test('max turns by size when the dashboard sets none: under 100 lines 12, under 500 lines 20, else 30', () => {
  const turns = (lines: number, extra: object = {}) => pick({ mode: 'review', files: [file('src/a.ts', lines)], ...extra });
  expect(turns(99)).toMatchObject({ maxTurns: 12, reason: '99 lines, up to 12 turns' });
  expect(turns(100)).toMatchObject({ maxTurns: 20, reason: '100 lines, up to 20 turns' });
  expect(turns(499).maxTurns).toBe(20);
  expect(turns(500)).toMatchObject({ maxTurns: 30, reason: '500 lines' });
  expect(turns(60, { depth: 'deep' })).toMatchObject({ maxTurns: 30, reason: '60 lines, deep' });
  expect(pick({ mode: 'task', files: [file('src/a.ts')] }).maxTurns).toBe(30);
});

test("the dashboard's max turns always wins and leaves the reason alone", () => {
  expect(pick({ mode: 'review', files: [file('src/a.ts', 60)], maxTurns: 50 })).toMatchObject({ maxTurns: 50, reason: '60 lines' });
  expect(pick({ mode: 'review', files: [file('src/a.ts', 5000)], maxTurns: 5 }).maxTurns).toBe(5);
});

const rungs = (input: Parameters<typeof ladder>[0]) => ladder(input).map((c) => `${c.model} ${c.effort}`);

test("with auto, each job climbs its own ladder, every rung at low effort", () => {
  expect(rungs({ mode: 'task', files: [file('src/a.ts')] })).toEqual(['haiku low', 'sonnet low', 'opus low']);
  expect(rungs({ mode: 'reply' })).toEqual(['haiku low', 'sonnet low', 'opus low']);
  expect(rungs({ mode: 'review', files: [file('README.md')] })).toEqual(['haiku low', 'sonnet low']);
  expect(rungs({ mode: 'review', files: [file('src/a.ts', 500)] })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'review', files: [file('.github/workflows/ci.yml')] })).toEqual(['opus low']);
});

test('the floors: no Haiku for a task whose checks cannot run, nor for a prompt past 100K tokens', () => {
  expect(rungs({ mode: 'task', checked: false })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'reply', promptChars: 400_001 })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'review', files: [file('README.md')], promptChars: 400_001 })).toEqual(['sonnet low']);
});

test("triage's start drops the rungs below it, never goes below the floor, and never past the top", () => {
  expect(rungs({ mode: 'task', start: 'sonnet' })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'task', start: 'opus' })).toEqual(['opus low']);
  expect(rungs({ mode: 'task', checked: false, start: 'haiku' })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'reply', start: 'max' })).toEqual(['haiku low', 'sonnet low', 'opus low']);
});

test('a model or effort the user set, or a deep review, runs one choice as set', () => {
  expect(rungs({ mode: 'task', model: 'sonnet' })).toEqual(['sonnet high']);
  expect(rungs({ mode: 'task', effort: 'medium', start: 'opus' })).toEqual(['opus medium']);
  expect(rungs({ mode: 'review', depth: 'deep', files: [file('src/a.ts')] })).toEqual(['opus high']);
});

test('a bare /fix of a few findings gets fewer turns', () => {
  expect(pick({ mode: 'task', findings: 3 }).maxTurns).toBe(12);
  expect(pick({ mode: 'task', findings: 6 }).maxTurns).toBe(20);
  expect(pick({ mode: 'task', findings: 9 }).maxTurns).toBe(30);
  expect(pick({ mode: 'task', findings: 3, maxTurns: 40 }).maxTurns).toBe(40);
});

test('a big review starts higher: over 2,000 changed lines at Opus, over 400 never below Sonnet, after skip', () => {
  expect(rungs({ mode: 'review', files: [file('src/a.ts', 2001)] })).toEqual(['opus low']);
  expect(rungs({ mode: 'review', files: [file('src/a.ts', 2000)] })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'review', files: [file('README.md', 401)] })).toEqual(['sonnet low']);
  expect(rungs({ mode: 'review', files: [file('README.md', 3000)] })).toEqual(['opus low']);
  expect(rungs({ mode: 'review', files: [file('src/a.ts', 3000)], skip: ['src/**'] })).toEqual(['sonnet low', 'opus low']);
  expect(rungs({ mode: 'review', files: [file('src/a.ts', 1500), file('src/b.ts', 1500)] })[0]).toBe('opus low');
  // Only reviews: a big task still climbs from Haiku.
  expect(rungs({ mode: 'task', files: [file('src/a.ts', 5000)] })[0]).toBe('haiku low');
});
