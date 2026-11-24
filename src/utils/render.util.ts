import { createHash } from 'node:crypto';
import { ACTION_VERSION, DASHBOARD_URL, STATUS_CARDS_URL } from '../consts/api.const';
import { failureMarkdown, type ShaftFailure } from './failure.util';
import { billedTokens, CACHE_WEIGHT } from './tokens.util';

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
export type StateFinding = { fp: string; file: string; line: number; severity: Severity; title: string; step?: string };
/** A finding someone with write access dismissed on this pull request, with who and why (`reason` may be empty). */
export type Dismissed = StateFinding & { by: string; reason: string };
/**
 * `dismissed` stays out of `findings`, from the review that found them on. An action from 1.11 on
 * also keeps what lets the next push build on this review (`incremental.util`): each file's diff
 * hash, the settings' hash, the checklists it checked, its verdict and its gates. A state without
 * them gets a full review.
 */
export type State = {
  sha: string;
  findings: StateFinding[];
  dismissed?: Dismissed[];
  files?: Record<string, string>;
  config?: string;
  checked?: string[];
  verdict?: Review['verdict'];
  gates?: Gate[];
};

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

/** Each left-side line number a patch's hunks cover, mapped to that hunk's first right-side line. */
export function oldLines(patch: string | undefined): Map<number, number> {
  const lines = new Map<number, number>();
  for (const m of patch?.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)/gm) ?? []) {
    const start = Number(m[1]);
    for (let n = start; n < start + Number(m[2] ?? 1); n++) lines.set(n, Number(m[3]));
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

/** How far a finding's line may move between reviews and still be the earlier finding. */
export const LINE_DRIFT = 2;

/**
 * Decide where each finding goes. A blocking or should-fix finding whose lines are all in the
 * diff goes inline; anything else goes in the summary. Nits follow the `nits` input. A finding with
 * the same file and title as one of the last review's (`prior`), a line or two away, keeps that
 * one's fingerprint, so a push that moves it doesn't post it again.
 */
export function place(findings: Finding[], files: { filename: string; patch?: string }[], nits: string, prior: StateFinding[] = []): Placed[] {
  const byFile = new Map(files.map((f) => [f.filename, diffLines(f.patch)]));
  const left = [...prior];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return findings
    .filter((f) => nits !== 'off' || f.severity !== 'nit')
    .map((f) => {
      const lines = byFile.get(f.file);
      const end = Math.max(f.end_line ?? f.line, f.line);
      let inDiff = !!lines;
      for (let n = f.line; inDiff && n <= end; n++) inDiff = lines!.has(n);
      const fp = fingerprint(f, lines?.get(f.line));
      // Each earlier finding is matched once, by the first finding to claim it: the same fingerprint, else the nearest line.
      const match =
        left.find((p) => p.fp === fp) ??
        left.filter((p) => p.file === f.file && same(p.title, f.title) && Math.abs(p.line - f.line) <= LINE_DRIFT).sort((a, b) => Math.abs(a.line - f.line) - Math.abs(b.line - f.line))[0];
      if (match) left.splice(left.indexOf(match), 1);
      return { ...f, fp: match?.fp ?? fp, inline: inDiff && (f.severity !== 'nit' || nits === 'inline') };
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
/** Hosts an image in posted model text may load from: GitHub's own and the dashboard's. */
const IMAGE_HOSTS = /^(github\.com|[\w-]+\.githubusercontent\.com|shaft\.axonpack\.dev)$/i;
const trustedImage = (url: string) => {
  try {
    const u = new URL(url.replace(/^<|>$/g, ''));
    return u.protocol === 'https:' && IMAGE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
};

/**
 * Model text as it may be posted: an image only from `IMAGE_HOSTS`, and no `<!--`. A comment or file
 * in the PR could talk the model into an image whose URL carries data out when GitHub fetches it, so
 * any other image becomes a plain link with its alt text, which loads nothing until someone clicks
 * it. A hidden `shaft:` marker would be read back by a later run. Repeated until nothing changes, so
 * an image hidden in another's alt text is caught too.
 */
export function prose(text: string): string {
  let s = text.replace(/<!--/g, '&lt;!--');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s
      .replace(/!+\[([^\n]*?)\]\s*([([])([^)\]\n]*)[)\]]/g, (m, alt: string, open: string, target: string) =>
        open === '(' && trustedImage(target.trim().split(/\s+/)[0] ?? '') && !m.startsWith('!!') ? m : open === '(' ? `[${alt}](${target})` : `[${alt}][${target}]`,
      )
      .replace(/<img\b[^>]*>/gi, (tag) => {
        const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1] ?? '';
        if (trustedImage(src) && !/\bsrcset\b/i.test(tag)) return tag;
        const alt = /\balt\s*=\s*["']([^"'\n]*)["']/i.exec(tag)?.[1] || 'image';
        return `[${alt}](${src})`;
      })
      .replace(/<\/?(picture|source|video)\b[^>]*>/gi, '');
  }
  return s;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** "a, b or c". */
const either = (words: string[]) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : (words[0] ?? ''));

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
  /** The run's page on the dashboard; else the footer links the dashboard's home. */
  dashboardRunUrl?: string;
  /** The model that ran, the picked one the plan couldn't use when it fell back, and the subagents' models. Unset when no model was called. */
  models?: { main: string; fellBackFrom?: string; subagents: string[] };
  effort?: string;
  /** Why `auto` picked the model and effort. */
  reason?: string;
  /** The triage's level and reason, or why a bare `/fix` started where it did. */
  triage?: string;
  /** The `auto` ladder's rungs that didn't work before the one that ran, and why each moved up. */
  tried?: { model: string; effort: string; why: string }[];
  maxTurns?: number;
  /** The review's light pass on Haiku: its tokens are in `tokens` too. `failed`: the main pass ran its checklists. */
  light?: { model: string; maxTurns: number; tokens: { input: number; output: number; cache_read: number; cache_write: number }; checklists: string[]; failed: boolean };
  /** The changed lines and files the review read, after `skip`. */
  lines?: number;
  files?: number;
  /** What the run used. */
  tokens?: { input: number; output: number; cache_read: number; cache_write: number };
  /** The run's price in US dollars, set only for a run on an API key. */
  costUsd?: number;
  skipped?: number;
  /** The catalog checks the project keeps on, from the Axon Shaft API; the others show as off. */
  checks?: string[];
  /** The diff hashes and settings' hash for the state line, so the next push can build on this review. */
  memo?: { files?: Record<string, string>; config: string };
  /** The job's checklists, when the API sends them: the card shows these in place of the checks. */
  checklists?: { key: string; name: string; skip?: string }[];
  /** A newer v1 release than this run's, when the API says the run is pinned to an older one. */
  latestAction?: { version: string; url: string };
  /** GitHub's web editor for the workflow file (`workflowEditUrl()`), linked under the newer release. */
  workflowEditUrl?: string;
  /** Why a private draft advisory couldn't be opened, for one line in the summary. */
  advisories?: string;
  /** Findings left out by the repo config file's `ignore`. */
  ignored?: number;
  /** Findings on files the project's guardrails cover, which weren't posted. */
  guardrailed?: number;
  /** The repo config file the API left out, and why. */
  repoConfig?: { path: string; problems: string[] };
  /** The injection protection lines for people with strikes (`flaggedLines`). */
  flagged?: string[];
  /** Permissions the installation hasn't approved: the level wanted, and the one it has if any. */
  missingPermissions?: { name: string; wanted: string; granted: string | null }[];
  /** The follow-up commands someone can comment on this pull request now, without the slash. */
  commands?: string[];
};

/**
 * GitHub's web editor for the workflow file, from `GITHUB_WORKFLOW_REF`
 * (`owner/repo/.github/workflows/x.yml@refs/heads/main`), on that branch. A tag or a pull request's
 * merge ref isn't a branch to edit, so it's `defaultBranch` then; with neither, undefined.
 */
export function workflowEditUrl(workflowRef: string | undefined, defaultBranch: string | undefined): string | undefined {
  const m = /^([^/]+\/[^/]+)\/(.+)@(.+)$/.exec(workflowRef ?? '');
  const branch = m?.[3]!.startsWith('refs/heads/') ? m[3].slice('refs/heads/'.length) : defaultBranch;
  return m && branch ? `https://github.com/${m[1]}/edit/${encodeURI(`${branch}/${m[2]}`)}` : undefined;
}

/** A token count, such as "950", "18k" or "1.2M". */
export const formatTokens = (n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${Math.round(n / 1000)}k` : `${+(n / 1e6).toFixed(1)}M`);

/** A model's name for people: `claude-sonnet-5-5` is "Claude Sonnet 5.5". Any other ID stays as it is. */
export function modelName(id: string): string {
  const m = /^claude-(opus|sonnet|haiku)-(\d+(?:-\d)?)(?:-\d{8})?$/.exec(id);
  return m ? `Claude ${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} ${m[2]!.replace('-', '.')}` : id;
}

const modelCell = (id: string) => (modelName(id) === id ? `\`${id}\`` : `${modelName(id)} (\`${id}\`)`);

/**
 * The fold under what we post. Its line gives the model and effort, the tokens (with the cost on an
 * API key) and the changed lines. Opened, a table has everything else the run knows, leaving out
 * what it doesn't.
 */
export function footer(f: Footer): string {
  const t = f.tokens;
  const total = t && t.input + t.output + t.cache_read + t.cache_write;
  const cost = f.costUsd === undefined ? '' : `$${f.costUsd.toFixed(2)}`;
  const head = f.models ? `${modelName(f.models.main)}${f.effort ? `, ${f.effort} effort` : ''}` : 'no model call';
  const tail = [t && [`${formatTokens(total!)} tokens`, cost].filter(Boolean).join(' · '), f.lines !== undefined && plural(f.lines, 'line')].filter(Boolean).join(', ');
  const ran = f.checklists?.filter((c) => !c.skip).map((c) => c.name) ?? [];
  const notRun = f.checklists?.filter((c) => c.skip).map((c) => `${c.name} (${c.skip})`) ?? [];
  const ref = process.env.GITHUB_ACTION_REF;
  const rows: [string, unknown][] = [
    ['Axon Shaft', f.dashboardRunUrl ? `[Run page](${f.dashboardRunUrl})` : `[Dashboard](${DASHBOARD_URL})`],
    ['Logs', f.runUrl && `[Actions run](${f.runUrl})`],
    ['Action', `v${ACTION_VERSION}${ref ? ` at \`${ref}\`` : ''}`],
    ['Model', f.models ? modelCell(f.models.main) : 'No model call'],
    ['Fallback', f.models?.fellBackFrom && `The plan can't use \`${f.models.fellBackFrom}\`, so the run used the model above`],
    ['Subagents', f.models?.subagents.map(modelCell).join(', ')],
    ['Effort', f.effort],
    ['Why this model', f.reason],
    ['Triage', f.triage],
    ['Tried first', f.tried?.map((t) => `${t.model}, ${t.effort} effort: ${t.why}`).join('; ')],
    ['Turn limit', f.maxTurns],
    [
      'Light pass',
      f.light &&
        (f.light.failed
          ? `Didn't work, so the main pass ran ${f.light.checklists.join(', ')}`
          : `${modelCell(f.light.model)}, up to ${f.light.maxTurns} turns, ${formatTokens(Object.values(f.light.tokens).reduce((a, b) => a + b, 0))} tokens: ${f.light.checklists.join(', ')}`),
    ],
    ['Changed lines', f.lines],
    ['Changed files', f.files],
    ['Skipped by `skip`', f.skipped && plural(f.skipped, 'file')],
    ['Checklists run', ran.join(', ')],
    ['Checklists not run', notRun.join(', ')],
    ['Missing permissions', f.missingPermissions?.map((p) => `\`${p.name}\` (${p.wanted}${p.granted ? `, approved ${p.granted}` : ''})`).join(', ')],
    ['Input', t && formatTokens(t.input)],
    ['Output', t && formatTokens(t.output)],
    ['Cache read', t && formatTokens(t.cache_read)],
    ['Cache write', t && formatTokens(t.cache_write)],
    ['Total', t && formatTokens(total!)],
    ['Billed, cache-weighted', t && `≈${formatTokens(billedTokens(t))}`],
    ['Cost', cost],
    ['Reviewed commit', `[\`${f.sha.slice(0, 7)}\`](https://github.com/${f.repo}/commit/${f.sha})`],
  ];
  const table = ['| | |', '|---|---|', ...rows.filter(([, v]) => v !== undefined && v !== '' && v !== 0).map(([k, v]) => `| ${k} | ${cell(String(v))} |`)];
  const note = t
    ? ['', `Billed counts a cache read as ${CACHE_WEIGHT.read} of an input token and a cache write as ${CACHE_WEIGHT.write}, so it can be higher than the total when a run writes a lot of cache.`]
    : [];
  return details(`<sub>${[head, tail].filter(Boolean).join(' · ')}</sub>`, [...table, ...note].join('\n'));
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
  const counts = [
    n('blocking') && `🔴 ${n('blocking')} blocking`,
    n('should-fix') && `🟡 ${n('should-fix')} should fix`,
    n('nit') && `⚪ ${plural(n('nit'), 'nit')}`,
    !placed.length && '✅ none',
    fixed && `✅ ${fixed} fixed`,
  ].filter(Boolean);
  const states = checkStates(review, placed, f.checks, f.checklists);
  const ran = states.filter((c) => c.state !== 'off' && c.state !== 'not_checked');
  const clean = ran.filter((c) => c.state === 'passed').length;
  const flagged = states.filter((c) => c.state === 'failed' || c.state === 'warned').sort((a, b) => (a.state === b.state ? 0 : a.state === 'failed' ? -1 : 1));
  const unchecked = states.filter((c) => c.state === 'not_checked');
  const headline = html(review.headline).split(/\r?\n/);
  const type = review.type.charAt(0).toUpperCase() + review.type.slice(1).replace(/-/g, ' ');
  const alert = VERDICT_ALERT[review.verdict];
  const checksLine = [`${clean} of ${ran.length} clean`, flagged.length && `${flagged.length} with findings`, unchecked.length && `${unchecked.length} not checked`].filter(Boolean).join(' · ');
  // The checks that found something (blocking first) and the ones that didn't run, folded so the card keeps its height.
  const foundLine = (c: CheckItem) => {
    const mine = placed.filter((p) => p.step === c.key);
    const by = SEVERITIES.map((s) => [s, mine.filter((p) => p.severity === s).length] as const).filter(([, k]) => k);
    return `${CHECK_MARK[c.state]} **${c.label}** · ${by.map(([s, k]) => (s === 'nit' ? plural(k, 'nit') : `${k} ${s === 'blocking' ? 'blocking' : 'should fix'}`)).join(', ')}`;
  };
  const fold = [...flagged.map(foundLine), ...unchecked.map((c) => `${CHECK_MARK.not_checked} **${c.label}** · not checked${c.reason ? `: ${html(c.reason)}` : ''}`)];
  const summary = [flagged.length && plural(flagged.length, 'check') + ' with findings', unchecked.length && `${unchecked.length} not checked`].filter(Boolean).join(', ');
  return [
    `> [!${alert}]`,
    `> ${statusCard(review.verdict, VERDICT_LABEL[review.verdict]!)}`,
    '>',
    ...headline.map((l) => `> ${l}`),
    '>',
    `> ${meter('Checks', checksBar(states))} &nbsp;${checksLine}<br>`,
    `> ${meter('Findings', mathBar(SEVERITIES.map((s) => [SEVERITY_COLOR[s], n(s)] as const)))} &nbsp;${counts.join(' · ')}<br>`,
    `> ${meter('Confidence', mathBar([[METER_BLUE, review.confidence], [METER_GREY, 100 - review.confidence]]))} &nbsp;${review.confidence}%`,
    ...(fold.length ? ['>', `> <details><summary>${summary}</summary>`, '>', ...fold.map((l, i) => `> ${l}${i < fold.length - 1 ? '<br>' : ''}`), '>', '> </details>'] : []),
    '>',
    `> <sub>${[type, `reviewed [\`${f.sha.slice(0, 7)}\`](https://github.com/${f.repo}/commit/${f.sha})`].filter(Boolean).join(' · ')}</sub>`,
  ].join('\n');
}

const METER_PX = 150;
const METER_BLUE = '#0969da';
const METER_GREY = '#8c959f';
const CHECK_COLOR: Record<'passed' | 'not_checked' | 'warned' | 'failed', string> = { passed: '#1a7f37', not_checked: METER_GREY, warned: '#bf8700', failed: '#d1242f' };
const SEVERITY_COLOR: Record<Severity, string> = { blocking: '#d1242f', 'should-fix': '#bf8700', nit: METER_GREY };

/** A bar in GitHub math, one coloured stretch per part, sized by its share. Empty when every part is 0. */
function mathBar(parts: readonly (readonly [string, number])[]): string {
  const total = parts.reduce((a, [, k]) => a + k, 0);
  if (!total) return '';
  const rules = parts.filter(([, k]) => k > 0).map(([c, k]) => `\\color{${c}}{\\rule{${Math.max(4, Math.round((k / total) * METER_PX))}px}{8px}}`);
  return `$${rules.join('')}$`;
}

/** The checks as one bar: green clean, grey not checked, amber a finding, red blocking. Turned-off checks are left out. */
const checksBar = (states: CheckItem[]) => mathBar((['passed', 'not_checked', 'warned', 'failed'] as const).map((s) => [CHECK_COLOR[s], states.filter((c) => c.state === s).length] as const));

/** The row's label in a code span padded to one width, so every row's bar starts at the same column, then its bar. */
const meter = (label: string, bar: string) => `\`${label.padEnd(11, ' ')}\`${bar && ` ${bar}`}`;

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

/** The summary when none of the job's checklists ran: one chip each, and no model was asked. */
export function idleSummary(states: CheckItem[], prior: State | undefined, f: Footer): string {
  return [
    SUMMARY_MARKER,
    `No checklist ran on \`${f.sha.slice(0, 7)}\`, so no model was called. Each checklist's check run says why.`,
    '',
    states.map(stateChip).join(' '),
    '',
    footer(f),
    ...(prior ? [stateLine(prior)] : []),
  ].join('\n');
}

/** The summary when the review failed: the failure's card, message and link, as the job summary has them. */
export function failedSummary(failure: ShaftFailure, prior?: State): string {
  return [SUMMARY_MARKER, failureMarkdown(failure), prior ? stateLine(prior) : ''].filter(Boolean).join('\n');
}

/** Marks the summary's dismissed section, so `/dismiss` can swap it without a review. */
export const DISMISSED_START = '<!-- shaft:dismissed -->';
export const DISMISSED_END = '<!-- /shaft:dismissed -->';

/** The findings dismissed on this pull request, with who and why: a table between the markers, or nothing. */
export function dismissedSection(dismissed: Dismissed[]): string {
  if (!dismissed.length) return '';
  const rows = dismissed.map((d) => `| ${SEVERITY_DOT[d.severity]} | ${cell(where(d))} | ${cell(prose(d.title))} | ${cell(d.by)} | ${cell(html(prose(d.reason))) || '-'} |`);
  return [DISMISSED_START, `**Dismissed:** ${dismissed.length}`, '', '| | Where | Finding | By | Why |', '|---|---|---|---|---|', ...rows, DISMISSED_END].join('\n');
}

export function renderSummary(raw: Review, placed: Placed[], prior: State | undefined, f: Footer, dismissed: Dismissed[] = []): string {
  const { headline, claim, impact, scope, not_checked } = raw;
  const review = { ...raw, headline: prose(headline), claim: prose(claim), impact: prose(impact), scope: prose(scope), not_checked: prose(not_checked) };
  const shown = placed.map((p) => ({ ...p, title: prose(p.title), body: prose(p.body) }));
  const fixed = prior?.findings.filter((p) => review.resolved.includes(p.fp)) ?? [];
  const out = [SUMMARY_MARKER, card(review, shown, fixed.length, f)];
  // Its own blockquote, after a blank line, so it doesn't run into the card's.
  if (f.latestAction) {
    const { version, url } = f.latestAction;
    const links = [f.workflowEditUrl && `[Update the workflow](${f.workflowEditUrl})`, `[Update from the dashboard](${f.dashboardRunUrl ?? DASHBOARD_URL})`];
    out.push('', '> [!NOTE]', `> Axon Shaft [v${version}](${url}) is out. This run used v${ACTION_VERSION}.`, `> ${links.filter(Boolean).join(' · ')}`);
  }
  if (f.repoConfig) {
    const { path, problems } = f.repoConfig;
    out.push('', '> [!WARNING]', `> \`${path}\` on the default branch has problems, so this review used the dashboard's settings and none of the file's.`, ...problems.map((p) => `> - ${html(prose(p)).replace(/\s+/g, ' ')}`));
  }
  if (f.flagged?.length) out.push('', '> [!WARNING]', ...f.flagged.map((l) => `> ${l}`));
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
  if (f.advisories) out.push('', `**Draft advisories:** ${f.advisories}`);

  if (fixed.length) out.push('', `**Fixed since last review:** ${fixed.length} (${fixed.map((p) => `${where(p)} ${prose(p.title)}`).join(', ')})`);
  if (dismissed.length) out.push('', dismissedSection(dismissed));
  if (f.ignored) out.push('', `**Ignored:** ${plural(f.ignored, 'finding')} matched \`ignore\` in the repo's config file.`);
  if (f.guardrailed) out.push('', `**Guardrails:** ${plural(f.guardrailed, 'finding')} on files the project's guardrails cover weren't posted.`);
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
  if (f.commands?.length) out.push('', `**Follow-up commands:** comment ${either(f.commands.map((c) => `\`/${c}\``))} and Axon Shaft pushes one commit for it.`);
  out.push('', footer(f));
  const state: State = {
    sha: f.sha,
    findings: placed.map(({ fp, file, line, severity, title, step }) => ({ fp, file, line, severity, title, step })),
    ...(dismissed.length && { dismissed }),
    ...(f.memo?.files && { files: f.memo.files, config: f.memo.config, checked: raw.checked, verdict: raw.verdict, ...(raw.gates && { gates: raw.gates }) }),
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
