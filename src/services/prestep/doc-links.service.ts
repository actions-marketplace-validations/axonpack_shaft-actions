import { posix } from 'node:path';
import type { Script, ScriptFinding } from '../../types/prestep.type';
import { diffLines } from '../../utils/render.util';

const MARKDOWN = /\.(?:md|mdx|markdown)$/i;
/** A Markdown link or image target: `[text](target)` or `[text](target "title")`. */
const LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^)]*)?\)/g;

/** A heading's anchor as GitHub builds it: lower case, punctuation dropped, spaces as dashes. Duplicates get `-1`, `-2`. */
function anchors(text: string): Set<string> {
  const out = new Set<string>();
  const seen = new Map<string, number>();
  for (const l of text.split(/\r?\n/)) {
    for (const m of l.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']|\{#([\w-]+)\}/g)) out.add(m[1] ?? m[2]!);
    const h = /^#{1,6}\s+(.+?)[\s#]*$/.exec(l)?.[1];
    if (!h) continue;
    const slug = h.replace(/\{#[\w-]+\}/, '').trim().toLowerCase().replace(/<[^>]+>|[`*_~]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
    const n = seen.get(slug) ?? 0;
    seen.set(slug, n + 1);
    out.add(n ? `${slug}-${n}` : slug);
  }
  return out;
}

/**
 * Relative links on added lines of changed Markdown that point at a file missing from the checkout
 * (blocking), or at a heading the target file doesn't have (should-fix, since sites build anchors
 * their own way). Absolute URLs and site-rooted `/paths` aren't checked.
 */
export const docLinks: Script = ({ files, checkout }) =>
  files
    .filter((f) => MARKDOWN.test(f.filename) && f.status !== 'removed')
    .flatMap((f) =>
      [...diffLines(f.patch, true)].flatMap(([line, text]) =>
        [...text.matchAll(LINK)].flatMap(([, target]): ScriptFinding[] => {
          if (/^(?:[a-z][\w+.-]*:|\/)/i.test(target!)) return [];
          const [rawPath = '', anchor] = target!.split('#');
          let path = f.filename;
          try {
            if (rawPath) path = posix.normalize(posix.join(posix.dirname(f.filename), decodeURIComponent(rawPath.split('?')[0]!)));
          } catch {
            return [];
          }
          if (path.startsWith('../') || !checkout.find([path, `${path.replace(/\/$/, '')}/**`]).length)
            return [{ severity: 'blocking', file: f.filename, line, title: `Broken link: \`${rawPath}\``, body: `This link points at \`${path}\`, which isn't in the repo at this commit.` }];
          if (!anchor || !MARKDOWN.test(path)) return [];
          const text = checkout.read(path);
          return text && !anchors(text).has(anchor.toLowerCase())
            ? [{ severity: 'should-fix', file: f.filename, line, title: `Link to a missing heading: \`#${anchor}\``, body: `\`${path}\` has no heading whose anchor is \`#${anchor}\`. If your docs site builds anchors its own way, this may be fine.` }]
            : [];
        }),
      ),
    );
