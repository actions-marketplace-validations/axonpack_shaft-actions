/**
 * Tokens weighted by what they cost against plain input: a cache write costs 1.25 times as much, a
 * cache read a tenth, and output counts as it is. A run reads the same cached prompt on every turn,
 * so the raw total can be several times what was billed.
 */
export const billedTokens = (t: { input: number; output: number; cache_read: number; cache_write: number }) => Math.round(t.input + t.output + 1.25 * t.cache_write + 0.1 * t.cache_read);
