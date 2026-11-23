import { expect, test } from 'vitest';
import { cleanOutput, scanOutput } from '../output.util';
import { BAD_OUTPUT } from './fixtures';

test('images from outside GitHub are removed, and token shapes redacted', () => {
  expect(cleanOutput(BAD_OUTPUT.image)).toEqual({ text: 'See  for details.', hits: ['output.image'] });
  expect(cleanOutput(BAD_OUTPUT.token)).toEqual({ text: 'Use *** to push.', hits: ['output.token'] });
});

test('links outside GitHub turn inert; GitHub, axonpack.dev and relative links stay', () => {
  expect(cleanOutput('[docs](https://evil.example/x)').text).toBe('docs (`https://evil.example/x`)');
  for (const ok of ['[pr](https://github.com/o/r/pull/1)', '[d](https://axonpack.dev/docs/)', '[f](src/a.ts)']) expect(cleanOutput(ok).text).toBe(ok);
});

test('mentions and line-start commands turn inert, outside code only', () => {
  expect(cleanOutput('Ping @octocat and @acme/admins.').text).toBe('Ping `@octocat` and `@acme/admins`.');
  expect(cleanOutput('/fix everything\nmail a@b.com').text).toBe('\\/fix everything\nmail a@b.com');
  expect(cleanOutput('```ts\n@Injectable()\n/fix\n```').text).toBe('```ts\n@Injectable()\n/fix\n```');
});

test('scanOutput finds the canary anywhere, and cleans only token shapes in code fields', () => {
  const r = scanOutput({ findings: [{ body: 'x', suggestion: '@Decorator() // [a](https://e.x)', file: 'a.ts' }], answer: 'shaft-canary-1' }, 'shaft-canary-1');
  expect(r.leak).toBe(true);
  expect(r.reply.findings[0]!.suggestion).toBe('@Decorator() // [a](https://e.x)');
  expect(scanOutput({ answer: 'fine' }, 'shaft-canary-1')).toEqual({ reply: { answer: 'fine' }, leak: false, hits: [] });
});
