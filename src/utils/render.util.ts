import { createHash } from 'node:crypto';

export const SUMMARY_MARKER = '<!-- shaft:summary -->';

export const VERDICTS = ['blocking', 'needs-changes', 'looks-good'] as const;
export const SEVERITIES = ['blocking', 'should-fix', 'nit'] as const;
/** `rules` is a check the repo added on the dashboard. */
export const STEPS = ['correctness', 'breakage', 'standards', 'tests', 'docs', 'security', 'rules'] as const;
export const TYPES = ['bug-fix', 'feature', 'refactor', 'docs', 'chore', 'mixed'] as const;

export type Severity = (typeof SEVERITIES)[number];

export type Finding = {
  severity: Severity;
  step: string;
  file: string;
  line: number;
  end_line?: number;
  title: string;
  body: string;
  suggestion?: string;
};

/** What the model returns (the plan's JSON). */
export type Review = {
  verdict: (typeof VERDICTS)[number];
  type: string;
  confidence: number;
  headline: string;
  claim: string;
  impact: string;
  scope: string;
  findings: Finding[];
  resolved: string[];
  not_checked: string;
};

/** The review memory kept in the summary comment's hidden state line. */
export type StateFinding = { fp: string; file: string; line: number; severity: Severity; title: string };
export type State = { sha: string; findings: StateFinding[] };

/** A finding after our code decided where it goes. */
export type Placed = Finding & { fp: string; inline: boolean };

/** Right-side line numbers in a unified diff patch, with their text. */
export function diffLines(patch: string | undefined): Map<number, string> {
  const lines = new Map<number, string>();
  let right = 0;
  for (const l of patch?.split('\n') ?? []) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) right = Number(hunk[1]);
    else if (l.startsWith('+') || l.startsWith(' ')) lines.set(right++, l.slice(1));
  }
  return lines;
}

/** A short hash of file, title and the code on the line, so it survives lines moving. */
export function fingerprint(f: Pick<Finding, 'file' | 'title'>, code = ''): string {
  return createHash('sha256')
    .update(`${f.file}\n${f.title.trim().toLowerCase()}\n${code.replace(/\s+/g, ' ').trim()}`)
    .digest('hex')
    .slice(0, 6);
}

/**
 * Decide where each finding goes. A blocking or should-fix finding whose lines are all in the
 * diff goes inline; anything else goes in the summary. Nits follow the `nits` input.
 */
export function place(findings: Finding[], files: { filename: string; patch?: string }[], nits: string): Placed[] {
  const byFile = new Map(files.map((f) => [f.filename, diffLines(f.patch)]));
  return findings
    .filter((f) => nits !== 'off' || f.severity !== 'nit')
    .map((f) => {
      const lines = byFile.get(f.file);
      const end = Math.max(f.end_line ?? f.line, f.line);
      let inDiff = !!lines;
      for (let n = f.line; inDiff && n <= end; n++) inDiff = lines!.has(n);
      return { ...f, fp: fingerprint(f, lines?.get(f.line)), inline: inDiff && (f.severity !== 'nit' || nits === 'inline') };
    });
}

const SEVERITY_LABEL: Record<Severity, string> = { blocking: 'Blocking', 'should-fix': 'Should fix', nit: 'Nit' };
const VERDICT_LABEL: Record<string, string> = { blocking: 'Blocking', 'needs-changes': 'Needs changes', 'looks-good': 'Looks good' };
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
const where = (f: { file: string; line: number }) => `\`${f.file}:${f.line}\``;
const fence = (s: string, lang = '') => `\`\`\`${lang}\n${s.replace(/\n$/, '')}\n\`\`\``;

export function inlineBody(f: Placed): string {
  const parts = [`**${SEVERITY_LABEL[f.severity]}** · ${f.step}`, f.body];
  if (f.suggestion) parts.push(fence(f.suggestion, 'suggestion'));
  return `${parts.join('\n\n')}\n\n<!-- shaft:finding ${f.fp} -->`;
}

/** Hidden JSON can't contain `-->`; `>` only appears inside JSON strings, so escaping it stays valid JSON. */
export function stateLine(state: State): string {
  return `<!-- shaft:state ${JSON.stringify(state).replace(/>/g, '\\u003e')} -->`;
}

export function parseState(body: string | undefined): State | undefined {
  const m = body && /<!-- shaft:state (.*?) -->/s.exec(body);
  if (!m) return;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

export type Footer = { sha: string; runUrl?: string; models: string; effort: string; reason: string; skipped?: number };

function footer(f: Footer): string {
  const run = f.runUrl ? ` · [run](${f.runUrl})` : '';
  return `<sub>Axon Shaft · reviewed \`${f.sha.slice(0, 7)}\`${run} · ${f.models} · ${f.effort} · ${f.reason}</sub>`;
}

export function startSummary(sha: string, prior?: State): string {
  return [SUMMARY_MARKER, `Reviewing \`${sha.slice(0, 7)}\`…`, prior ? stateLine(prior) : ''].filter(Boolean).join('\n');
}

export function failedSummary(sha: string, why: string, runUrl: string | undefined, prior?: State): string {
  const run = runUrl ? ` See the [run](${runUrl}).` : '';
  return [SUMMARY_MARKER, `The review of \`${sha.slice(0, 7)}\` stopped: ${why}.${run}`, prior ? stateLine(prior) : '']
    .filter(Boolean)
    .join('\n');
}

export function renderSummary(review: Review, placed: Placed[], prior: State | undefined, f: Footer): string {
  const out = [
    SUMMARY_MARKER,
    `**${VERDICT_LABEL[review.verdict]}** · ${label(review.type)} · ${review.confidence}% confidence`,
    '',
    review.headline,
    '',
    `**Claim:** ${review.claim}`,
    `**Impact:** ${review.impact}`,
    `**Scope:** ${review.scope}`,
  ];

  const listed = placed.filter((p) => p.inline || p.severity !== 'nit');
  const counted = placed.length - listed.length;
  if (placed.length) {
    out.push('', '**Findings**');
    for (const p of listed) {
      out.push(`- **${SEVERITY_LABEL[p.severity]}** ${where(p)} ${p.title} (${p.inline ? 'inline' : 'outside the diff'})`);
      if (!p.inline) {
        out.push(...p.body.split('\n').map((l) => `  ${l}`));
        if (p.suggestion) out.push(...fence(p.suggestion).split('\n').map((l) => `  ${l}`));
      }
    }
    if (counted) out.push(`- ${counted} nit${counted === 1 ? '' : 's'}`);
  }

  const fixed = prior?.findings.filter((p) => review.resolved.includes(p.fp)) ?? [];
  if (fixed.length) out.push('', `**Fixed since last review:** ${fixed.length} (${fixed.map((p) => `${where(p)} ${p.title}`).join(', ')})`);

  if (f.skipped) out.push('', `**Skipped:** ${f.skipped} file${f.skipped === 1 ? '' : 's'} matched \`skip\` and weren't reviewed.`);
  out.push('', `**Not checked:** ${review.not_checked}`, '', footer(f));
  const state: State = {
    sha: f.sha,
    findings: placed.map(({ fp, file, line, severity, title }) => ({ fp, file, line, severity, title })),
  };
  // GitHub caps a comment at 65,536 characters; the state line must survive.
  return `${out.join('\n').slice(0, 60_000)}\n${stateLine(state)}`;
}

/** Never post a secret: replace every known secret value before text leaves the runner. */
export function redact(text: string, secrets: string[]): string {
  return secrets.filter((s) => s.length >= 8).reduce((t, s) => t.split(s).join('***'), text);
}

/** Inline findings that no earlier run posted, judged by the fingerprints in the PR's review comments. */
export function unposted(placed: Placed[], reviewComments: { body: string }[]): Placed[] {
  const posted = new Set(reviewComments.flatMap((c) => [...c.body.matchAll(/<!-- shaft:finding (\w+) -->/g)].map((m) => m[1])));
  return placed.filter((p) => p.inline && !posted.has(p.fp));
}
