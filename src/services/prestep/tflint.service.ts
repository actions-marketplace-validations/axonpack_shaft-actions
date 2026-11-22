import { dirname } from 'node:path';
import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { changedFiles, readAll, report, runTool } from '../tool.service';

/**
 * The `tflint` facts, for `iac`: what the pinned tflint reports on each folder with a changed `.tf` or
 * `.tfvars` file, with its built-in Terraform rules only. The repo's `.tflint.hcl` and plugins are
 * never read, since a plugin is a program, and modules aren't followed.
 * ponytail: no parsed resource diff yet; the model reads the diff for that.
 */
export const tflint: Facts = async ({ files, checkout }) => {
  const changed = changedFiles(files, /\.(?:tf|tfvars)$/);
  if (!changed.length) return 'No Terraform file changed, so tflint had nothing to read. Kubernetes, Helm and CloudFormation files are for the model alone.';
  const dirs = [...new Set(changed.map((f) => dirname(f)))];
  const paths = checkout.find(dirs.map((d) => (d === '.' ? '*.{tf,tfvars}' : `${d}/*.{tf,tfvars}`)));
  const run = await runTool('tflint', ['--recursive', '--format', 'json', '--call-module-type=none'], readAll(checkout, paths), { TFLINT_PLUGIN_DIR: '/nonexistent' });
  const { issues = [], errors = [] } = (report('tflint', run) ?? {}) as {
    issues?: { rule: { name: string; severity: string }; message: string; range: { filename: string; start: { line: number } } }[];
    errors?: { message: string }[];
  };
  return factsText(
    [...issues.map((i) => `${i.range.filename}:${i.range.start.line} ${i.rule.name} (${i.rule.severity}): ${i.message}`), ...errors.map((e) => `tflint error: ${e.message}`)],
    'tflint found nothing in the changed Terraform folders.',
  );
};
