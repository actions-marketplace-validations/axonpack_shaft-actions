/**
 * Files outside `.github/` that decide what runs on install, in Git hooks and in CI. A `/fix` with
 * words, or `/axonshaft`, may change one only when its request asks for that kind of change: it names
 * the file, or says one of `words`. A lockfile also passes with a dependency change the request asked
 * for, in its own package or one below it.
 */
export const BUILD_INPUTS: { pattern: RegExp; words: RegExp; lockfile?: true }[] = [
  { pattern: /(^|\/)\.npmrc$/, words: /\bnpmrc\b/i },
  { pattern: /(^|\/)\.yarnrc(\.ya?ml)?$/, words: /\byarnrc\b/i },
  { pattern: /(^|\/)bunfig\.toml$/, words: /\bbunfig\b/i },
  { pattern: /(^|\/)(GNUmakefile|[Mm]akefile)$/, words: /\bmakefile\b/i },
  { pattern: /(^|\/)Dockerfile[^/]*$/, words: /\bdockerfile\b/i },
  { pattern: /(^|\/)\.husky\//, words: /\bhusky\b|\bgit hooks?\b/i },
  { pattern: /(^|\/)\.git-hooks\//, words: /\bgit hooks?\b/i },
  {
    pattern: /(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/,
    // Saying "dependency" isn't enough: that lets a lockfile through only with its manifest's dependency change.
    words: /\block ?files?\b/i,
    lockfile: true,
  },
];

/** A package manifest: its `scripts`, and the fields that decide what gets installed and run on install. */
export const MANIFEST = {
  pattern: /(^|\/)package\.json$/,
  scripts: /\bscripts?\b/i,
  deps: /\bdep(s|endenc(y|ies))\b/i,
  depFields: ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'overrides', 'resolutions', 'pnpm', 'trustedDependencies', 'packageManager'],
};
