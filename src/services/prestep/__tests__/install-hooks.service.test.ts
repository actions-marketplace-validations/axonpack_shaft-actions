import { expect, test } from 'vitest';
import { installHooks } from '../install-hooks.service';
import { changed, input } from './fixtures/input';

const pkg = (scripts: Record<string, string>, deps: Record<string, string> = {}) => JSON.stringify({ scripts, dependencies: deps }, null, 2);

test('an added or changed postinstall in package.json is should-fix', () => {
  const file = changed('packages/a/package.json', ['    "postinstall": "node setup.js",']);
  const found = installHooks(input([file], { 'packages/a/package.json': pkg({ postinstall: 'node setup.js' }) }));
  expect(found.map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`)).toEqual(['should-fix packages/a/package.json:1 New or changed `postinstall` script']);
});

test('look-alikes pass: a dependency named install, a prepare script and an unchanged hook', () => {
  const file = changed('package.json', ['    "install": "^1.0.0",', '    "prepare": "husky"']);
  expect(installHooks(input([file], { 'package.json': pkg({ prepare: 'husky' }, { install: '^1.0.0' }) }))).toEqual([]);
});
