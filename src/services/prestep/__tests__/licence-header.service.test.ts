import { expect, test } from 'vitest';
import { licenceHeader } from '../licence-header.service';
import { input } from './fixtures/input';

const added = (filename: string) => ({ filename, status: 'added', additions: 1, deletions: 0 });
const tree = { 'src/a.ts': '#!/usr/bin/env node\n// SPDX-License-Identifier: MIT\nx', 'src/b.ts': 'x', 'README.md': 'x' };

test('an added source file without the header is should-fix; with no header set it is off', () => {
  const files = [added('src/a.ts'), added('src/b.ts'), added('README.md'), { ...added('src/c.ts'), status: 'modified' }];
  expect(licenceHeader(input(files, tree), { rules: '\n// SPDX-License-Identifier: MIT\n' }).map((f) => f.file)).toEqual(['src/b.ts']);
  expect(licenceHeader(input(files, tree))).toEqual([]);
});
