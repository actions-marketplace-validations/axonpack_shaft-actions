import { expect, test } from 'vitest';
import { localeKeys } from '../locale-keys.service';
import { changed, input } from './fixtures/input';

const tree = {
  'src/locales/en.json': JSON.stringify({ home: { title: 'Home', cta: 'Start' }, bye: 'Bye' }),
  'src/locales/fr.json': JSON.stringify({ home: { title: 'Accueil' }, bye: 'Au revoir' }),
  'src/locales/de.json': JSON.stringify({ home: { title: 'Start', cta: 'Los' }, bye: 'Tschüss' }),
  'src/locales/es.json': '{ not json',
  'public/locales/en/common.json': JSON.stringify({ save: 'Save', cancel: 'Cancel' }),
  'public/locales/pt-BR/common.json': JSON.stringify({ save: 'Salvar' }),
  'public/locales/pt-BR/admin.json': JSON.stringify({}),
};
const base = async (p: string) => ({ 'src/locales/en.json': JSON.stringify({ home: { title: 'Home' }, bye: 'Bye' }), 'public/locales/en/common.json': JSON.stringify({ save: 'Save' }) })[p];

test('the keys a locale file adds against the base copy, and which sibling locales lack them', async () => {
  const files = [changed('src/locales/en.json', []), changed('public/locales/en/common.json', [])];
  expect((await localeKeys(input(files, tree, { base }))).split('\n')).toEqual([
    'src/locales/en.json (en): adds 1 key: `home.cta`',
    "- missing in src/locales/es.json (es): couldn't read it as a JSON object",
    '- missing in src/locales/fr.json (fr): `home.cta`',
    '- 1 of 3 other locales have them all.',
    'public/locales/en/common.json (en): adds 1 key: `cancel`',
    '- missing in public/locales/pt-BR/common.json (pt-BR): `cancel`',
    '- 0 of 1 other locales have them all.',
  ]);
});

test('no changed locale file says whether the repo has any', async () => {
  expect(await localeKeys(input([changed('src/App.tsx', ['<p>Hi</p>'])], tree))).toMatch(/^No locale file changed\. The repo has 7 locale files, such as /);
  expect(await localeKeys(input([changed('src/App.tsx', ['<p>Hi</p>'])]))).toMatch(/^No locale file changed, and the repo has no JSON locale files/);
});
