export type Ecosystem = 'npm' | 'PyPI' | 'Go' | 'crates.io';
/** One package version a lockfile pins: its line, and whether it comes from the public registry. */
export type Pin = { name: string; version: string; line: number; public: boolean };

/** npm's public registry, under either host. */
export const NPM_REGISTRY = /^https?:\/\/registry\.(?:npmjs\.org|yarnpkg\.com)(?:\/|$)/;
/** A valid npm name; anything else (an older pnpm key, a path) is never sent anywhere. */
export const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/** npm 7+ `packages`: every installed copy, so one name can pin several versions. Links (workspaces) are left out. */
function packageLock(text: string): Pin[] {
  const at = new Map<string, number>();
  text.split('\n').forEach((l, i) => {
    const m = /^\s*"([^"]*node_modules\/[^"]+)":/.exec(l);
    if (m && !at.has(m[1]!)) at.set(m[1]!, i + 1);
  });
  return Object.entries<{ name?: string; version?: string; resolved?: string; link?: boolean }>(JSON.parse(text).packages ?? {}).flatMap(([key, p]) =>
    key.includes('node_modules/') && !p.link && p.version
      ? [{ name: p.name ?? key.slice(key.lastIndexOf('node_modules/') + 13), version: p.version, line: at.get(key) ?? 1, public: !p.resolved || NPM_REGISTRY.test(p.resolved) }]
      : [],
  );
}

/** Bun's text lockfile: `"key": ["name@version", "registry", ...]`, where an empty registry is the default one. */
function bunLock(text: string): Pin[] {
  return text.split('\n').flatMap((l, i) => {
    const m = /^\s*"[^"]+":\s*\["((?:@[^@"/]+\/)?[^@"]+)@([^"]+)"(?:,\s*"([^"]*)")?/.exec(l);
    if (!m || m[2]!.startsWith('workspace:')) return [];
    return [{ name: m[1]!, version: m[2]!, line: i + 1, public: !m[2]!.includes(':') && (!m[3] || NPM_REGISTRY.test(m[3])) }];
  });
}

/** Yarn 1 (`version "1.0.0"`, `resolved "url"`) and Yarn 2+ (`version: 1.0.0`, `resolution: "name@npm:1.0.0"`). */
function yarnLock(text: string): Pin[] {
  const out: Pin[] = [];
  let name: string | undefined;
  text.split('\n').forEach((l, i) => {
    if (/^[^\s#].*:$/.test(l)) {
      const spec = unquote(l.slice(0, -1).split(',')[0]!);
      name = spec === '__metadata' ? undefined : spec.slice(0, spec.indexOf('@', 1));
      return;
    }
    const v = name && /^\s+version:? "?([^"\s]+)"?$/.exec(l);
    if (v) out.push({ name: name!, version: v[1]!, line: i + 1, public: true });
    const r = name && out.length && /^\s+(resolved|resolution):? "?([^"\s]+)"?$/.exec(l);
    if (!r) return;
    if (r[2]!.includes('@workspace:')) out.pop();
    else out.at(-1)!.public = r[1] === 'resolved' ? NPM_REGISTRY.test(r[2]!) : /@npm:[^:]+$/.test(r[2]!);
  });
  return out;
}

/** pnpm 6+ `packages:` keys (`name@version`, peers in brackets). A tarball, git or folder resolution isn't the registry. */
function pnpmLock(text: string): Pin[] {
  const out: Pin[] = [];
  let section = '';
  text.split('\n').forEach((l, i) => {
    if (/^\S/.test(l)) section = l;
    if (section !== 'packages:') return;
    const m = /^ {2}'?\/?([^\s']+?)'?:$/.exec(l);
    if (m) {
      const key = m[1]!.replace(/\(.*$/, '');
      const at = key.lastIndexOf('@');
      if (at > 0) out.push({ name: key.slice(0, at), version: key.slice(at + 1), line: i + 1, public: !key.slice(at + 1).includes(':') });
    } else if (out.length && /^\s+resolution: \{.*\b(?:tarball|repo|directory|type):/.test(l)) out.at(-1)!.public = false;
  });
  return out;
}

/** Pinned `name==version` lines. Any index other than PyPI makes every line private. */
function requirements(text: string): Pin[] {
  const indexes = [...text.matchAll(/^\s*(?:-i|--index-url|--extra-index-url)[\s=]+(\S+)/gm)].map((m) => m[1]!);
  const pub = indexes.every((u) => /^https:\/\/pypi\.org\/simple\/?$/.test(u));
  return text.split('\n').flatMap((l, i) => {
    const m = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([^\s;#,]+)/.exec(l);
    return m ? [{ name: m[1]!.toLowerCase(), version: m[2]!, line: i + 1, public: pub }] : [];
  });
}

/**
 * `[[package]]` blocks with `name`, `version` and a source (Cargo, Poetry, uv). `source` says from
 * the block's source whether it's public, or undefined for a local package, which is left out.
 */
const tomlPackages = (source: (src: string | undefined) => boolean | undefined) => (text: string): Pin[] => {
  const out: Pin[] = [];
  let cur: { name?: string; version?: string; line?: number; src?: string } | undefined;
  const flush = () => {
    const pub = cur?.name && cur.version ? source(cur.src) : undefined;
    if (pub !== undefined) out.push({ name: cur!.name!, version: cur!.version!, line: cur!.line!, public: pub });
  };
  text.split('\n').forEach((l, i) => {
    if (l === '[[package]]') {
      flush();
      cur = {};
    } else if (cur && l === '[package.source]') cur.src ??= 'custom';
    else if (cur) {
      const m = /^(name|version|source) = (.+)$/.exec(l);
      if (m?.[1] === 'name') cur.name ??= unquote(m[2]!);
      if (m?.[1] === 'version' && !cur.version) [cur.version, cur.line] = [unquote(m[2]!), i + 1];
      if (m?.[1] === 'source') cur.src ??= m[2];
    }
  });
  flush();
  return out;
};

const cargoLock = tomlPackages((src) =>
  src === undefined ? undefined : /^"(?:registry\+https:\/\/github\.com\/rust-lang\/crates\.io-index|sparse\+https:\/\/index\.crates\.io\/)"$/.test(src),
);
const poetryLock = tomlPackages((src) => src === undefined);
const uvLock = tomlPackages((src) => (!src || /\b(?:editable|virtual|directory|path) =/.test(src) ? undefined : /registry = "https:\/\/pypi\.org\/simple\/?"/.test(src)));

/** `module version[/go.mod] h1:` lines, one pin per module and version. */
function goSum(text: string): Pin[] {
  const seen = new Set<string>();
  return text.split('\n').flatMap((l, i) => {
    const m = /^(\S+) (v[^\s/]+)(?:\/go\.mod)? h1:/.exec(l);
    if (!m || seen.has(`${m[1]} ${m[2]}`)) return [];
    seen.add(`${m[1]} ${m[2]}`);
    return [{ name: m[1]!, version: m[2]!, line: i + 1, public: true }];
  });
}

/** Each lockfile the action reads, by file name, with its ecosystem and parser. */
export const LOCKFILES: [name: RegExp, ecosystem: Ecosystem, parse: (text: string) => Pin[]][] = [
  [/^(?:package-lock|npm-shrinkwrap)\.json$/, 'npm', packageLock],
  [/^bun\.lock$/, 'npm', bunLock],
  [/^yarn\.lock$/, 'npm', yarnLock],
  [/^pnpm-lock\.yaml$/, 'npm', pnpmLock],
  [/^requirements.*\.txt$/, 'PyPI', requirements],
  [/^poetry\.lock$/, 'PyPI', poetryLock],
  [/^uv\.lock$/, 'PyPI', uvLock],
  [/^Cargo\.lock$/, 'crates.io', cargoLock],
  [/^go\.sum$/, 'Go', goSum],
];
