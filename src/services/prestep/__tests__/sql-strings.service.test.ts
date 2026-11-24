import { expect, test } from 'vitest';
import { quietChecklists } from '../prestep.service';
import { sqlStrings } from '../sql-strings.service';
import { changed, input } from './fixtures/input';

test('SQL built from strings is a candidate, with its hunk; parameters, tagged sql and tests are not', async () => {
  const files = [
    changed('src/a.ts', ['db.query(`SELECT * FROM u WHERE id = ${id}`);', 'db.query("SELECT * FROM u WHERE id = $1", [id]);', 'await sql`SELECT * FROM u WHERE id = ${id}`;']),
    changed('app/b.py', ['cur.execute(f"DELETE FROM t WHERE id = {i}")']),
    changed('src/a.test.ts', ['db.query(`SELECT ${x}`);']),
  ];
  const facts = await sqlStrings(input(files));
  expect(facts).toContain('- src/a.ts:1\n    > 1: db.query(`SELECT');
  expect(facts).toContain('- app/b.py:1');
  expect(facts).not.toMatch(/src\/a\.ts:[23]\n|a\.test\.ts/);
  expect(await sqlStrings(input([changed('src/c.ts', ['db.query("SELECT 1")'])]))).toBe('');
});

test('no hit, no model call: a script+model checklist whose facts are empty is quiet, unless the model always judges it', async () => {
  const c = (key: string, prestep: string) => ({ key, name: key, mode: 'script+model' as const, model: 'main' as const, paths: ['**'], prestep, prompt: '' });
  const run = [c('sql-strings', 'sql-strings'), c('breakage', 'sql-strings')];
  expect((await quietChecklists(run, input([changed('src/c.ts', ['x'])]))).map((x) => x.key)).toEqual(['sql-strings']);
  expect(await quietChecklists(run, input([changed('src/c.ts', ['db.query(`SELECT ${x}`)'])]))).toEqual([]);
});
