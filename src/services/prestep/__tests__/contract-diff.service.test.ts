import { beforeEach, expect, test, vi } from 'vitest';
import { answers, asked } from './fixtures/linters';
import { changed, input } from './fixtures/input';

vi.mock('../../tool.service', async (real) => (await import('./fixtures/linters')).fakeLinters(await real()));
const { contractDiff } = await import('../contract-diff.service');

beforeEach(() => {
  asked.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

test('oasdiff on the base and head copies of each changed OpenAPI file; a new one has nothing to compare; GraphQL is left to the model', async () => {
  answers.oasdiff = { out: '[{"id":"api-path-removed-without-deprecation","text":"API path removed without deprecation","level":3,"operation":"GET","path":"/b"}]' };
  const base = async (p: string) => (p === 'api/openapi.yaml' ? 'base spec' : undefined);
  const facts = await contractDiff(input([changed('api/openapi.yaml', ['x']), changed('new/openapi.json', ['{}']), changed('schema.graphql', ['type A'])], { 'api/openapi.yaml': 'head spec', 'new/openapi.json': '{}' }, { base }));
  expect(facts).toBe(
    [
      'api/openapi.yaml GET /b: API path removed without deprecation (api-path-removed-without-deprecation, breaking)',
      'new/openapi.json: new in this pull request, so there is nothing to compare.',
      'GraphQL schemas changed: no tool compares them here, so read their diff.',
    ].join('\n'),
  );
  expect(asked).toEqual([{ name: 'oasdiff', args: ['breaking', 'base/api/openapi.yaml', 'head/api/openapi.yaml', '--format', 'json'], files: { 'base/api/openapi.yaml': 'base spec', 'head/api/openapi.yaml': 'head spec' } }]);
});

test("buf breaking on the whole .proto tree against the same tree with the base branch's copies; its failure is a line, not the end", async () => {
  answers.buf = { out: '{"path":"head/acme/a.proto","start_line":4,"type":"FIELD_NO_DELETE","message":"Previously present field \\"2\\" with name \\"age\\" on message \\"A\\" was deleted."}\n', status: 100 };
  const tree = { 'acme/a.proto': 'head a', 'acme/b.proto': 'b', 'acme/new.proto': 'new', 'buf.yaml': 'version: v2' };
  const base = async (p: string) => ({ 'acme/a.proto': 'base a', 'acme/gone.proto': 'gone' })[p];
  const files = [changed('acme/a.proto', ['x']), { ...changed('acme/new.proto', ['new']), status: 'added' }, { ...changed('acme/gone.proto', []), status: 'removed' }];
  expect(await contractDiff(input(files, tree, { base }))).toBe('acme/a.proto:4 FIELD_NO_DELETE: Previously present field "2" with name "age" on message "A" was deleted.');
  expect(asked[0]!.args).toEqual(['breaking', 'head', '--against', 'base', '--error-format', 'json']);
  expect(asked[0]!.files).toEqual({
    'head/acme/a.proto': 'head a',
    'head/acme/b.proto': 'b',
    'head/acme/new.proto': 'new',
    'head/buf.yaml': 'version: v2',
    'base/acme/a.proto': 'base a',
    'base/acme/b.proto': 'b',
    'base/acme/gone.proto': 'gone',
    'base/buf.yaml': 'version: v2',
  });
  answers.buf = { out: '', err: 'Failure: acme/a.proto: import "x.proto": file does not exist', status: 1 };
  expect(await contractDiff(input([changed('acme/a.proto', ['x'])], tree, { base }))).toBe("buf didn't run: Failure: acme/a.proto: import \"x.proto\": file does not exist.");
});
