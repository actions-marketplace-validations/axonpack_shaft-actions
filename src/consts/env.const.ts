/** The runner's variables the CLI, and so every command the model runs, always gets: no tokens among them. */
export const ENV_ALLOW = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'CI',
  'GITHUB_ACTIONS',
  'RUNNER_OS',
  'RUNNER_ARCH',
  'GITHUB_REPOSITORY',
  'GITHUB_SHA',
  'GITHUB_REF',
  'GITHUB_WORKSPACE',
];

/** Names a project's own list can never pass on: the runner's OIDC and runtime tokens, the action's inputs, Claude's tokens and the workflow's GitHub token. */
export const ENV_DENIED = /^(ACTIONS_|INPUT_|ANTHROPIC_|CLAUDE_)|^GITHUB_TOKEN$/;

/** Prefixes an OpenCode key's name may never start with, as the API checks them. */
export const KEY_NAME_DENIED_PREFIXES = ['LD_', 'GITHUB_', 'ACTIONS_', 'INPUT_', 'ANTHROPIC_', 'CLAUDE_'];

/** The exact names allowed despite a refused prefix: Anthropic's key, for OpenCode's Anthropic models (the user's call). */
export const KEY_NAME_ALLOWED = ['ANTHROPIC_API_KEY'];
