import { beforeEach, expect, test, vi } from 'vitest';
import { answers, asked } from './fixtures/linters';
import { changed, input } from './fixtures/input';

vi.mock('../../tool.service', async (real) => (await import('./fixtures/linters')).fakeLinters(await real()));
const { tflint } = await import('../tflint.service');

beforeEach(() => {
  asked.length = 0;
  for (const k of Object.keys(answers)) delete answers[k];
});

test("tflint on each changed folder's Terraform files, never the repo's .tflint.hcl or plugins", async () => {
  answers.tflint = {
    out: JSON.stringify({
      issues: [{ rule: { name: 'terraform_unused_declarations', severity: 'warning' }, message: 'variable "unused" is declared but not used', range: { filename: 'infra/main.tf', start: { line: 4 } } }],
      errors: [{ message: 'Failed to load configurations' }],
    }),
    status: 2,
  };
  const tree = { 'infra/main.tf': 'variable "unused" {}', 'infra/vars.tfvars': 'a = 1', 'infra/.tflint.hcl': 'plugin "evil" {}', 'infra/.tflint.d/plugins/evil': 'binary', 'other/x.tf': '' };
  expect(await tflint(input([changed('infra/main.tf', ['variable "unused" {}'])], tree))).toBe(
    'infra/main.tf:4 terraform_unused_declarations (warning): variable "unused" is declared but not used\ntflint error: Failed to load configurations',
  );
  expect(asked).toEqual([
    {
      name: 'tflint',
      args: ['--recursive', '--format', 'json', '--call-module-type=none'],
      files: { 'infra/main.tf': 'variable "unused" {}', 'infra/vars.tfvars': 'a = 1' },
      env: { TFLINT_PLUGIN_DIR: '/nonexistent' },
    },
  ]);
  expect(await tflint(input([changed('k8s/deploy.yaml', ['kind: Deployment'])], {}))).toMatch(/^No Terraform file changed/);
});
