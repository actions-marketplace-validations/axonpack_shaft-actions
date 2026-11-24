import type { Script, ScriptFinding } from '../../types/prestep.type';
import { LOCKFILES } from '../../utils/lockfile.util';
import { diffLines } from '../../utils/render.util';

/** Known key and token formats, by the name a finding gives them. */
const KINDS: [kind: string, format: RegExp][] = [
  ['a private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['an AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ['an Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['an OpenAI API key', /\bsk-[A-Za-z0-9_-]*T3BlbkFJ[A-Za-z0-9_-]+/],
  ['a Stripe secret key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['a Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['a Slack webhook URL', /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]+/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['an npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
];

/** `AKIAXXXXXXXXXXXXXXXX`, `...EXAMPLE` and the like: six of one character in a row, or "example". */
const PLACEHOLDER = /(.)\1{5}|example/i;

/** The entropy rule's thresholds when the API sends none: bits per character, and the shortest string it looks at. */
export const ENTROPY = { entropy: 4.5, minLength: 20 };
/** A quoted string, or the value after `=` or `:`, with no spaces: where a key would sit. */
const VALUE = /["'`]([A-Za-z0-9+/=_\-.~]+)["'`]|[=:]\s*([A-Za-z0-9+/=_\-.~]+)\s*$/g;

/** Shannon entropy in bits per character. */
export function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  return [...counts.values()].reduce((h, n) => h - (n / s.length) * Math.log2(n / s.length), 0);
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && v > 0 ? v : fallback);

/**
 * Keys and tokens in a known format on added lines, as blocking. A long random-looking string on any
 * other added line (Shannon entropy over `data.entropy` bits a character, at least `data.minLength`
 * long) is should-fix, since entropy alone is noisy. Lockfiles are left out of the entropy rule. A
 * finding names the kind and the line, never the value.
 */
export const secrets: Script = ({ files }, data) => {
  const min = num(data?.entropy, ENTROPY.entropy);
  const length = num(data?.minLength, ENTROPY.minLength);
  return files.flatMap((f) => {
    const lockfile = LOCKFILES.some(([name]) => name.test(f.filename));
    return [...diffLines(f.patch, true)].flatMap(([line, text]): ScriptFinding[] => {
      const known = KINDS.filter(([, format]) => {
        const m = format.exec(text);
        return m && !PLACEHOLDER.test(m[0]);
      }).map(([kind]) => ({
        severity: 'blocking' as const,
        file: f.filename,
        line,
        title: `Possible ${kind.replace(/^an? /, '')} in an added line`,
        body: `This line adds what looks like ${kind}. The value isn't shown here. If it's real, rotate it now, since it's already in the branch's history, and load it from a secret or an env var instead.`,
      }));
      if (known.length || lockfile || KINDS.some(([, format]) => format.test(text))) return known;
      const random = [...text.matchAll(VALUE)].map((m) => m[1] ?? m[2]!).find((v) => v.length >= length && !PLACEHOLDER.test(v) && !/^[a-z]+:\/\//i.test(v) && shannon(v) >= min);
      return random
        ? [{ severity: 'should-fix', file: f.filename, line, title: 'Possible secret: a long random string', body: `This line adds a ${random.length}-character string that looks random (${shannon(random).toFixed(1)} bits a character). The value isn't shown here. If it's a key or a token, rotate it and load it from a secret or an env var instead.` }]
        : [];
    });
  });
};
