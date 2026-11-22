import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { changedFiles, readAll, report, runTool } from '../tool.service';

/** The `migration-lint` facts, for `migrations`: what the pinned squawk reports on the changed SQL files, with the repo's `.squawk.toml`. */
export const migrationLint: Facts = async ({ files, checkout }) => {
  const sql = changedFiles(files, /\.sql$/i);
  if (!sql.length) return 'No SQL file changed, so squawk had nothing to read.';
  const run = await runTool('squawk', ['--reporter', 'json', ...sql], readAll(checkout, [...sql, '.squawk.toml']));
  const issues: { file: string; line: number; level: string; message: string; help?: string | null; rule_name: string }[] = report('squawk', run) ?? [];
  // squawk counts lines from 0.
  return factsText(
    issues.map((i) => `${i.file}:${i.line + 1} ${i.rule_name} (${i.level.toLowerCase()}): ${i.message}${i.help ? ` ${i.help}.` : ''}`),
    'squawk found nothing in the changed SQL files.',
  );
};
