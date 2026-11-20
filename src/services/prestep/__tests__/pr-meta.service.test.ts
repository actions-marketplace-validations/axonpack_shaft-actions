import { expect, test } from 'vitest';
import { prMeta } from '../pr-meta.service';
import { input } from './fixtures/input';

const TEMPLATE = { path: '.github/pull_request_template.md', text: '## What changed\n<!-- describe -->\n\n## Testing\n\nFixes # (issue)\n' };
const run = (title: string, body: string, guides = [TEMPLATE]) =>
  prMeta(input([], {}, { pr: { ...input([]).pr, title, body }, guides })).map((f) => `${f.severity} ${f.file}:${f.line} ${f.title}`);

test('each template section missing or left empty, and no linked issue, is a nit at the template line', () => {
  expect(run('fix: a', '## What changed\n<!-- describe -->\n')).toEqual([
    'nit .github/pull_request_template.md:1 Template section "What changed" is empty',
    'nit .github/pull_request_template.md:4 Template section "Testing" is missing',
    'nit .github/pull_request_template.md:6 No linked issue',
  ]);
});

test('a filled template with a linked issue has no findings', () => {
  expect(run('fix: a', '## What changed\nThe sum.\n\n## testing\nUnit tests.\n\nFixes #12')).toEqual([]);
});

test('a guide that asks for Conventional Commits checks the title; without one, any title passes', () => {
  const guide = { path: 'CONTRIBUTING.md', text: '# Contributing\n\nTitles follow Conventional Commits.\n' };
  expect(run('Add a thing', '', [guide])).toEqual(["nit CONTRIBUTING.md:3 Title isn't a Conventional Commit"]);
  expect(run('feat(api)!: add a thing', '', [guide])).toEqual([]);
  expect(run('Add a thing', '', [])).toEqual([]);
});
