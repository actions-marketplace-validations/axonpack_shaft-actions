import { expect, test } from 'vitest';
import { nativeChanges } from '../native-changes.service';
import { changed, input } from './fixtures/input';

const pkg = changed('package.json', ['    "expo-camera": "~17.0.0",', '    "react-native-mmkv": "^3.0.0",', '    "lodash": "^4.17.21",'], ['    "expo-camera": "~16.0.0",', '    "@react-native-community/netinfo": "11.0.0",']);
const tree = {
  'app.json': JSON.stringify({ expo: { name: 'app', version: '1.3.0', runtimeVersion: { policy: 'appVersion' } } }, null, 2),
  'apps/admin/app.config.ts': "export default { version: '2.0.0', runtimeVersion: '2.0.0' };",
};
const base = async (p: string) => ({ 'app.json': JSON.stringify({ expo: { name: 'app', version: '1.2.0', runtimeVersion: { policy: 'appVersion' } } }, null, 2), 'apps/admin/app.config.ts': tree['apps/admin/app.config.ts'] })[p];

test('native files, native packages, and each app config runtime version and version before and after', async () => {
  const files = [changed('ios/Podfile', ['pod "X"']), { ...changed('android/app/src/main/AndroidManifest.xml', ['<uses-permission />']), status: 'added' }, pkg, changed('src/App.tsx', ['x'])];
  expect((await nativeChanges(input(files, tree, { base }))).split('\n')).toEqual([
    'Native files changed:',
    '- ios/Podfile (modified, +1 -0)',
    '- android/app/src/main/AndroidManifest.xml (added, +1 -0)',
    'Packages with native code changed:',
    '- package.json: changed expo-camera ~16.0.0 -> ~17.0.0',
    '- package.json: removed @react-native-community/netinfo 11.0.0',
    '- package.json: added react-native-mmkv ^3.0.0',
    'App config, base branch -> pull request:',
    '- app.json runtimeVersion: { "policy": "appVersion" } (unchanged)',
    '- app.json version: "1.2.0" -> "1.3.0"',
    "- apps/admin/app.config.ts runtimeVersion: '2.0.0' (unchanged)",
    "- apps/admin/app.config.ts version: '2.0.0' (unchanged)",
  ]);
});

test('a JS-only change says no native change, and an app with no config says so', async () => {
  expect(await nativeChanges(input([changed('src/App.tsx', ['x']), changed('package.json', ['    "lodash": "^4.17.21",'])], tree))).toBe('');
  expect((await nativeChanges(input([changed('ios/Podfile', ['pod "X"'])]))).split('\n').at(-1)).toBe('The repo has no app.json or app.config file.');
});
