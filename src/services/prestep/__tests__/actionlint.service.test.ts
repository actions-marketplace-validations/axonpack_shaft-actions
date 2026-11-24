import { beforeEach, expect, test, vi } from 'vitest';
import { answers, asked } from './fixtures/linters';
import { changed, input } from './fixtures/input';

vi.mock('../../tool.service', async (real) => (await import('./fixtures/linters')).fakeLinters(await real()));
const { actionlint } = await import('../actionlint.service');

beforeEach(() => {
  asked.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

const workflow = ['on: pull_request', 'jobs:', '  a:', '    permissions: write-all', '    steps:', '      - uses: actions/checkout@v7', '      - uses: someone/thing@v1', "      - uses: 'pinned/ok@0123456789abcdef0123456789abcdef01234567'", '      - uses: ./local'];

test('unpinned third-party actions and write-all on added lines, then what actionlint reports on the changed workflows', async () => {
  answers.actionlint = { out: '[{"filepath":".github/workflows/ci.yml","line":8,"kind":"expression","message":"\\"github.event.pull_request.title\\" is potentially untrusted."}]', status: 1 };
  const tree = { '.github/workflows/ci.yml': workflow.join('\n'), '.github/actionlint.yaml': 'self-hosted-runner: {}', 'src/a.ts': 'x' };
  const facts = await actionlint(input([changed('.github/workflows/ci.yml', workflow), changed('action.yml', ['    - uses: other/step@main']), changed('src/a.ts', ['x'])], tree));
  expect(facts).toBe(
    [
      '.github/workflows/ci.yml:4 permissions: write-all',
      '.github/workflows/ci.yml:7 uses someone/thing@v1, not pinned to a commit SHA',
      'action.yml:1 uses other/step@main, not pinned to a commit SHA',
      '.github/workflows/ci.yml:8 actionlint expression: "github.event.pull_request.title" is potentially untrusted.',
    ].join('\n'),
  );
  expect(asked).toEqual([
    {
      name: 'actionlint',
      args: ['-format', '{{json .}}', '-shellcheck=', '-pyflakes=', '-no-color', '.github/workflows/ci.yml'],
      files: { '.github/workflows/ci.yml': tree['.github/workflows/ci.yml'], '.github/actionlint.yaml': 'self-hosted-runner: {}' },
    },
  ]);
});

test("when actionlint can't run, the pin scan still comes back with the reason; only an action.yml runs no linter", async () => {
  answers.actionlint = new Error("the actionlint 1.7.12 download doesn't match the sha256 this release records, so it wasn't run");
  const facts = await actionlint(input([changed('.github/workflows/ci.yml', ['      - uses: someone/thing@v1'])], { '.github/workflows/ci.yml': '      - uses: someone/thing@v1' }));
  expect(facts).toBe(".github/workflows/ci.yml:1 uses someone/thing@v1, not pinned to a commit SHA\nactionlint didn't run: the actionlint 1.7.12 download doesn't match the sha256 this release records, so it wasn't run.");
  asked.length = 0;
  expect(await actionlint(input([changed('action.yml', ['runs:'])], {}))).toBe('');
  expect(asked).toEqual([]);
});
