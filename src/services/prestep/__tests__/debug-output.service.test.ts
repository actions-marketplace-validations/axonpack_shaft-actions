import { expect, test } from 'vitest';
import { debugOutput } from '../debug-output.service';
import { changed, input } from './fixtures/input';

test('console.log, debugger, print( and dbg! on added lines are nits', () => {
  const files = [changed('src/a.ts', ['console.log(user);', '  debugger;']), changed('app/b.py', ['    print(x)']), changed('src/c.rs', ['let y = dbg!(x);'])];
  expect(debugOutput(input(files)).map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`)).toEqual([
    'nit src/a.ts:1 Debug output: `console.log`',
    'nit src/a.ts:2 Debug output: `debugger`',
    'nit app/b.py:1 Debug output: `print(`',
    'nit src/c.rs:1 Debug output: `dbg!`',
  ]);
});

test('tests, scripts, CLIs, comments, other loggers and print in other languages pass', () => {
  const files = [
    changed('src/a.test.ts', ['console.log(x);']),
    changed('scripts/gen.ts', ['console.log(x);']),
    changed('packages/x/bin/run.js', ['console.log(x);']),
    changed('src/b.ts', ['// console.log(x);', 'logger.log(x);', 'console.error(x);', 'const debuggerOn = true;']),
    changed('src/c.go', ['fmt.Println(x)']),
    changed('src/d.ts', ['blueprint(x);']),
  ];
  expect(debugOutput(input(files))).toEqual([]);
});

test('the API can send its own exclude globs', () => {
  const file = changed('tools/x.ts', ['console.log(x);']);
  expect(debugOutput(input([file]))).toHaveLength(1);
  expect(debugOutput(input([file]), { exclude: ['tools/**'] })).toEqual([]);
});
