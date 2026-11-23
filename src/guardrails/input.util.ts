import { CODE_GROUPS, RULES, THRESHOLDS } from './guardrail.const';

export type Verdict = 'clean' | 'suspicious' | 'harmful';
export type Scan = { score: number; hits: string[]; verdict: Verdict };

/** A zero-width joiner between two emoji (👨‍👩‍👧) is how they're written, not concealment. */
const EMOJI_ZWJ = /(\p{Extended_Pictographic}️?)‍(?=\p{Extended_Pictographic})/gu;
const INVISIBLE = /[​-‏‪-‮⁦-⁩]/g;

/**
 * The rules `text` breaks, its score and verdict. Full-width and other look-alike letters are folded
 * (NFKC) and invisible characters taken out before matching, so neither hides a phrase; an invisible
 * character still counts as a hit itself. `code` text (diff lines) runs only `CODE_GROUPS`.
 */
export function scanInput(text: string, kind: 'prose' | 'code' = 'prose'): Scan {
  const raw = text.normalize('NFKC').replace(EMOJI_ZWJ, '$1');
  const plain = raw.replace(INVISIBLE, '');
  const rules = kind === 'code' ? RULES.filter((r) => CODE_GROUPS.includes(r.group)) : RULES;
  const hit = rules.filter((r) => r.pattern.test(r.group === 'concealment' ? raw : plain));
  const score = hit.reduce((n, r) => n + r.weight, 0);
  return { score, hits: hit.map((r) => r.id), verdict: score >= THRESHOLDS.HARMFUL ? 'harmful' : score >= THRESHOLDS.SUSPICIOUS ? 'suspicious' : 'clean' };
}

/** The text without quoted (`> `) lines: quoting someone never strikes the person who quotes. */
export const withoutQuotes = (text: string) =>
  text
    .split('\n')
    .filter((l) => !/^\s*>/.test(l))
    .join('\n');

/** `text` cut to `max` characters and each line to `line`, and whether anything was cut. */
export function capText(text: string, max: number, line: number): { text: string; cut: boolean } {
  const lines = text.slice(0, max).split('\n').map((l) => (l.length > line ? `${l.slice(0, line)} (line cut)` : l));
  const out = lines.join('\n');
  return out === text ? { text, cut: false } : { text: `${out}\n(cut by Axon Shaft: the text was over its size limit)`, cut: true };
}

/** Spotlighting's datamarking: the words of untrusted text joined by `ˆ`, so the model can't mistake it for its own instructions. */
export const datamark = (text: string) => text.replace(/(?<=\S)[ \t]+(?=\S)/g, 'ˆ');
