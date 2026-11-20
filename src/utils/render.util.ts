import { createHash } from 'node:crypto';
import { ACTION_VERSION, DASHBOARD_URL, STATUS_CARDS_URL } from '../consts/api.const';
import { failureMarkdown, type ShaftFailure } from './failure.util';
import { billedTokens } from './tokens.util';

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
  /** The page on GitHub or osv.dev with the details, set only by a script (an advisory's). */
  url?: string;
};

/** The most a walkthrough may hold; a bigger one is dropped, and the review posts without it. */
export const WALKTHROUGH_MAX = { areas: 8, files: 20, diagram: 3000 };

/** The changed files grouped by area, and a Mermaid flowchart when the PR changes a flow. Optional. */
export type Walkthrough = { areas: { name: string; files: string[]; summary: string }[]; diagram?: string };

/** How the review judged one merge gate. */
export const GATE_STATUSES = ['met', 'not_met', 'not_applicable'] as const;
/** The most gates a project keeps, as the API limits them. */
export const GATES_MAX = 10;

/** One merge gate from the dashboard, as the review judged it. Optional. */
export type Gate = { gate: string; status: (typeof GATE_STATUSES)[number]; reason: string };

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
  walkthrough?: Walkthrough;
  gates?: Gate[];
};

/** The review memory kept in the summary comment's hidden state line. */
export type StateFinding = { fp: string; file: string; line: number; severity: Severity; title: string };
export type State = { sha: string; findings: StateFinding[] };

/** A finding after our code decided where it goes. */
export type Placed = Finding & { fp: string; inline: boolean };

/** Right-side line numbers in a unified diff patch, with their text: every line, or only the added ones. */
export function diffLines(patch: string | undefined, addedOnly = false): Map<number, string> {
  const lines = new Map<number, string>();
  let right = 0;
  for (const l of patch?.split('\n') ?? []) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) right = Number(hunk[1]);
    else if (l.startsWith('+') || l.startsWith(' ')) {
      if (!addedOnly || l.startsWith('+')) lines.set(right, l.slice(1));
      right++;
    }
  }
  return lines;
}

/** A patch's removed lines, without their `-`. */
export const removedLines = (patch: string | undefined) =>
  (patch ?? '')
    .split('\n')
    .filter((l) => l.startsWith('-'))
    .map((l) => l.slice(1));

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
  /** The run's page on the dashboard, which "Axon Shaft" links to; else the dashboard's home. */
  dashboardRunUrl?: string;
  models: string;
  effort: string;
  reason: string;
  /** What the run used. */
  tokens?: { input: number; output: number; cache_read: number; cache_write: number };
  /** The run's price in US dollars, set only for a run on an API key. */
  costUsd?: number;
  skipped?: number;
  /** The catalog checks the project keeps on, from the Axon Shaft API; the others show as off. */
  checks?: string[];
  /** The job's checklists, when the API sends them: the card shows these in place of the checks. */
  checklists?: { key: string; name: string; skip?: string }[];
  /** A newer v1 release than this run's, when the API says the run is pinned to an older one. */
  latestAction?: { version: string; url: string };
};

/** A token count, such as "950", "18k" or "1.2M". */
export const formatTokens = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${+(n / 1e6).toFixed(1)}M`);

/** The run's price and total when it has a price, else the cache-weighted count with the total in brackets. */
function usage(t: NonNullable<Footer['tokens']>, costUsd?: number): string {
  const total = formatTokens(t.input + t.output + t.cache_read + t.cache_write);
  if (costUsd !== undefined) return `$${costUsd.toFixed(2)} · ${total} tokens`;
  const billed = formatTokens(billedTokens(t));
  return billed === total ? `${total} tokens` : `≈${billed} billed (${total} with cache)`;
}

/** The line under what we post: links to the run's dashboard page and log, the model, effort, usage and why they were picked. */
export function footer(f: Footer): string {
  const run = f.runUrl ? ` · [run](${f.runUrl})` : '';
  const t = f.tokens ? ` · ${usage(f.tokens, f.costUsd)}` : '';
  return `<sub>[Axon Shaft](${f.dashboardRunUrl ?? DASHBOARD_URL})${run} · ${f.models} · ${f.effort}${t} · ${f.reason}</sub>`;
}

const chip = (text: string) => `<kbd>${text}</kbd>`;

export type CheckState = 'failed' | 'warned' | 'passed' | 'not_checked' | 'off';
const CHECK_MARK: Record<CheckState, string> = { failed: '❌', warned: '⚠️', passed: '✅', not_checked: '⬜', off: '➖' };

export type CheckItem = { key: string; label: string; state: CheckState; reason?: string };
const stateChip = (c: CheckItem) => chip(`${CHECK_MARK[c.state]} ${c.label}`);

/**
 * Each check's result: failed (a blocking finding), warned (any other), passed (checked with none),
 * not checked, or off. `rules` shows only with a finding. A finding shows even under a check that's
 * off, so a blocking one is never hidden. With `checklists`, it's one per checklist in the job's
 * order, and one that didn't run is not checked, with `reason` saying why.
 */
export function checkStates(review: Review, placed: Placed[], checks?: string[], checklists?: Footer['checklists']): CheckItem[] {
  if (checklists) {
    return checklists.map(({ key, name, skip }) => {
      const found = placed.filter((p) => p.step === key);
      const state: CheckState = found.some((p) => p.severity === 'blocking') ? 'failed' : found.length ? 'warned' : !skip && review.checked.includes(key) ? 'passed' : 'not_checked';
      return { key, label: name, state, ...(skip && { reason: skip }) };
    });
  }
  return STEPS.flatMap((key) => {
    const found = placed.filter((p) => p.step === key);
    if (key === 'rules' && !found.length) return [];
    const state: CheckState = found.some((p) => p.severity === 'blocking')
      ? 'failed'
      : found.length
        ? 'warned'
        : checks && !checks.includes(key)
          ? 'off'
          : review.checked.includes(key)
            ? 'passed'
            : 'not_checked';
    return [{ key, label: CHECK_LABEL[key]!, state }];
  });
}

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
  const checkChips = checkStates(review, placed, f.checks, f.checklists).map(stateChip);
  const headline = html(review.headline).split(/\r?\n/);
  const type = review.type.charAt(0).toUpperCase() + review.type.slice(1).replace(/-/g, ' ');
  const alert = VERDICT_ALERT[review.verdict];
  return [
    `> [!${alert}]`,
    `> ${statusCard(review.verdict, VERDICT_LABEL[review.verdict]!)}`,
    ...headline.map((l) => `> ${l}`),
    '>',
    `> **Findings** &nbsp; ${countChips.join(' ')}`,
    '>',
    `> **Checks** &nbsp; ${checkChips.join(' ')}`,
    '>',
    `> <sub>${[type && `🏷️ ${type}`, `🎯 ${review.confidence}% confidence`, `🔎 reviewed [\`${f.sha.slice(0, 7)}\`](https://github.com/${f.repo}/commit/${f.sha})`].filter(Boolean).join(' · ')}</sub>`,
  ].join('\n');
}

/** A table of findings, each location linked to its lines at the reviewed commit, and each finding to its page when it has one. */
function table(rows: Placed[], f: Pick<Footer, 'repo' | 'sha'>): string {
  const link = (p: Placed) => {
    const end = p.end_line && p.end_line > p.line ? `-L${p.end_line}` : '';
    return `[${where(p)}](https://github.com/${f.repo}/blob/${f.sha}/${encodeURI(p.file)}#L${p.line}${end})`;
  };
  return [
    '| Severity | Where | Finding | Details |',
    '|---|---|---|---|',
    ...rows.map((p) => `| ${SEVERITY_DOT[p.severity]} ${SEVERITY_LABEL[p.severity]} | ${cell(link(p))} | ${cell(p.url ? `[${p.title}](${p.url})` : p.title)} | ${p.inline ? 'inline' : cell(p.body)} |`),
  ].join('\n');
}

/** One check's findings as a table, for its check run. */
export const findingsTable = (found: Placed[], f: Pick<Footer, 'repo' | 'sha'>) =>
  table(
    found.map((p) => ({ ...p, title: prose(p.title), body: prose(p.body) })),
    f,
  );

const details = (summary: string, body: string) => `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;

const GATE_MARK: Record<Gate['status'], string> = { met: '✓', not_met: '✗', not_applicable: '–' };

/** The merge gates as a table, one row each with its mark and reason: in the summary and in the gates check. */
export function gatesTable(gates: Gate[]): string {
  const rows = gates.map((g) => `| ${GATE_MARK[g.status]} | ${cell(prose(g.gate))} | ${cell(prose(g.reason))} |`);
  return ['| | Gate | Why |', '|---|---|---|', ...rows].join('\n');
}

/** The walkthrough, folded: one table row per area, then the diagram GitHub draws from a mermaid block. */
function walkthrough(w: Walkthrough): string {
  const rows = w.areas.map((a) => `| ${cell(prose(a.name))} | ${a.files.map((f) => `\`${cell(f.replace(/`/g, ''))}\``).join('<br>')} | ${cell(prose(a.summary))} |`);
  const diagram = w.diagram ? ['', fence(prose(w.diagram), 'mermaid')] : [];
  return details('Walkthrough', ['| Area | Files | What changed |', '|---|---|---|', ...rows, ...diagram].join('\n'));
}

export function startSummary(sha: string, prior?: State): string {
  return [SUMMARY_MARKER, statusCard('reviewing', 'Reviewing'), `Reviewing \`${sha.slice(0, 7)}\`…`, prior ? stateLine(prior) : ''].filter(Boolean).join('\n');
}

/** The summary when none of the job's checklists ran: one chip each, and no model was asked. */
export function idleSummary(states: CheckItem[], prior: State | undefined, f: Pick<Footer, 'sha' | 'runUrl' | 'dashboardRunUrl'>): string {
  const run = f.runUrl ? ` · [run](${f.runUrl})` : '';
  return [
    SUMMARY_MARKER,
    `No checklist ran on \`${f.sha.slice(0, 7)}\`, so no model was called. Each checklist's check run says why.`,
    '',
    states.map(stateChip).join(' '),
    '',
    `<sub>[Axon Shaft](${f.dashboardRunUrl ?? DASHBOARD_URL})${run} · no model call</sub>`,
    ...(prior ? [stateLine(prior)] : []),
  ].join('\n');
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
  if (f.latestAction) {
    const { version, url } = f.latestAction;
    out.push(
      '',
      `Axon Shaft [v${version}](${url}) is out (this run used v${ACTION_VERSION}). To get each v1 release as it comes out, change \`uses:\` to \`axonpack/shaft-actions@v1\`.`,
    );
  }
  if (raw.gates?.length) {
    const met = raw.gates.filter((g) => g.status !== 'not_met').length;
    out.push('', `**Merge gates:** ${met} of ${raw.gates.length} met or not applicable`, '', gatesTable(raw.gates));
  }

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
  if (raw.walkthrough?.areas.length) out.push('', walkthrough(raw.walkthrough));
  // A run with no model call has no claim to show.
  if (review.claim) {
    out.push(
      '',
      details(
        'What this PR does',
        [`**Claim:** ${review.claim}`, `**Impact:** ${review.impact}`, `**Scope:** ${review.scope}`, `**Not checked:** ${review.not_checked}`].join('\n\n'),
      ),
    );
  }
  out.push('', footer(f));
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
