import { expect, test } from 'vitest';
import { focusedTests } from '../focused-tests.service';
import { changed, input } from './fixtures/input';

test('.only, fdescribe and fit on added test lines are blocking, .skip is a nit', () => {
  const file = changed('src/__tests__/a.test.ts', ["describe.only('a', () => {", "  fit('b', () => {});", "  it.skip('c', () => {});", "  test('d', () => {});"]);
  expect(focusedTests(input([file])).map((f) => `${f.severity} ${f.line} ${f.title}`)).toEqual(['blocking 1 Focused test: `describe.only`', 'blocking 2 Focused test: `fit`', 'nit 3 Skipped test: `it.skip`']);
});

test('look-alikes pass: .only outside test files, in comments, and names like `profit(`', () => {
  const files = [changed('src/query.ts', ['q.only("x")', 'items.filter(only)']), changed('src/a.test.ts', ['// it.only was here', 'const x = profit(1);', "test('only once', () => {});"])];
  expect(focusedTests(input(files))).toEqual([]);
});
