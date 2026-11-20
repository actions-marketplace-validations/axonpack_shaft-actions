import { expect, test } from 'vitest';
import { envVars } from '../env-vars.service';
import { changed, input } from './fixtures/input';

const code = changed('src/config.ts', [
  'const url = process.env.DATABASE_URL;',
  "const key = process.env['STRIPE_KEY'] ?? import.meta.env.VITE_API;",
  'if (process.env.NODE_ENV === "test" || process.env.GITHUB_SHA) {}',
  'const again = process.env.STRIPE_KEY;',
  'const moved = process.env.OLD_NAME;',
], ['const moved = process.env.OLD_NAME;']);

test('an env var read in an added line that no env example or doc names is should-fix, once, at its first read', () => {
  const found = envVars(input([code], { '.env.example': 'DATABASE_URL=\n', 'docs/setup.md': 'Set `VITE_API`.' }));
  expect(found.map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`)).toEqual(['should-fix src/config.ts:2 `STRIPE_KEY` isn\'t documented']);
});

test('names from Python, Go, Rust and Ruby count too, and platform names never do', () => {
  const files = [changed('a.py', ["os.environ.get('PY_VAR')", 'os.getenv("CI")']), changed('b.go', ['os.Getenv("GO_VAR")']), changed('c.rs', ['env::var("RS_VAR")']), changed('d.rb', ["ENV.fetch('RB_VAR')"])];
  expect(envVars(input(files)).map((f) => f.title)).toEqual(['`PY_VAR` isn\'t documented', '`GO_VAR` isn\'t documented', '`RS_VAR` isn\'t documented', '`RB_VAR` isn\'t documented']);
});
