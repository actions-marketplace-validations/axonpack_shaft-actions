import { expect, test } from 'vitest';
import { logLines } from '../log-lines.service';
import { changed, input } from './fixtures/input';

test('log, metric, analytics and error-report calls on added lines, with kind and code, outside tests', async () => {
  const files = [
    changed(
      'src/checkout.ts',
      [
        "logger.info('paid', { email: user.email });",
        'const total = sum(items);',
        "Sentry.captureException(err, { extra: { card } });",
        "analytics.track('Checkout', { userId });",
        "metrics.increment('checkout.paid');",
        "console.log('debug', token);",
        'const printer = makePrinter();',
      ],
      ["console.log('old');"],
    ),
    changed('app/views.py', ['    logging.warning("bad login for %s", email)', '    print(request.headers)']),
    changed('main.go', ['\tlog.Printf("user %s", u.Email)', '\tfmt.Println(token)']),
    changed('src/__tests__/checkout.test.ts', ["console.log('in a test');"]),
    changed('README.md', ['console.log("docs")']),
  ];
  expect(await logLines(input(files))).toBe(
    [
      'Log, metric, analytics and error-report calls on added lines:',
      "- src/checkout.ts:1 log: logger.info('paid', { email: user.email });",
      '- src/checkout.ts:3 error report: Sentry.captureException(err, { extra: { card } });',
      "- src/checkout.ts:4 analytics: analytics.track('Checkout', { userId });",
      "- src/checkout.ts:5 metric: metrics.increment('checkout.paid');",
      "- src/checkout.ts:6 log: console.log('debug', token);",
      '- app/views.py:1 log: logging.warning("bad login for %s", email)',
      '- app/views.py:2 log: print(request.headers)',
      '- main.go:1 log: log.Printf("user %s", u.Email)',
      '- main.go:2 log: fmt.Println(token)',
    ].join('\n'),
  );
});

test('a long line is cut, and a diff with no such call says so', async () => {
  const facts = await logLines(input([changed('a.ts', [`console.log('${'x'.repeat(300)}');`])]));
  expect(facts.split('\n')[1]).toMatch(/^- a\.ts:1 log: console\.log\('x{187}\.\.\.$/);
  expect(await logLines(input([changed('a.ts', ['const a = 1;'])]))).toBe('');
});
