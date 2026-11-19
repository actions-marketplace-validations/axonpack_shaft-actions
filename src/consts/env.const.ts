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
