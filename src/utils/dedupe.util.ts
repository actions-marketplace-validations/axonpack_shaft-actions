import { type Finding, SEVERITIES } from './render.util';

const overlap = (a: Finding, b: Finding) => a.file === b.file && a.line <= Math.max(b.end_line ?? b.line, b.line) && b.line <= Math.max(a.end_line ?? a.line, a.line);

/**
 * One finding where two checklists flag the same lines of a file. The checklist earlier in `order`
 * (the job's order) keeps it, at the higher of the two severities, and its body names the other.
 * Findings from the same checklist are all kept. A step not in `order` comes after the rest.
 */
export function dedupe(findings: Finding[], order: string[]): Finding[] {
  const rank = (f: Finding) => (order.includes(f.step) ? order.indexOf(f.step) : order.length);
  const kept: Finding[] = [];
  for (const f of [...findings].sort((a, b) => rank(a) - rank(b))) {
    const i = kept.findIndex((k) => k.step !== f.step && overlap(k, f));
    if (i < 0) {
      kept.push(f);
      continue;
    }
    const k = kept[i]!;
    const severity = SEVERITIES.indexOf(f.severity) < SEVERITIES.indexOf(k.severity) ? f.severity : k.severity;
    kept[i] = { ...k, severity, body: `${k.body}\n\nAlso found by \`${f.step}\`.` };
  }
  return kept;
}
