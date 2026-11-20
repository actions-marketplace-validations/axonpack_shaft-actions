import type { Facts } from '../../types/prestep.type';
import { factsText } from '../../utils/facts.util';
import { diffLines } from '../../utils/render.util';

const NAME = `['"\`]([\\w.:/-]+)['"\`]`;
/** How code reads a flag, from the common SDKs and hand-rolled `featureFlags.x` objects, each capturing the flag's name. */
const READS = [
  `\\b(?:use(?:Feature)?Flag(?:Enabled|Variant|Payload|Value)?|useFeatureIsOn|useFeatureValue|useGate|useExperiment|useVariant|useDecision|isFeatureEnabled|isFlagEnabled|isEnabled|getFeatureFlag(?:Payload)?|getFlag|checkGate|getExperiment|(?:bool|string|number|json)?[vV]ariation|get(?:Boolean|String|Number|Object)(?:Value|Details))\\(\\s*${NAME}`,
  `\\bflag_is_active\\([^,]*,\\s*${NAME}`,
  `\\b(?:featureFlags|feature_flags|FEATURE_FLAGS)(?:\\.|\\[\\s*['"\`]?)([A-Za-z_][\\w-]*)`,
  `\\b((?:FF|FEATURE|FLAG)_[A-Z0-9_]+)\\b`,
].map((r) => new RegExp(r, 'g'));
/** The same, without `g`, for a yes or no on a whole file. */
const ANY = READS.map((r) => new RegExp(r.source));
/** Code files a flag is read from, outside build output and vendored code. */
const CODE_GLOBS = ['**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,py,go,rb,kt,swift,java,dart,vue,svelte}'];
const SKIP = /(?:^|\/)(?:dist|build|vendor|coverage|\.next|out)\//;
const SHOWN = 5;

const names = (text: string) => [...new Set(READS.flatMap((r) => [...text.matchAll(r)].map((m) => m[1]!)))];

/**
 * The `flags` facts: whether the repo reads feature flags at all, each flag an added line reads with
 * where else the repo names it, and each flag only removed lines read with where the repo still names it.
 */
export const flags: Facts = async ({ files, checkout }) => {
  const added = new Map<string, string>();
  const removed = new Map<string, string>();
  for (const f of files) {
    for (const [line, text] of diffLines(f.patch, true)) for (const n of names(text)) if (!added.has(n)) added.set(n, `${f.filename}:${line}`);
    for (const l of (f.patch ?? '').split('\n')) if (l.startsWith('-')) for (const n of names(l)) if (!removed.has(n)) removed.set(n, f.filename);
  }
  const gone = [...removed].filter(([n]) => !added.has(n));
  const wanted = [...added.keys(), ...gone.map(([n]) => n)];
  // ponytail: reads every code file in the checkout once (stopping at the first flag read when the diff names none); index by name if a huge repo makes it slow.
  const mentions = new Map<string, string[]>(wanted.map((n) => [n, []]));
  let using = 0;
  let example = '';
  for (const path of checkout.find(CODE_GLOBS).sort()) {
    if (SKIP.test(path)) continue;
    const text = checkout.read(path);
    if (!text) continue;
    if (ANY.some((r) => r.test(text))) {
      using++;
      example ||= path;
      if (!wanted.length) break;
    }
    for (const n of wanted) if (text.includes(n)) mentions.get(n)!.push(path);
  }
  const listed = (paths: string[]) => `${paths.slice(0, SHOWN).join(', ')}${paths.length > SHOWN ? ` and ${paths.length - SHOWN} more` : ''}`;
  return factsText(
    [
      using ? (wanted.length ? `The repo reads feature flags in ${using} file${using === 1 ? '' : 's'}.` : `The repo reads feature flags, such as in ${example}.`) : 'No feature flag reads found in the repo.',
      ...(added.size ? ['Flags read on added lines:', ...[...added].map(([n, at]) => `- \`${n}\` at ${at}; named in ${listed(mentions.get(n)!) || 'no file of the checkout'}`)] : []),
      ...(gone.length
        ? ['Flags only removed lines read:', ...gone.map(([n, file]) => `- \`${n}\` (was in ${file}); ${mentions.get(n)!.length ? `still named in ${listed(mentions.get(n)!)}` : 'named nowhere in the repo now'}`)]
        : []),
    ],
    '',
  );
};
