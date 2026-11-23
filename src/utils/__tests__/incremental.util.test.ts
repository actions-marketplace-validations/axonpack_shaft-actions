import { describe, expect, test } from 'vitest';
import { changedSince, diffHash, diffHashes, HASHED_FILES_MAX, nothingChangedNote } from '../incremental.util';

describe('diff hashes', () => {
  test('a rebase keeps the hash: only the hunks\' line numbers moved', () => {
    expect(diffHash('@@ -1,2 +1,3 @@ fn()\n a\n+b')).toBe(diffHash('@@ -40,2 +52,3 @@ fn()\n a\n+b'));
    expect(diffHash('@@ -1 +1 @@\n+b')).not.toBe(diffHash('@@ -1 +1 @@\n+c'));
    expect(diffHash(undefined)).toBeUndefined();
  });

  test('changedSince: added, changed and removed files; undefined without the last review\'s hashes or with other settings', () => {
    const prior = { sha: 'a', findings: [], files: { 'a.ts': 'h1', 'gone.ts': 'h2', 'same.ts': 'h3' }, config: 'c', checked: [] };
    expect(changedSince(prior, { 'a.ts': 'new', 'same.ts': 'h3', 'added.ts': 'h4' }, 'c')).toEqual(['a.ts', 'added.ts', 'gone.ts']);
    expect(changedSince(prior, { 'a.ts': 'h1', 'gone.ts': 'h2', 'same.ts': 'h3' }, 'c')).toEqual([]);
    expect(changedSince(prior, prior.files, 'other')).toBeUndefined();
    expect(changedSince({ sha: 'a', findings: [] }, {}, 'c')).toBeUndefined();
    expect(diffHashes(Array.from({ length: HASHED_FILES_MAX + 1 }, (_, i) => ({ filename: `${i}`, patch: '' })))).toBeUndefined();
  });

  test('the note replaces an earlier one', () => {
    const once = nothingChangedNote('<!-- shaft:summary -->\n> [!TIP]', 'abc1234def');
    expect(nothingChangedNote(once, 'fff0000aaa')).toBe('<!-- shaft:summary -->\nNothing changed since the last review, so `fff0000` got no model call. The review below still holds.\n\n> [!TIP]');
  });
});
