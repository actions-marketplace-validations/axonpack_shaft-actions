import { expect, test } from 'vitest';
import { cleanOutput, flaggedLines, scanOutput } from '../output.util';
import { BAD_OUTPUT } from './fixtures';

test('token shapes are redacted; images are left to prose()', () => {
  expect(cleanOutput(BAD_OUTPUT.image).text).toBe(BAD_OUTPUT.image);
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

test('flaggedLines adds this run’s strike to the API’s count, names its rule, and never quotes the text', () => {
  const names = (r: string) => `rule ${r}`;
  const lines = flaggedLines(
    [{ user_id: 1, login: 'ana', strikes: 1 }, { user_id: 2, login: 'bo', strikes: 2 }],
    [{ user_id: 2, login: 'bo', rule: 'spoofing.tags', severity: 'strike' }, { user_id: 3, login: 'cy', rule: 'override.ignore', severity: 'warning' }],
    names,
  );
  expect(lines).toEqual([
    '⚠️ @ana is flagged (1 of 3). A third strike stops Axon Shaft from running for them on this account.',
    '@bo is blocked on this account after 3 strikes. An admin can review and clear them on the dashboard.',
  ]);
});
