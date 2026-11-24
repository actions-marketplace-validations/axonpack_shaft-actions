import * as core from '@actions/core';
import { CODE_GROUPS, RULES, type Rule, THRESHOLDS } from './guardrail.const';

export type Verdict = 'clean' | 'suspicious' | 'harmful';
export type Scan = { score: number; hits: string[]; verdict: Verdict };

/** A zero-width joiner between two emoji (👨‍👩‍👧) is how they're written, not concealment. */
const EMOJI_ZWJ = /(\p{Extended_Pictographic}️?)‍(?=\p{Extended_Pictographic})/gu;
const INVISIBLE = /[​-‏‪-‮⁦-⁩]/g;

/**
 * The rules `text` breaks, its score and verdict. Full-width and other look-alike letters are folded
 * (NFKC) and invisible characters taken out before matching, so neither hides a phrase; an invisible
 * character still counts as a hit itself. `code` text (diff lines) runs only `CODE_GROUPS`. The API's
 * extra rules run too, on at most `SERVER_RULES_MAX.input` characters, so a slow pattern stays bounded.
 */
export function scanInput(text: string, kind: 'prose' | 'code' = 'prose'): Scan {
  const raw = text.normalize('NFKC').replace(EMOJI_ZWJ, '$1');
  const plain = raw.replace(INVISIBLE, '');
  const all = [...RULES, ...extra];
  const rules = kind === 'code' ? all.filter((r) => CODE_GROUPS.includes(r.group)) : all;
  const hit = rules.filter((r) => {
    const t = r.group === 'concealment' ? raw : plain;
    return r.pattern.test(RULES.includes(r) ? t : t.slice(0, SERVER_RULES_MAX.input));
  });
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

/** Caps on the API's extra rules: how many, how long a pattern, and how much of a text they read. */
export const SERVER_RULES_MAX = { count: 50, pattern: 300, input: 20_000 };

const GROUPS: Rule['group'][] = ['override', 'exfiltration', 'destructive', 'concealment', 'spoofing', 'steering'];
/** A quantified group that holds a quantifier, such as `(a+)+`: the usual shape of catastrophic backtracking. */
const NESTED = /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/;

let extra: Rule[] = [];

/** The API's extra rules this run adds to the built-in ones. */
export const serverRules = (): Rule[] => extra;

/**
 * Take the grant's extra rules (`guardrail.rules`), which are untrusted data. Each needs an `id`,
 * `name`, known `group`, a `weight` from 1 to `HARMFUL` and a `pattern` that compiles with flags from
 * `imsu` and has no nested quantifier; any other is skipped with a warning. Built-in IDs can't be
 * reused, so the server can only add checks, never replace or weaken one. Nothing sent (an older
 * API) leaves the built-in rules alone.
 */
export function setServerRules(raw: unknown) {
  extra = [];
  if (!Array.isArray(raw)) return;
  const taken = new Set(RULES.map((r) => r.id));
  for (const r of raw.slice(0, SERVER_RULES_MAX.count)) {
    const rule = parseRule(r, taken);
    if (typeof rule === 'string') core.warning(`Guardrail: skipped a rule from the API (${rule}).`);
    else {
      taken.add(rule.id);
      extra.push(rule);
    }
  }
}

function parseRule(r: unknown, taken: Set<string>): Rule | string {
  if (!r || typeof r !== 'object') return 'not an object';
  const { id, name, group, weight, pattern, flags = '' } = r as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[\w.-]{1,64}$/.test(id) || taken.has(id)) return `bad or taken id ${String(id).slice(0, 64)}`;
  if (typeof name !== 'string' || !name || name.length > 120) return `${id}: bad name`;
  if (!GROUPS.includes(group as Rule['group'])) return `${id}: unknown group`;
  if (typeof weight !== 'number' || !Number.isInteger(weight) || weight < 1 || weight > THRESHOLDS.HARMFUL) return `${id}: bad weight`;
  if (typeof pattern !== 'string' || !pattern || pattern.length > SERVER_RULES_MAX.pattern || NESTED.test(pattern)) return `${id}: bad or risky pattern`;
  if (typeof flags !== 'string' || !/^[imsu]*$/.test(flags)) return `${id}: bad flags`;
  try {
    return { id, name, group: group as Rule['group'], weight, pattern: new RegExp(pattern, flags) };
  } catch {
    return `${id}: pattern doesn't compile`;
  }
}
