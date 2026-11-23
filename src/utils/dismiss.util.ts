import { DISMISSED_END, DISMISSED_START, dismissedSection, type Placed, type State, stateLine, VERDICTS } from './render.util';

/**
 * The state with finding `fp` dismissed by `by` (or brought back when `by` is unset). A finding is in
 * `findings` or in `dismissed`, never both. Undefined when `fp` is in neither, or already as asked.
 */
export function setDismissal(state: State, fp: string, by?: string, reason = ''): State | undefined {
  const dismissed = state.dismissed ?? [];
  if (by) {
    const f = state.findings.find((x) => x.fp === fp);
    if (!f) return;
    return { ...state, findings: state.findings.filter((x) => x !== f), dismissed: [...dismissed, { ...f, by, reason }] };
  }
  const d = dismissed.find((x) => x.fp === fp);
  if (!d) return;
  const { by: _by, reason: _reason, ...f } = d;
  return { ...state, findings: [...state.findings, f], dismissed: dismissed.filter((x) => x !== d) };
}

/**
 * The summary comment with its dismissed section and state line rewritten from `state`, and nothing
 * else changed. The section goes before the footer's fold, or at the end when there's none.
 */
export function withDismissed(body: string, state: State): string {
  const start = body.indexOf(DISMISSED_START);
  const end = body.indexOf(DISMISSED_END);
  let rest = (start >= 0 && end > start ? body.slice(0, start).trimEnd() + body.slice(end + DISMISSED_END.length) : body).replace(/\n<!-- shaft:state [^\n]* -->\s*$/, '');
  const section = dismissedSection(state.dismissed ?? []);
  if (section) {
    const at = rest.lastIndexOf('\n<details><summary><sub>');
    rest = at >= 0 ? `${rest.slice(0, at).trimEnd()}\n\n${section}\n${rest.slice(at)}` : `${rest}\n\n${section}`;
  }
  return `${rest.trimEnd()}\n${stateLine(state)}`;
}

/**
 * The verdict once dismissed findings are left out: what the findings that are left give, never
 * above the model's own (a gate or a judgement outside the findings can keep it lower).
 */
export function verdictAfter(verdict: string, left: Pick<Placed, 'severity'>[]): string {
  const byFindings = left.some((p) => p.severity === 'blocking') ? 'blocking' : left.some((p) => p.severity === 'should-fix') ? 'needs-changes' : 'looks-good';
  const rank = (v: string) => VERDICTS.indexOf(v as (typeof VERDICTS)[number]);
  return rank(verdict) >= rank(byFindings) ? verdict : byFindings;
}
