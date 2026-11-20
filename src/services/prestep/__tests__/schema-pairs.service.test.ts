import { expect, test } from 'vitest';
import { schemaPairs } from '../schema-pairs.service';
import { changed, input } from './fixtures/input';

const TABLE = "import { pgTable, text } from 'drizzle-orm/pg-core';\nexport const users = pgTable('users', { name: text() });\n";
const schema = changed('src/db/users.schema.ts', ["  email: text(),"]);
const migration = changed('drizzle/0001_add_email.sql', ['ALTER TABLE "users" ADD COLUMN "email" text;']);
const run = (files: ReturnType<typeof changed>[], tree: Record<string, string> = { 'src/db/users.schema.ts': TABLE }) =>
  schemaPairs(input(files, tree)).map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`);

test('a database schema change with no migration is blocking, and with one it pairs', () => {
  expect(run([schema])).toEqual(['blocking src/db/users.schema.ts:1 Schema changed with no migration']);
  expect(run([schema, migration])).toEqual([]);
});

test('a migration with no schema change is blocking, only in a repo that has a schema file', () => {
  expect(run([migration, changed('drizzle/meta/_journal.json', ['{}'])])).toEqual(['blocking drizzle/0001_add_email.sql:1 Migration with no schema change']);
  expect(run([migration], {})).toEqual([]);
});

test('a validation schema and a comment-only change need no migration', () => {
  expect(run([changed('src/forms/login.schema.ts', ['  email: z.string(),'])], { 'src/forms/login.schema.ts': "import { z } from 'zod';" })).toEqual([]);
  expect(run([changed('src/db/users.schema.ts', ['  // the email, once verified'])])).toEqual([]);
});
