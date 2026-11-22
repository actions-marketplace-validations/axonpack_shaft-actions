import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { changedFiles, readAll, report, runTool } from '../tool.service';

const DOCKERFILE = /(?:^|\/)Dockerfile[^/]*$/;

/** The `hadolint` facts, for `containers`: what the pinned hadolint reports on the changed Dockerfiles, with the repo's `.hadolint.yaml`. */
export const hadolint: Facts = async ({ files, checkout }) => {
  const dockerfiles = changedFiles(files, DOCKERFILE);
  if (!dockerfiles.length) return 'No Dockerfile changed, so hadolint had nothing to read. Compose files are for the model alone.';
  const run = await runTool('hadolint', ['--format', 'json', '--no-color', ...dockerfiles], readAll(checkout, [...dockerfiles, '.hadolint.yaml', '.hadolint.yml']));
  const issues: { file: string; line: number; code: string; level: string; message: string }[] = report('hadolint', run) ?? [];
  return factsText(
    issues.map((i) => `${i.file}:${i.line} ${i.code} (${i.level}): ${i.message}`),
    'hadolint found nothing in the changed Dockerfiles.',
  );
};
