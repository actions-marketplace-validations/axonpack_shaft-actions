import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';
import { changedFiles, readAll, report, runTool } from '../tool.service';

const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const ACTION = /(?:^|\/)action\.ya?ml$/;
const USES = /^\s*(?:-\s*)?uses:\s*['"]?([^'"\s#]+)/;

/**
 * The `actionlint` facts, for `workflows`: each third-party action an added line uses without pinning
 * it to a commit SHA (`actions/*`, local and `docker://` ones left out) and each added
 * `permissions: write-all`, in workflows and `action.yml` files, then what the pinned actionlint
 * reports on the changed workflows (with the repo's `.github/actionlint.yaml`, and no shellcheck or
 * pyflakes). When actionlint can't run, the scan still comes back, with the reason.
 */
export const actionlint: Facts = async ({ files, checkout }) => {
  const lines: string[] = [];
  for (const f of files.filter((f) => WORKFLOW.test(f.filename) || ACTION.test(f.filename))) {
    for (const [n, text] of diffLines(f.patch, true)) {
      const uses = USES.exec(text)?.[1];
      if (uses && !/^(?:\.\/|docker:\/\/|actions\/)/.test(uses) && !/@[0-9a-f]{40}$/.test(uses)) lines.push(`${f.filename}:${n} uses ${uses}, not pinned to a commit SHA`);
      if (/^\s*permissions:\s*write-all\b/.test(text)) lines.push(`${f.filename}:${n} permissions: write-all`);
    }
  }
  const workflows = changedFiles(files, WORKFLOW);
  if (workflows.length) {
    try {
      const run = await runTool('actionlint', ['-format', '{{json .}}', '-shellcheck=', '-pyflakes=', '-no-color', ...workflows], readAll(checkout, [...workflows, '.github/actionlint.yaml', '.github/actionlint.yml']));
      for (const i of report('actionlint', run) ?? []) lines.push(`${i.filepath}:${i.line} actionlint ${i.kind}: ${i.message}`);
    } catch (e) {
      lines.push(`actionlint didn't run: ${(e as Error).message}.`);
    }
  }
  return factsText(lines, '');
};
