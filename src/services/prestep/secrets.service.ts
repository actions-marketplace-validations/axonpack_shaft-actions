import type { Script } from '../../types/prestep.type';
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

/** Keys and tokens in a known format on added lines. A finding names the kind and the line, never the value. */
export const secrets: Script = ({ files }) =>
  files.flatMap((f) =>
    [...diffLines(f.patch, true)].flatMap(([line, text]) =>
      KINDS.filter(([, format]) => {
        const m = format.exec(text);
        return m && !PLACEHOLDER.test(m[0]);
      }).map(([kind]) => ({
        severity: 'blocking' as const,
        file: f.filename,
        line,
        title: `Possible ${kind.replace(/^an? /, '')} in an added line`,
        body: `This line adds what looks like ${kind}. The value isn't shown here. If it's real, rotate it now, since it's already in the branch's history, and load it from a secret or an env var instead.`,
      })),
    ),
  );
