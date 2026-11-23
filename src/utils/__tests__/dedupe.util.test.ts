import { describe, expect, test } from 'vitest';
import { dedupe } from '../dedupe.util';
import type { Finding } from '../render.util';

const f = (step: string, severity: Finding['severity'], line = 10, file = 'a.ts', end_line?: number): Finding => ({ step, severity, file, line, end_line, title: `${step} title`, body: `${step} body` });

describe('dedupe', () => {
  test('two checklists on one line: the earlier one in the order keeps it, at the higher severity', () => {
    const out = dedupe([f('tests', 'blocking'), f('security', 'nit')], ['security', 'tests']);
    expect(out).toEqual([{ ...f('security', 'blocking'), body: 'security body\n\nAlso found by `tests`.' }]);
  });

  test('the order decides, not the order found', () => {
    expect(dedupe([f('security', 'nit'), f('tests', 'should-fix')], ['tests', 'security'])).toEqual([{ ...f('tests', 'should-fix'), body: 'tests body\n\nAlso found by `security`.' }]);
  });

  test('overlapping ranges merge; other lines, other files and the same checklist stay apart', () => {
    expect(dedupe([f('a', 'nit', 8, 'a.ts', 12), f('b', 'nit', 12)], ['a', 'b'])).toHaveLength(1);
    expect(dedupe([f('a', 'nit', 8), f('b', 'nit', 9), f('c', 'nit', 8, 'b.ts'), f('a', 'nit', 8)], ['a', 'b', 'c'])).toHaveLength(4);
  });
});
