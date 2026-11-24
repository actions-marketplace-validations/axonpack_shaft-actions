import { LOCKFILE } from '../utils/auto-pick.util';
import { PUSH_RULES } from './guardrail.const';

/**
 * The push rules the lines `changes` add break, one per file: a download piped into a shell, the
 * whole environment sent out, a variable sent to a hard-coded host, an obfuscated blob. A line counts
 * as added when the file at the pull request's head (`before`) doesn't have it. Lockfiles are skipped.
 */
export function pushHits(changes: { path: string; content?: Buffer }[], before: (path: string) => string | undefined): { path: string; rule: string; name: string; line: string }[] {
  return changes.flatMap((c) => {
    if (!c.content || LOCKFILE.test(c.path)) return [];
    const had = new Set((before(c.path) ?? '').split('\n'));
    const added = c.content.toString('utf8').split('\n').filter((l) => !had.has(l));
    for (const line of added) {
      const r = PUSH_RULES.find((p) => p.pattern.test(line));
      if (r) return [{ path: c.path, rule: r.id, name: r.name, line }];
    }
    return [];
  });
}
