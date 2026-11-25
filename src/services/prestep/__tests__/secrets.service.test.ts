import { expect, test } from 'vitest';
import { secrets } from '../secrets.service';
import { changed, input } from './fixtures/input';

// Built from parts, so this file holds no whole key a scanner would flag.
const AWS = ['AKIA', 'Q3VJ7RZ2K5WMT8PL'].join('');
const GH = ['ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');

test('a known key format on an added line is a blocking finding that names the kind and the line, never the value', () => {
  const found = secrets(input([changed('src/a.ts', ['const a = 1;', `const key = '${AWS}';`, `token: ${GH}`, '-----BEGIN RSA PRIVATE KEY-----'])]));
  expect(found.map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`)).toEqual([
    'blocking src/a.ts:2 Possible AWS access key in an added line',
    'blocking src/a.ts:3 Possible GitHub token in an added line',
    'blocking src/a.ts:4 Possible private key in an added line',
  ]);
  expect(JSON.stringify(found)).not.toContain(AWS.slice(4));
  expect(JSON.stringify(found)).not.toContain(GH.slice(4));
});

test('removed and context lines, placeholders and the docs example key are left alone', () => {
  const file = { ...changed('src/a.ts', []), patch: `@@ -1,2 +1,3 @@\n-old ${AWS}\n context ${GH}\n+AKIAXXXXXXXXXXXXXXXX\n+AKIAIOSFODNN7EXAMPLE` };
  expect(secrets(input([file]))).toEqual([]);
});

test('a long random string is should-fix with no value shown; ordinary strings and lockfiles pass, and the API sets the thresholds', () => {
  const random = ['q8Zr2LmX9', 'vTn4Ka7Wp', 'E1sYd6Hc3'].join('');
  const file = changed('src/a.ts', [`const apiSecret = "${random}";`, 'const name = "a-perfectly-ordinary-name";', 'id: 123e4567-e89b-12d3-a456-426614174000']);
  const found = secrets(input([file, changed('bun.lock', [`"x": "${random}",`])]));
  expect(found.map((f) => `${f.severity} ${f.file}:${f.line}`)).toEqual(['should-fix src/a.ts:1']);
  expect(JSON.stringify(found)).not.toContain(random);
  expect(secrets(input([file]), { entropy: 6 })).toEqual([]);
});
