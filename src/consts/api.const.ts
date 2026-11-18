/** The audience of the run's OIDC token, which the Axon Shaft API checks. */
export const API_AUDIENCE = 'https://api-shaft.axonpack.dev';

/** `SHAFT_API_URL` is for tests only; a workflow never sets it. */
export const API_URL = process.env.SHAFT_API_URL ?? API_AUDIENCE;


/** Who the AxonShaft app's comments come from. */
export const APP_BOT = 'axonshaft[bot]';

export const DASHBOARD_URL = 'https://shaft.axonpack.dev';

/** Each failure code's card is `<ERROR_CARDS_URL>/<code>.svg`. */
export const ERROR_CARDS_URL = 'https://shaft.axonpack.dev/errors';
/** The summary comment's status card: `<STATUS_CARDS_URL>/<status>.svg`, `reviewing` or a verdict. */
export const STATUS_CARDS_URL = 'https://shaft.axonpack.dev/status';
