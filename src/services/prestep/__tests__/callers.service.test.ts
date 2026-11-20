import { expect, test } from 'vitest';
import { callers } from '../callers.service';
import { SEARCH_MAX } from '../search.service';
import { changed, input } from './fixtures/input';

const util = changed('src/utils/price.ts', ['export function price(cents: number, currency: string) {', 'export const VAT = 0.2;'], ['export function price(cents: number) {', 'export const OLD_RATE = 0.1;']);
const tree = {
  'src/utils/price.ts': 'export function price(cents: number, currency: string) {}\nexport const VAT = 0.2;\nprice(1, "x");',
  'src/cart.ts': "import { price } from './utils/price';\n\nconst total = price(100);\nconst again = price(5);",
  'src/checkout.ts': "import { price, OLD_RATE } from './utils/price';\nprice(1, 'eur');",
  'dist/index.js': 'price(1)',
  'docs/price.md': 'price',
  'src/pricey.ts': 'const priceless = 1;',
};

test('each changed export with the other code files that name it, and their lines; files the PR changes are marked', async () => {
  const facts = await callers(input([util, changed('src/checkout.ts', ["price(1, 'eur');"])], tree));
  expect(facts.split('\n')).toEqual([
    '`price` (changed in src/utils/price.ts:1): named in 2 other files',
    '- src/cart.ts:1,3,4',
    '- src/checkout.ts:1,2 (changed in this pull request)',
    '`VAT` (added in src/utils/price.ts:2): no other code file names it',
    '`OLD_RATE` (removed in src/utils/price.ts): named in 1 other file',
    '- src/checkout.ts:1 (changed in this pull request)',
  ]);
});

test('no export changed says so, and a search over the caps says what it cut', async () => {
  expect(await callers(input([changed('src/a.ts', ['const x = 1;'])], tree))).toBe('The pull request adds, removes or changes no exported name.');
  const many = changed('src/many.ts', Array.from({ length: SEARCH_MAX.names + 2 }, (_, i) => `export const n${i} = ${i};`));
  expect((await callers(input([many], tree))).split('\n')[0]).toBe(`Search cut: searched for the first ${SEARCH_MAX.names} of ${SEARCH_MAX.names + 2} names.`);
});
