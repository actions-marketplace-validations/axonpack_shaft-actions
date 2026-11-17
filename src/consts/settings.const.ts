/** The settings the dashboard can set too, with their defaults. `action.yml` gives them none, so an unset input reads as empty. `timeLimit` is in minutes. */
export const SETTING_DEFAULTS = { model: 'auto', effort: 'auto', depth: 'standard', nits: 'summary', maxTurns: '30', timeLimit: '15' };

/** What `skip` is when neither the dashboard nor `.github/shaft.yml` sets it: lockfiles and generated files. `*.lock` covers bun.lock and yarn.lock. */
export const DEFAULT_SKIP = ['**/*.lock', '**/package-lock.json', '**/pnpm-lock.yaml', '**/dist/**', '**/*.min.js', '**/*.snap'];
