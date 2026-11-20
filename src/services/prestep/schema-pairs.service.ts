import type { Script } from '../../types/prestep.type';
import { matches, onlyComments } from '../../utils/auto-pick.util';
import { diffLines } from '../../utils/render.util';

const MIGRATION = ['**/migrations/**', '**/drizzle/**', '**/*.sql'];
const SCHEMA = ['**/*.schema.ts', '**/schema.prisma'];
/** A `*.schema.ts` is a database schema only when it builds tables; else it's likely a validation schema. */
const TABLES = /\b(?:pg|mysql|sqlite|singlestore)Table\s*\(|from\s+['"]drizzle-orm/;

const isSchema = (path: string, text: string | undefined) => path.endsWith('schema.prisma') || TABLES.test(text ?? '');
const firstAdded = (patch?: string) => diffLines(patch, true).keys().next().value ?? 1;

/**
 * Schema files and migrations paired up: a database schema changed with no migration in the pull
 * request, or a migration with no schema change in a repo that has a schema file. A schema change
 * that touches only comments needs no migration.
 */
export const schemaPairs: Script = ({ files, checkout }) => {
  const migrations = files.filter((f) => matches(f.filename, MIGRATION));
  const schemas = files.filter(
    (f) => matches(f.filename, SCHEMA) && !migrations.includes(f) && !onlyComments(f.patch) && isSchema(f.filename, checkout.read(f.filename) ?? f.patch),
  );
  if (schemas.length && !migrations.length) {
    return schemas.map((f) => ({
      severity: 'blocking' as const,
      file: f.filename,
      line: firstAdded(f.patch),
      title: 'Schema changed with no migration',
      body: `\`${f.filename}\` changes the database schema, and the pull request has no migration. Generate one with the repo's migration tool and commit it with this change.`,
    }));
  }
  if (migrations.length && !schemas.length && checkout.find(SCHEMA).some((p) => isSchema(p, checkout.read(p)))) {
    const f = migrations.find((m) => m.filename.endsWith('.sql')) ?? migrations[0]!;
    return [
      {
        severity: 'blocking',
        file: f.filename,
        line: firstAdded(f.patch),
        title: 'Migration with no schema change',
        body: `The pull request changes migrations (${migrations.map((m) => `\`${m.filename}\``).join(', ')}) and no schema file. Update the schema to match, or say in the description why this migration stands alone.`,
      },
    ];
  }
  return [];
};
