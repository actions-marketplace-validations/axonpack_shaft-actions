import { expect, test } from 'vitest';
import { mergeSettings } from '../settings.util';

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
