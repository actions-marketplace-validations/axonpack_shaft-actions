import { expect, test } from 'vitest';
import { pushHits } from '../push.util';
import { BAD_PUSH, GOOD_PUSH } from './fixtures';

const changes = (xs: { path: string; content: string }[]) => xs.map((x) => ({ path: x.path, content: Buffer.from(x.content) }));

test('the must-catch pushes each break a rule', () => {
  expect(pushHits(changes(BAD_PUSH), () => undefined).map((h) => h.rule)).toEqual(['push.pipe_shell', 'push.env_dump', 'push.blob']);
});

test('the benign pushes pass, and a line the file already had never counts', () => {
  expect(pushHits(changes(GOOD_PUSH), () => undefined)).toEqual([]);
  expect(pushHits(changes([BAD_PUSH[0]!]), () => BAD_PUSH[0]!.content)).toEqual([]);
  expect(pushHits(changes([{ path: 'bun.lock', content: 'x'.repeat(300) }]), () => undefined)).toEqual([]);
});
