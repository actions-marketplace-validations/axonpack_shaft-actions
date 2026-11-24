import { expect, test } from 'vitest';
import { todoRefs } from '../todo-refs.service';
import { changed, input } from './fixtures/input';

test('a TODO or FIXME with no issue is a nit; one with an issue, and the word outside a comment, pass', () => {
  const file = changed('src/a.ts', ['// TODO: retry', '# FIXME later', '// TODO(#12): retry', '// TODO https://github.com/o/r/issues/3', 'const TODO = 1;', '// FIXME ENG-42']);
  expect(todoRefs(input([file])).map((f) => `${f.line} ${f.title}`)).toEqual(['1 TODO with no issue', '2 FIXME with no issue']);
});
