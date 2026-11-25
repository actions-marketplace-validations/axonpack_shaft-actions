import type { Script } from '../../types/prestep.type';
import { matches } from '../../utils/auto-pick.util';

/** Migration files, when the API sends no `paths`. */
export const MIGRATIONS = ['**/migrations/**', '**/migrate/**', '**/alembic/versions/**', '**/drizzle/*.sql'];
/** How a migration file writes its way back, when the API sends no `down`: goose, sql-migrate, Knex, Rails, Alembic, TypeORM and the like. */
export const DOWN = ['\\bdown\\b', '\\bdowngrade\\b', '\\brollback\\b', '\\bdef change\\b'];

const strings = (v: unknown) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? (v as string[]) : undefined);

/**
 * A migration the pull request adds with no down or rollback step, as should-fix. An `up` file (`1_x.up.sql`,
 * `1_x/up.sql`) needs its `down` file in the checkout; any other needs a line matching one of `down`.
 */
export const migrationDown: Script = ({ files, checkout }, data) => {
  const paths = strings(data?.paths) ?? MIGRATIONS;
  const down = (strings(data?.down) ?? DOWN).flatMap((p) => {
    try {
      return [new RegExp(p, 'i')];
    } catch {
      return [];
    }
  });
  return files
    .filter((f) => f.status === 'added' && matches(f.filename, paths) && !/(?:^|[/._-])down(?:[/._-]|$)/i.test(f.filename))
    .filter((f) => {
      const pair = f.filename.replace(/(^|[/._-])up(?=[/._-]|$)/i, '$1down');
      if (pair !== f.filename) return !checkout.read(pair) && !files.some((g) => g.filename === pair);
      const text = checkout.read(f.filename);
      return text !== undefined && !down.some((r) => r.test(text));
    })
    .map((f) => ({ severity: 'should-fix' as const, file: f.filename, line: 1, title: 'Migration with no down step', body: "This migration has no down or rollback step, so it can't be undone. Add one, or say in the pull request that this change rolls forward only." }));
};
