import type { Script, ScriptFinding } from '../../types/prestep.type';

/** The size limit when the API sends none: 1 MB. */
export const MAX_BYTES = 1_000_000;
/** Build output and installed packages, which belong in `.gitignore`. */
const BUILD = /(?:^|\/)(node_modules|dist)\//;

/**
 * Added binary files, added or changed files over `data.maxBytes` (1 MB by default), and anything added
 * under `node_modules/` or `dist/`, once per folder. A GitHub Action keeps a `dist/` on purpose, so
 * `dist/` is left alone in a repo with an `action.yml`. All should-fix.
 */
export const largeFiles: Script = ({ files, checkout }, data) => {
  const max = typeof data?.maxBytes === 'number' && data.maxBytes > 0 ? data.maxBytes : MAX_BYTES;
  const action = checkout.find(['action.yml', 'action.yaml']).length > 0;
  const out: ScriptFinding[] = [];
  const folders = new Set<string>();
  for (const f of files) {
    if (f.status === 'removed') continue;
    const build = BUILD.exec(f.filename);
    if (build && f.status === 'added' && !(build[1] === 'dist' && action)) {
      const folder = f.filename.slice(0, build.index + build[0].length);
      if (!folders.has(folder)) {
        folders.add(folder);
        out.push({ severity: 'should-fix', file: f.filename, line: 1, title: `Committed \`${folder}\``, body: `This pull request adds files under \`${folder}\`, which is usually build output or installed packages. Add it to \`.gitignore\` and remove it from the branch.` });
      }
      continue;
    }
    const size = checkout.size(f.filename);
    const text = size !== undefined && size <= max ? checkout.read(f.filename, max) : undefined;
    if (size !== undefined && size > max)
      out.push({ severity: 'should-fix', file: f.filename, line: 1, title: `Large file: ${(size / 1e6).toFixed(1)} MB`, body: `This file is ${size.toLocaleString('en')} bytes, over the ${max.toLocaleString('en')}-byte limit. Large files stay in the history for good; use Git LFS or keep it out of the repo.` });
    else if (f.status === 'added' && text?.includes('\0'))
      out.push({ severity: 'should-fix', file: f.filename, line: 1, title: 'Binary file added', body: `This pull request adds a binary file (${size?.toLocaleString('en')} bytes). Check that it belongs in the repo rather than in Git LFS or a release asset.` });
  }
  return out;
};
