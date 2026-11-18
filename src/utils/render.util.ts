import { createHash } from 'node:crypto';
import { DASHBOARD_URL, STATUS_CARDS_URL } from '../consts/api.const';
import { failureMarkdown, type ShaftFailure } from './failure.util';

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
  /** The checks the model says it did; a check it didn't do shows as not checked, never as passed. */
  checked: string[];
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
const SEVERITY_DOT: Record<Severity, string> = { blocking: '🔴', 'should-fix': '🟡', nit: '⚪' };
const VERDICT_LABEL: Record<string, string> = { blocking: 'Blocking', 'needs-changes': 'Needs changes', 'looks-good': 'Looks good' };
/** Each verdict's GitHub alert and the dot in front of its heading. */
const VERDICT_ALERT: Record<string, string> = { blocking: 'CAUTION', 'needs-changes': 'WARNING', 'looks-good': 'TIP' };
/** The status card at the top of the summary, an SVG from the dashboard that GitHub renders: `reviewing` or the verdict. */
const statusCard = (status: string, label: string) => `![${label}](${STATUS_CARDS_URL}/${status}.svg)`;
const CHECK_LABEL: Record<string, string> = {
  correctness: 'Correctness',
  breakage: 'Breakage',
  standards: 'Standards',
  tests: 'Tests',
  docs: 'Docs',
  security: 'Security',
  rules: '📌 Your checks',
};
const loc = (f: { file: string; line: number; end_line?: number }) => `${f.file}:${f.line}${f.end_line && f.end_line > f.line ? `-${f.end_line}` : ''}`;
const where = (f: Parameters<typeof loc>[0]) => `\`${loc(f)}\``;
const fence = (s: string, lang = '') => `\`\`\`${lang}\n${s.replace(/\n$/, '')}\n\`\`\``;
/** One table cell: a `|` or a line break would end the cell or the table. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*[\r\n]+\s*/g, ' ');
const html = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * Model text as it may be posted: no images, and no `<!--`. A comment or file in the PR could talk
 * the model into an image whose URL carries data out when GitHub fetches it, or into a hidden
 * `shaft:` marker that a later run would read back.
 */
export const prose = (s: string) =>
  s
    .replace(/<!--/g, '&lt;!--')
    .replace(/!\[[^\n]*?\]\s*[([][^)\]\n]*[)\]]/g, '').replace(/<\/?(img|picture|source|video)\b[^>]*>/gi, '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function inlineBody(f: Placed): string {
  const parts = [`**${SEVERITY_LABEL[f.severity]}** · ${f.step}`, prose(f.body)];
  if (f.suggestion) parts.push(fence(f.suggestion, 'suggestion'));
  return `${parts.join('\n\n')}\n\n<!-- shaft:finding ${f.fp} -->`;
}

/** Hidden JSON can't contain `-->`; `>` only appears inside JSON strings, so escaping it stays valid JSON. */
export function stateLine(state: State): string {
  return `<!-- shaft:state ${JSON.stringify(state).replace(/>/g, '\\u003e')} -->`;
}

/** The state line is always the comment's last line; one anywhere else isn't ours. */
export function parseState(body: string | undefined): State | undefined {
  const m = body && /(?:^|\n)<!-- shaft:state ([^\n]*) -->\s*$/.exec(body);
  if (!m) return;
  try {
    return JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}

export type Footer = {
  sha: string;
  /** `owner/repo`, for the links to the reviewed lines. */
  repo: string;
  runUrl?: string;
  models: string;
  effort: string;
  reason: string;
  skipped?: number;
  /** The catalog checks the project keeps on, from the Axon Shaft API; the others show as off. */
  checks?: string[];
};

function footer(f: Footer): string {
  const run = f.runUrl ? ` · [run](${f.runUrl})` : '';
  return `<sub>[Axon Shaft](${DASHBOARD_URL})${run} · ${f.models} · ${f.effort} · ${f.reason}</sub>`;
}

const chip = (text: string) => `<kbd>${text}</kbd>`;

/**
 * The card at the top: the verdict as a GitHub alert, the headline, chips for the counts and for
 * each check (❌ a blocking finding, ⚠️ any other, ✅ checked with none, ⬜ not checked, ➖ turned off), and the PR's type.
 * The headline is model text, so `<` and `>` are escaped and every line stays in the alert.
 */
function card(review: Review, placed: Placed[], fixed: number, f: Footer): string {
  const n = (s: Severity) => placed.filter((p) => p.severity === s).length;
  const countChips = [
    n('blocking') && chip(`🔴 ${n('blocking')} blocking`),
    n('should-fix') && chip(`🟡 ${n('should-fix')} should fix`),
    n('nit') && chip(`⚪ ${plural(n('nit'), 'nit')}`),
    !placed.length && chip('✅ No findings'),
    fixed && chip(`✅ ${fixed} fixed`),
  ].filter(Boolean);
  const checkChips = STEPS.flatMap((step) => {
    const found = placed.filter((p) => p.step === step);
    if (step === 'rules' && !found.length) return [];
    // A finding shows even under a check that's off, so a blocking one is never hidden.
    const mark = found.some((p) => p.severity === 'blocking')
      ? '❌'
      : found.length
        ? '⚠️'
        : f.checks && !f.checks.includes(step)
          ? '➖'
          : review.checked.includes(step)
            ? '✅'
            : '⬜';
    return [chip(`${mark} ${CHECK_LABEL[step]}`)];
  });
  const headline = html(review.headline).split(/\r?\n/);
  const type = review.type.charAt(0).toUpperCase() + review.type.slice(1).replace(/-/g, ' ');
  const alert = VERDICT_ALERT[review.verdict];
  return [
    `> [!${alert}]`,
    `> ${statusCard(review.verdict, VERDICT_LABEL[review.verdict]!)}`,
    ...headline.map((l) => `> ${l}`),
    '>',
    `> ${countChips.join(' ')}`,
    '>',
    `> ${checkChips.join(' ')}`,
    '>',
    `> <sub>${type} · ${review.confidence}% confidence · reviewed \`${f.sha.slice(0, 7)}\`</sub>`,
  ].join('\n');
}

/** A table of findings, each location linked to its lines at the reviewed commit. */
function table(rows: Placed[], f: Footer): string {
  const link = (p: Placed) => {
    const end = p.end_line && p.end_line > p.line ? `-L${p.end_line}` : '';
    return `[${where(p)}](https://github.com/${f.repo}/blob/${f.sha}/${encodeURI(p.file)}#L${p.line}${end})`;
  };
  return [
    '| Severity | Where | Finding | Details |',
    '|---|---|---|---|',
    ...rows.map((p) => `| ${SEVERITY_DOT[p.severity]} ${SEVERITY_LABEL[p.severity]} | ${cell(link(p))} | ${cell(p.title)} | ${p.inline ? 'inline' : cell(p.body)} |`),
  ].join('\n');
}

const details = (summary: string, body: string) => `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;

export function startSummary(sha: string, prior?: State): string {
  return [SUMMARY_MARKER, statusCard('reviewing', 'Reviewing'), `Reviewing \`${sha.slice(0, 7)}\`…`, prior ? stateLine(prior) : ''].filter(Boolean).join('\n');
}

/** The summary when the review failed: the failure's card, message and link, as the job summary has them. */
export function failedSummary(failure: ShaftFailure, prior?: State): string {
  return [SUMMARY_MARKER, failureMarkdown(failure), prior ? stateLine(prior) : ''].filter(Boolean).join('\n');
}

export function renderSummary(raw: Review, placed: Placed[], prior: State | undefined, f: Footer): string {
  const { headline, claim, impact, scope, not_checked } = raw;
  const review = { ...raw, headline: prose(headline), claim: prose(claim), impact: prose(impact), scope: prose(scope), not_checked: prose(not_checked) };
  const shown = placed.map((p) => ({ ...p, title: prose(p.title), body: prose(p.body) }));
  const fixed = prior?.findings.filter((p) => review.resolved.includes(p.fp)) ?? [];
  const out = [SUMMARY_MARKER, card(review, shown, fixed.length, f)];

  const main = shown.filter((p) => p.severity !== 'nit');
  const nits = shown.filter((p) => p.severity === 'nit');
  if (main.length) out.push('', table(main, f));
  // A suggestion is code, which a table cell can't hold; inline comments carry theirs already.
  for (const p of placed.filter((p) => !p.inline && p.suggestion)) {
    out.push('', details(`Suggested change for <code>${html(loc(p))}</code>`, fence(p.suggestion!)));
  }
  if (nits.length) out.push('', details(plural(nits.length, 'nit'), table(nits, f)));

  if (fixed.length) out.push('', `**Fixed since last review:** ${fixed.length} (${fixed.map((p) => `${where(p)} ${prose(p.title)}`).join(', ')})`);
  if (f.skipped) out.push('', `**Skipped:** ${plural(f.skipped, 'file')} matched \`skip\` and weren't reviewed.`);
  out.push(
    '',
    details(
      'What this PR does',
      [`**Claim:** ${review.claim}`, `**Impact:** ${review.impact}`, `**Scope:** ${review.scope}`, `**Not checked:** ${review.not_checked}`].join('\n'),
    ),
    '',
    footer(f),
  );
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

/**
 * Inline findings that no earlier run posted, judged by the fingerprint at the end of each review
 * comment `bot` wrote. Anyone else's marker, or one in the middle of a comment, counts for nothing.
 */
export function unposted(placed: Placed[], reviewComments: { body: string; author: string }[], bot: string): Placed[] {
  const posted = new Set(reviewComments.filter((c) => c.author === bot).map((c) => /<!-- shaft:finding (\w+) -->\s*$/.exec(c.body)?.[1]));
  return placed.filter((p) => p.inline && !posted.has(p.fp));
}
