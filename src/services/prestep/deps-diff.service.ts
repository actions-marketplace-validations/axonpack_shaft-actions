import { dirname, join } from 'node:path';
import type { Checkout, Facts, ScriptInput } from '../../types/prestep.type';
import { type Ecosystem, LOCKFILES, NPM_NAME, NPM_REGISTRY, type Pin } from '../../utils/lockfile.util';

/** A package the pull request adds, removes or changes: the versions it drops (`from`) and the ones it adds (`to`). */
export type Change = { name: string; kind: 'added' | 'removed' | 'changed'; from: string[]; to: Pin[] };
export type LockfileDiff = { file: string; ecosystem: Ecosystem; changes: Change[] };

/** The biggest lockfile read from the checkout. */
const LOCK_MAX = 20_000_000;
/** The facts' cap: about 4k tokens at 4 characters a token. */
const FACTS_MAX = 16_000;

/** Whether an `.npmrc`, `.yarnrc`, `.yarnrc.yml` or `bunfig.toml` beside the lockfile or at the root sets a default registry other than npm's. */
const privateNpm = (checkout: Checkout, dir: string) =>
  [...new Set(['.', dir])].some((d) =>
    ['.npmrc', '.yarnrc', '.yarnrc.yml', 'bunfig.toml'].some((f) =>
      [...(checkout.read(join(d, f)) ?? '').matchAll(/^\s*(?:registry|npmRegistryServer)\s*[=:\s]\s*["']?([^"'\s]+)/gm)].some((m) => !NPM_REGISTRY.test(m[1]!)),
    ),
  );

/** The module path's host and owner (`github.com/acme`) from the `go.mod` beside `go.sum`: modules under it may be private. */
const goOwner = (checkout: Checkout, dir: string) => /^module\s+(\S+?\/[^/\s]+)/m.exec(checkout.read(join(dir, 'go.mod')) ?? '')?.[1];

/** Each package's pins by version, keeping the first line a version shows on. */
function byName(pins: Pin[]): Map<string, Map<string, Pin>> {
  const out = new Map<string, Map<string, Pin>>();
  for (const p of pins) {
    const versions = out.get(p.name) ?? out.set(p.name, new Map()).get(p.name)!;
    if (!versions.has(p.version)) versions.set(p.version, p);
  }
  return out;
}

/** What changed between two lists of pins, by package name. */
function diffPins(before: Pin[], after: Pin[]): Change[] {
  const [was, now] = [byName(before), byName(after)];
  return [...new Set([...was.keys(), ...now.keys()])].flatMap((name) => {
    const [b, a] = [was.get(name) ?? new Map<string, Pin>(), now.get(name) ?? new Map<string, Pin>()];
    const from = [...b.keys()].filter((v) => !a.has(v));
    const to = [...a.values()].filter((p) => !b.has(p.version));
    return from.length || to.length ? [{ name, kind: !b.size ? ('added' as const) : !a.size ? ('removed' as const) : ('changed' as const), from, to }] : [];
  });
}

/**
 * The packages each changed lockfile adds, removes or changes: the base branch's copy, read through
 * the API, against the checkout's. A pin is public only when it comes from the ecosystem's public
 * registry and the repo sets no other default registry; a Go module under the repo's own owner isn't.
 * Throws when a lockfile can't be read.
 */
export async function depsDiff({ files, checkout, base }: ScriptInput): Promise<LockfileDiff[]> {
  // ponytail: on `pull_request_target` the checkout is the head commit, so a base branch that moved on shows its own changes undone; compare against the merge base if that gets noisy.
  const out: LockfileDiff[] = [];
  for (const f of files) {
    const [, ecosystem, parse] = LOCKFILES.find(([name]) => name.test(f.filename.split('/').pop()!)) ?? [];
    if (!parse) continue;
    const head = f.status === 'removed' ? '' : checkout.read(f.filename, LOCK_MAX);
    if (head === undefined) throw new Error(`Couldn't read \`${f.filename}\` from the checkout.`);
    const dir = dirname(f.filename);
    const npmPrivate = ecosystem === 'npm' && privateNpm(checkout, dir);
    const owner = ecosystem === 'Go' ? goOwner(checkout, dir) : undefined;
    const pins = (head ? parse(head) : []).map((p) => ({
      ...p,
      public: p.public && !npmPrivate && (ecosystem !== 'npm' || NPM_NAME.test(p.name)) && !(owner && (p.name === owner || p.name.startsWith(`${owner}/`))),
    }));
    const before = f.status === 'added' ? '' : ((await base(f.filename)) ?? '');
    const changes = diffPins(before ? parse(before) : [], pins);
    if (changes.length) out.push({ file: f.filename, ecosystem: ecosystem!, changes });
  }
  return out;
}

/** The `deps-diff` facts: one line per added, removed or changed package, cut at about 4k tokens. */
export const depsDiffFacts: Facts = async (input) => {
  const lines = (await depsDiff(input)).flatMap(({ file, ecosystem, changes }) => [
    `${file} (${ecosystem}):`,
    ...changes.map(({ name, kind, from, to }) => {
      const now = to.map((p) => `${p.version}${p.public ? '' : ' (not from the public registry)'}`).join(', ');
      return `- ${kind} ${name} ${[from.join(', '), now].filter(Boolean).join(' -> ')}${to.length ? ` (line ${to[0]!.line})` : ''}`;
    }),
  ]);
  if (!lines.length) return '';
  let text = '';
  for (const [i, l] of lines.entries()) {
    if (text.length + l.length > FACTS_MAX) return `${text}... and ${lines.length - i} more lines, cut to fit.`;
    text += `${l}\n`;
  }
  return text.trimEnd();
};
