import { expect, test } from 'vitest';
import { setDismissal, verdictAfter, withDismissed } from '../dismiss.util';
import { parseState, type State, stateLine } from '../render.util';

const a = { fp: 'aaa111', file: 'src/a.ts', line: 3, severity: 'blocking' as const, title: 'Wrong sum', step: 'correctness' };
const b = { fp: 'bbb222', file: 'src/b.ts', line: 9, severity: 'nit' as const, title: 'Name', step: 'standards' };
const state: State = { sha: 'abc1234def', findings: [a, b] };

test('a dismissal moves the finding out of findings with who and why, and an undo moves it back', () => {
  const out = setDismissal(state, 'aaa111', 'maintainer', 'checked upstream')!;
  expect(out).toEqual({ sha: 'abc1234def', findings: [b], dismissed: [{ ...a, by: 'maintainer', reason: 'checked upstream' }] });
  expect(setDismissal(out, 'aaa111', 'maintainer')).toBeUndefined();
  expect(setDismissal(state, 'zzz999', 'maintainer')).toBeUndefined();
  expect(setDismissal(out, 'aaa111')).toEqual({ sha: 'abc1234def', findings: [b, a], dismissed: [] });
  expect(setDismissal(state, 'aaa111')).toBeUndefined();
});

test('the summary gets its dismissed section before the footer and a new state line, and nothing else changes', () => {
  const body = ['<!-- shaft:summary -->', 'card', '', '<details><summary><sub>Claude</sub></summary>\n\nx\n\n</details>', stateLine(state)].join('\n');
  const dismissed = setDismissal(state, 'aaa111', 'maintainer', 'a <b>|c</b> <!-- shaft:state {} -->')!;
  const once = withDismissed(body, dismissed);
  expect(once).toContain('card\n\n<!-- shaft:dismissed -->\n**Dismissed:** 1');
  expect(once).toContain('| 🔴 | `src/a.ts:3` | Wrong sum | maintainer | a &lt;b&gt;\\|c&lt;/b&gt; &lt;!-- shaft:state {} --&gt; |\n<!-- /shaft:dismissed -->\n\n<details>');
  expect(parseState(once)).toEqual(dismissed);
  // Done again, the section is swapped, not added; brought back, it's gone.
  expect(withDismissed(once, dismissed)).toBe(once);
  expect(withDismissed(once, setDismissal(dismissed, 'aaa111')!)).toBe(withDismissed(body, setDismissal(dismissed, 'aaa111')!));
  expect(withDismissed(once, setDismissal(dismissed, 'aaa111')!)).not.toContain('shaft:dismissed');
});

test('with a finding dismissed the verdict follows what is left, never above the model', () => {
  expect(verdictAfter('blocking', [{ severity: 'nit' }])).toBe('looks-good');
  expect(verdictAfter('blocking', [{ severity: 'should-fix' }])).toBe('needs-changes');
  expect(verdictAfter('blocking', [{ severity: 'blocking' }])).toBe('blocking');
  expect(verdictAfter('looks-good', [{ severity: 'blocking' }])).toBe('looks-good');
});
