import { expect, test } from 'vitest';
import { imports } from '../imports.service';
import { changed, input } from './fixtures/input';

const tree = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { react: '19' }, devDependencies: { '@acme/ui': '1' } }),
  'packages/core/package.json': JSON.stringify({ name: '@app/core' }),
  'tsconfig.json': '{ "compilerOptions": { "paths": { "@lib/*": ["src/lib/*"] }, "lib": ["dom"] } }',
  'requirements.txt': 'Flask==3.0\npython-dateutil==2.9\n',
  'app/models.py': '',
};

test('a JS or TS import no package.json lists, past builtins, workspace packages, aliases and relative paths', async () => {
  const f = changed('src/a.tsx', [
    "import React from 'react';",
    "import { Button } from '@acme/ui/button';",
    "import { core } from '@app/core';",
    "import fs from 'node:fs';",
    "import path from 'path';",
    "import { x } from './x';",
    "import { y } from '@lib/y';",
    "import { z } from '@/z';",
    "import pad from 'left-padx/index.js';",
    "const q = await import('@fake/query');",
    "const r = require('requests-js');",
  ]);
  expect((await imports(input([f], tree))).split('\n')).toEqual([
    'Read 2 package.json files.',
    '- src/a.tsx:9 `left-padx`: no package.json lists it',
    '- src/a.tsx:10 `@fake/query`: no package.json lists it',
    '- src/a.tsx:11 `requests-js`: no package.json lists it',
  ]);
});

test('a Python import no manifest names and no module in the repo has', async () => {
  const f = changed('app/views.py', ['from flask import Flask', 'import dateutil.parser, os', 'from app.models import User', 'import python_dateutil', 'from fastapi import FastAPI']);
  const facts = await imports(input([f], tree));
  expect(facts.split('\n').map((l) => l.split(':').slice(0, 2).join(':'))).toEqual(['Read 1 Python manifest.', '- app/views.py:2 `dateutil`', '- app/views.py:2 `os`', '- app/views.py:5 `fastapi`']);
});

test('nothing missing or nothing imported says so', async () => {
  expect(await imports(input([changed('src/a.ts', ["import React from 'react';"])], tree))).toBe('');
  expect(await imports(input([changed('src/a.ts', ['const x = 1;'])], tree))).toBe('');
});
