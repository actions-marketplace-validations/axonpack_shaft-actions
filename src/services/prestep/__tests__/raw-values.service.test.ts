import { expect, test } from 'vitest';
import { rawValues } from '../raw-values.service';
import { changed, input } from './fixtures/input';

test('raw colours and sizes on added UI and style lines, outside theme files, with where the tokens live', async () => {
  const files = [
    changed('src/Button.tsx', ['<div style={{ color: "#FF0000", padding: "12px" }}>', '  // #fff in a comment', 'const s = StyleSheet.create({ box: { marginTop: 8, flex: 1 } });', '<a href="#top">&#123;</a>']),
    changed('src/app.css', ['.card { background: rgba(0, 0, 0, 0.5); border: 1px solid #eee; }']),
    changed('src/theme/colors.ts', ['export const red = "#ff0000";']),
    changed('README.md', ['Use #ff0000.']),
  ];
  const tree = { 'src/theme/colors.ts': '', 'src/tokens.css': '', 'src/Button.tsx': '' };
  expect((await rawValues(input(files, tree))).split('\n')).toEqual([
    'Theme and token files in the repo: src/theme/colors.ts, src/tokens.css.',
    'Raw values on added lines:',
    '- src/Button.tsx:1 #FF0000, 12px',
    '- src/Button.tsx:3 marginTop: 8',
    '- src/app.css:1 rgba(0, 0, 0, 0.5), 1px, #eee',
  ]);
});

test('no raw value says so', async () => {
  expect(await rawValues(input([changed('src/a.tsx', ['<p className="text-sm">Hi</p>'])]))).toBe('');
});
