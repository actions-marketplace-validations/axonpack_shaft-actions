import { expect, test } from 'vitest';
import { billedTokens } from '../tokens.util';

test('cache writes count 1.25 times, cache reads a tenth, input and output as they are', () => {
  expect(billedTokens({ input: 1000, output: 500, cache_read: 0, cache_write: 0 })).toBe(1500);
  expect(billedTokens({ input: 0, output: 0, cache_read: 1000, cache_write: 0 })).toBe(100);
  expect(billedTokens({ input: 0, output: 0, cache_read: 0, cache_write: 1000 })).toBe(1250);
  expect(billedTokens({ input: 120000, output: 6000, cache_read: 50000, cache_write: 6000 })).toBe(138500);
});
