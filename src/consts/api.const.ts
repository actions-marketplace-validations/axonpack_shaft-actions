/** The audience of the run's OIDC token, which the Axon Shaft API checks. */
export const API_AUDIENCE = 'https://api-shaft.axonpack.dev';

/** `SHAFT_API_URL` is for tests only; a workflow never sets it. */
export const API_URL = process.env.SHAFT_API_URL ?? API_AUDIENCE;

/** Mentioning the GitHub App in a comment is the one way to start a task. */
export const APP_MENTION = '@axonshaft';

export const INSTALL_URL = 'https://github.com/apps/axonshaft/installations/new';

export const DASHBOARD_URL = 'https://shaft.axonpack.dev';
