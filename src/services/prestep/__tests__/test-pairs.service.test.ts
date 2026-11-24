import { expect, test } from 'vitest';
import { testPairs } from '../test-pairs.service';
import { changed, input } from './fixtures/input';

test('each changed source with its changed test, an existing test, or none, and changed tests nothing matches', async () => {
  const files = [
    changed('src/services/user.service.ts', ['x']),
    changed('src/services/__tests__/user.service.test.ts', ['x']),
    changed('app/cart.py', ['x']),
    changed('app/tests/test_cart.py', ['x']),
    changed('pkg/server.go', ['x']),
    changed('src/utils/date.util.ts', ['x']),
    changed('src/types/api.d.ts', ['x']),
    changed('README.md', ['x']),
    { ...changed('src/__tests__/old.test.ts', []), status: 'removed' },
  ];
  const tree = { 'src/utils/__tests__/date.util.test.ts': '', 'pkg/server_test.go': '' };
  expect(await testPairs(input(files, tree))).toBe(
    [
      'Changed source files with a changed test:',
      '- src/services/user.service.ts: src/services/__tests__/user.service.test.ts',
      '- app/cart.py: app/tests/test_cart.py',
      'Changed source files with no changed test:',
      "- pkg/server.go: has a test the pull request doesn't change: pkg/server_test.go",
      "- src/utils/date.util.ts: has a test the pull request doesn't change: src/utils/__tests__/date.util.test.ts",
      'Changed tests no changed source file matches by name:',
      '- src/__tests__/old.test.ts (removed)',
    ].join('\n'),
  );
});

test('a source with no test anywhere says so, and a PR with no code says so', async () => {
  expect(await testPairs(input([changed('src/Button.kt', ['x'])]))).toBe(
    'Changed source files with a changed test: none\nChanged source files with no changed test:\n- src/Button.kt: no test with its name in the repo',
  );
  expect(await testPairs(input([changed('docs/a.md', ['x'])]))).toBe('');
});
