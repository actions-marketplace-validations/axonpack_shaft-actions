import { expect, test } from 'vitest';
import { migrationDown } from '../migration-down.service';
import { input } from './fixtures/input';

const added = (filename: string) => ({ filename, status: 'added', additions: 1, deletions: 0 });

test('a new migration with no down step is should-fix; one with a down step or a down file passes', () => {
  const tree = {
    'db/migrations/1_a.sql': 'CREATE TABLE a (id int);',
    'db/migrations/2_b.sql': '-- +goose Up\nCREATE TABLE b();\n-- +goose Down\nDROP TABLE b;',
    'db/migrations/3_c.up.sql': 'x',
    'db/migrations/3_c.down.sql': 'x',
    'db/migrations/4_d.up.sql': 'x',
  };
  const files = Object.keys(tree).map(added);
  expect(migrationDown(input(files, tree)).map((f) => f.file)).toEqual(['db/migrations/1_a.sql', 'db/migrations/4_d.up.sql']);
});

test('the API can send its own paths and down patterns', () => {
  const tree = { 'sql/1.sql': 'CREATE TABLE a (); -- revert: DROP TABLE a;' };
  expect(migrationDown(input([added('sql/1.sql')], tree))).toEqual([]);
  expect(migrationDown(input([added('sql/1.sql')], tree), { paths: ['sql/**'] })).toHaveLength(1);
  expect(migrationDown(input([added('sql/1.sql')], tree), { paths: ['sql/**'], down: ['revert:'] })).toEqual([]);
});
