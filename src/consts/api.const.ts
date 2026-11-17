/** The audience of the run's OIDC token, which the Axon Shaft API checks. */
export const API_AUDIENCE = 'https://api-shaft.axonpack.dev';

/** `SHAFT_API_URL` is for tests only; a workflow never sets it. */
export const API_URL = process.env.SHAFT_API_URL ?? API_AUDIENCE;

export const INSTALL_URL = 'https://github.com/apps/axonshaft/installations/new';

export const DASHBOARD_URL = 'https://shaft.axonpack.dev';
