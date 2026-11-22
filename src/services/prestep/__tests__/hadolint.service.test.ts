import { beforeEach, expect, test, vi } from 'vitest';
import { answers, asked } from './fixtures/linters';
import { changed, input } from './fixtures/input';

vi.mock('../../tool.service', async (real) => (await import('./fixtures/linters')).fakeLinters(await real()));
const { hadolint } = await import('../hadolint.service');

beforeEach(() => {
  asked.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

test("hadolint's report on the changed Dockerfiles, with the repo's config; a compose file alone runs nothing", async () => {
  answers.hadolint = { out: '[{"code":"DL3006","file":"api/Dockerfile","level":"warning","line":1,"message":"Always tag the version of an image explicitly"}]', status: 1 };
  const tree = { 'api/Dockerfile': 'FROM node', '.hadolint.yaml': 'ignored: []' };
  expect(await hadolint(input([changed('api/Dockerfile', ['FROM node']), { ...changed('old/Dockerfile', []), status: 'removed' }], tree))).toBe(
    'api/Dockerfile:1 DL3006 (warning): Always tag the version of an image explicitly',
  );
  expect(asked).toEqual([{ name: 'hadolint', args: ['--format', 'json', '--no-color', 'api/Dockerfile'], files: tree }]);
  asked.length = 0;
  expect(await hadolint(input([changed('docker-compose.yml', ['services:'])], {}))).toMatch(/^No Dockerfile changed/);
  expect(asked).toEqual([]);
});

test("a failed install or a broken report throws, so the facts say why and the model reviews alone", async () => {
  answers.hadolint = new Error('hadolint runs only on Linux runners on x64 or arm64, and this one is darwin arm64');
  await expect(hadolint(input([changed('Dockerfile', ['FROM node'])], { Dockerfile: 'FROM node' }))).rejects.toThrow('runs only on Linux');
  answers.hadolint = { out: 'oops', err: 'hadolint: parse error', status: 2 };
  await expect(hadolint(input([changed('Dockerfile', ['FROM node'])], { Dockerfile: 'FROM node' }))).rejects.toThrow('hadolint gave no report: hadolint: parse error');
});
