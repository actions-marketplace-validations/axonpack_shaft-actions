import { expect, test } from 'vitest';
import { typeEscapes } from '../type-escapes.service';
import { changed, input } from './fixtures/input';

test('escapes on added TypeScript and Python lines, a def missing hints in typed Python, and the settings that name them', async () => {
  const files = [
    changed('src/api.ts', [
      'const data = res.json() as any;',
      'function f(x: string | any, y: any[]) {}',
      'const user = users.find(u => u.id === id)!;',
      'const el = ref.current!.focus();',
      '// @ts-expect-error -- the SDK types lag',
      'const n = value as unknown as number;',
      '// eslint-disable-next-line no-console',
      'if (a !== b && !done) {}',
      "const msg = 'Done';",
      'const opts = { any: true };',
    ]),
    changed('src/__tests__/api.test.ts', ['const mock = {} as any;']),
    changed('app/service.py', ['def total(items, tax=0.2):', 'def name(self) -> str:', '    return cast(str, x)  # type: ignore', 'from typing import Any']),
    changed('src/a.js', ['const x = y as any;']),
  ];
  const tree = { 'mypy.ini': '[mypy]\nstrict = True\n', 'tsconfig.json': '{\n  "compilerOptions": {\n    "strict": true\n  }\n}', 'eslint.config.js': "rules: { '@typescript-eslint/no-explicit-any': 'off' }" };
  expect(await typeEscapes(input(files, tree))).toBe(
    [
      'Type escapes on added lines:',
      '- src/api.ts:1 any: const data = res.json() as any;',
      '- src/api.ts:2 any: function f(x: string | any, y: any[]) {}',
      '- src/api.ts:3 non-null assertion: const user = users.find(u => u.id === id)!;',
      '- src/api.ts:4 non-null assertion: const el = ref.current!.focus();',
      '- src/api.ts:5 @ts-expect-error: // @ts-expect-error -- the SDK types lag',
      '- src/api.ts:6 double cast: const n = value as unknown as number;',
      '- src/api.ts:7 lint rule turned off: // eslint-disable-next-line no-console',
      '- src/__tests__/api.test.ts:1 any: const mock = {} as any; (test file)',
      '- app/service.py:1 missing hints: def total(items, tax=0.2):',
      '- app/service.py:3 type: ignore, cast: return cast(str, x)  # type: ignore',
      '- app/service.py:4 Any: from typing import Any',
      "The repo's lint and type settings that name them:",
      "- eslint.config.js:1 rules: { '@typescript-eslint/no-explicit-any': 'off' }",
      '- mypy.ini:2 strict = True',
      '- tsconfig.json:3 "strict": true',
    ].join('\n'),
  );
});

test('untyped Python gets no hint facts, and a clean diff says so', async () => {
  expect(await typeEscapes(input([changed('app/a.py', ['def total(items):'])]))).toBe('');
  expect(await typeEscapes(input([changed('src/a.ts', ['const a: string = "x";'])]))).toBe('');
});
