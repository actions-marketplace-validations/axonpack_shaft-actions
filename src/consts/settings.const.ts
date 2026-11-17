/** The settings the dashboard can set too, with their defaults. `action.yml` gives them none, so an unset input reads as empty. `timeLimit` is in minutes. */
export const SETTING_DEFAULTS = { model: 'auto', effort: 'auto', depth: 'standard', nits: 'summary', maxTurns: '30', timeLimit: '15' };

/** The repo's guides the review reads from the base branch, in this order, and how much of them. */
export const GUIDE_FILES = ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'CONVENTIONS.md', '.github/pull_request_template.md', 'README.md'];
export const GUIDE_CAP = { file: 8_000, total: 30_000 };

/** What `skip` is when neither the dashboard nor `.github/shaft.yml` sets it: lockfiles and generated files. `*.lock` covers bun.lock and yarn.lock. */
export const DEFAULT_SKIP = ['**/*.lock', '**/package-lock.json', '**/pnpm-lock.yaml', '**/dist/**', '**/*.min.js', '**/*.snap'];
