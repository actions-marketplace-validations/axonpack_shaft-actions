import { expect, test } from 'vitest';
import { flags } from '../flags.service';
import { changed, input } from './fixtures/input';

test('flags added lines read, with where the repo names them, and flags only removed lines read', async () => {
  const files = [
    changed('src/checkout.tsx', ["const on = useFeatureFlag('new-checkout');", 'if (featureFlags.fastPay) pay();'], ["if (isEnabled('old-banner')) show();"]),
    changed('app/views.py', ["    if flag_is_active(request, 'beta_search'):"], ['    if FEATURE_LEGACY_EXPORT:']),
  ];
  const tree = {
    'src/checkout.tsx': "useFeatureFlag('new-checkout'); featureFlags.fastPay",
    'src/menu.tsx': "useFeatureFlag('new-checkout')",
    'app/views.py': "flag_is_active(request, 'beta_search')",
    'app/export.py': 'if FEATURE_LEGACY_EXPORT: pass',
    'dist/bundle.js': "useFeatureFlag('new-checkout')",
  };
  expect(await flags(input(files, tree))).toBe(
    [
      'The repo reads feature flags in 4 files.',
      'Flags read on added lines:',
      '- `new-checkout` at src/checkout.tsx:1; named in src/checkout.tsx, src/menu.tsx',
      '- `fastPay` at src/checkout.tsx:2; named in src/checkout.tsx',
      '- `beta_search` at app/views.py:1; named in app/views.py',
      'Flags only removed lines read:',
      '- `old-banner` (was in src/checkout.tsx); named nowhere in the repo now',
      '- `FEATURE_LEGACY_EXPORT` (was in app/views.py); still named in app/export.py',
    ].join('\n'),
  );
});

test('with no flag in the diff, it only says whether the repo reads flags', async () => {
  const files = [changed('src/a.ts', ['const a = 1;'])];
  expect(await flags(input(files, { 'src/a.ts': 'x', 'src/b.ts': "getFeatureFlag('x')" }))).toBe('The repo reads feature flags, such as in src/b.ts.');
  expect(await flags(input(files, { 'src/a.ts': 'const flags = parse(argv);' }))).toBe('');
});
