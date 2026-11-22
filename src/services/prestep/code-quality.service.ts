import type { NetworkScript } from '../../types/prestep.type';
import { oldLines } from '../../utils/render.util';
import { callApi } from '../api.service';

/** One of GitHub Code Quality's open findings on the default branch, as the Axon Shaft API sends it. */
type CodeQualityFinding = { number: number; path: string; start_line: number; end_line: number; severity: string; title: string; message_markdown: string };

/**
 * GitHub Code Quality's open findings on the lines a pull request changes, from the Axon Shaft API,
 * which reads them with the run's installation. They are the default branch's, so a PR into any other
 * branch is skipped. A finding counts when its first line falls in a hunk's old side, and is reported
 * at that hunk's first new line. `error` is should-fix, anything else a nit. GitHub gives no page for
 * a finding, so it has no `url`. Nothing from the checkout is sent; the API's refusal skips the checklist.
 */
export const codeQuality: NetworkScript = async ({ files, pr }) => {
  if (pr.base !== pr.defaultBranch) throw new Error(`GitHub Code Quality's findings are the default branch's (${pr.defaultBranch}), and this pull request goes into ${pr.base}`);
  const found = await callApi('/v1/code-quality', {});
  if (!Array.isArray(found)) throw new Error('The Axon Shaft API sent an incomplete answer');
  const hunks = new Map(files.map((f) => [f.filename, oldLines(f.patch)]));
  return (found as CodeQualityFinding[]).flatMap((c) => {
    const line = hunks.get(c.path)?.get(c.start_line);
    if (line === undefined) return [];
    return [
      {
        severity: c.severity === 'error' ? ('should-fix' as const) : ('nit' as const),
        file: c.path,
        line,
        title: c.title,
        body: `${c.message_markdown}\n\nFinding #${c.number} on the default branch, under the repo's Security and quality tab, Code quality.`,
      },
    ];
  });
};
