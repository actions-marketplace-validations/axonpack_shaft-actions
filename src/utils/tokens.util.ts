/** What a cache read and a cache write weigh against a plain input token. */
export const CACHE_WEIGHT = { read: 0.1, write: 1.25 };

/**
 * Tokens weighted by what they cost against plain input: a cache write costs 1.25 times as much, a
 * cache read a tenth, and output counts as it is. A run reads the same cached prompt on every turn,
 * so the raw total can be several times what was billed.
 */
export const billedTokens = (t: { input: number; output: number; cache_read: number; cache_write: number }) =>
  Math.round(t.input + t.output + CACHE_WEIGHT.write * t.cache_write + CACHE_WEIGHT.read * t.cache_read);
