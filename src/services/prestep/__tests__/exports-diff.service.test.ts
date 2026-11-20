import { expect, test } from 'vitest';
import { exportsDiff } from '../exports-diff.service';
import { changed, input } from './fixtures/input';

test('exports removed, changed and added per file, package entry and version lines, and changeset bumps', async () => {
  const index = changed(
    'src/index.ts',
    ['export function parse(text: string, strict: boolean): Doc {', "export * from './render';", 'export { load as read };', 'export const VERSION = 2;'],
    ['export function parse(text: string): Doc {', 'export type Old = string;', "export * from './render';", 'export const VERSION = 2;'],
  );
  const pkg = changed('package.json', ['  "version": "1.3.0",', '  "description": "x",'], ['  "version": "1.2.0",', '  "main": "dist/index.js",']);
  const cs = changed('.changeset/parse.md', ['---', "'parser': minor", '---', '', 'Parse strictly.']);
  expect((await exportsDiff(input([index, pkg, cs]))).split('\n')).toEqual([
    'src/index.ts:',
    '- removed `Old`: export type Old = string;',
    '- changed `parse` (line 1): export function parse(text: string): Doc { -> export function parse(text: string, strict: boolean): Doc {',
    '- added `read` (line 3): export { load as read };',
    'package.json:',
    '- before: "version": "1.2.0",',
    '- before: "main": "dist/index.js",',
    '- after (line 1): "version": "1.3.0",',
    '.changeset/parse.md:',
    "- bump 'parser': minor",
  ]);
});

test('no export, entry point or bump changed says so', async () => {
  expect(await exportsDiff(input([changed('src/a.ts', ['const x = 1;'])]))).toBe('The pull request changes no exported name, no package entry point or version, and no changeset bump.');
});
