import { expect, test } from 'vitest';
import { DEFAULT_SKIP } from '../../consts/settings.const';
import { mergeRules, mergeSettings, parseConfig } from '../settings.util';

const inputs = (set: Record<string, string>) => (name: string) => set[name] ?? '';

test('an input beats the dashboard, the dashboard beats the default, per field', () => {
  expect(mergeSettings(inputs({ model: 'haiku' }), { model: 'opus', effort: 'high', depth: null })).toEqual({
    model: 'haiku',
    effort: 'high',
    depth: 'standard',
    nits: 'summary',
  });
});

test('without the dashboard, the defaults', () => {
  expect(mergeSettings(inputs({}))).toEqual({ model: 'auto', effort: 'auto', depth: 'standard', nits: 'summary' });
});

const PATH = '.github/shaft.yml';

test('parseConfig reads rules, skip and focus', () => {
  const text = 'rules: |\n  Every user-facing change needs a changeset.\nskip:\n  - "docs/generated/**"\nfocus: ["src/auth/**"]\n';
  expect(parseConfig(text, PATH)).toEqual({
    config: { rules: 'Every user-facing change needs a changeset.\n', skip: ['docs/generated/**'], focus: ['src/auth/**'] },
    unknown: [],
  });
});

test('parseConfig: a missing or empty file sets nothing', () => {
  expect(parseConfig(undefined, PATH)).toEqual({ config: {}, unknown: [] });
  expect(parseConfig('# only a comment\n', PATH)).toEqual({ config: {}, unknown: [] });
});

test('parseConfig: invalid YAML or a wrong type throws, naming the file', () => {
  expect(() => parseConfig('skip: [unclosed', PATH)).toThrow(".github/shaft.yml isn't valid YAML");
  expect(() => parseConfig('- a list', PATH)).toThrow('must be a map');
  expect(() => parseConfig('rules: [a]', PATH)).toThrow('rules must be text');
  expect(() => parseConfig('skip: dist/**', PATH)).toThrow('skip must be a list of globs');
  expect(() => parseConfig('focus: [1, 2]', PATH)).toThrow('focus must be a list of globs');
});

test('parseConfig: unknown keys are left out and returned', () => {
  expect(parseConfig('rules: x\nmodel: opus\nskipp: [a]\n', PATH)).toEqual({ config: { rules: 'x' }, unknown: ['model', 'skipp'] });
});

test('mergeRules: skip and focus come from the dashboard, then the file, then the default', () => {
  const file = { skip: ['file/**'], focus: ['file-focus/**'] };
  expect(mergeRules({ skip: ['dash/**'], focus: 'a/**\n\n b/** \n' }, file)).toMatchObject({ skip: ['dash/**'], focus: ['a/**', 'b/**'] });
  expect(mergeRules({ skip: null, focus: '' }, file)).toMatchObject({ skip: ['file/**'], focus: ['file-focus/**'] });
  expect(mergeRules({}, {})).toEqual({ rules: '', skip: DEFAULT_SKIP, focus: [] });
  expect(mergeRules({}, { skip: [] }).skip).toEqual([]);
});

test('mergeRules: the dashboard rules come first, then the file rules', () => {
  expect(mergeRules({ rules: 'Account and repo rules.' }, { rules: 'File rules.' }).rules).toBe('Account and repo rules.\n\nFile rules.');
  expect(mergeRules({ rules: null }, { rules: 'File rules.' }).rules).toBe('File rules.');
});
