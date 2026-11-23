import { version } from '../../package.json';

/** This build's version, from `package.json`, bundled into `dist` (`1.5.0`). */
export const ACTION_VERSION = version;

/** The audience of the run's OIDC token, which the Axon Shaft API checks. */
export const API_AUDIENCE = 'https://api-shaft.axonpack.dev';

/** `SHAFT_API_URL` is for tests only; a workflow never sets it. */
export const API_URL = process.env.SHAFT_API_URL ?? API_AUDIENCE;

/** Who the AxonShaft app's comments come from. */
export const APP_BOT = 'axonshaft[bot]';

export const DASHBOARD_URL = 'https://shaft.axonpack.dev';

/** Each failure, notice and skip code has its own anchor on this page: `<CODES_URL>#<code>`. */
export const CODES_URL = 'https://shaft.axonpack.dev/docs/reference/codes';

/** Each failure code's card is `<ERROR_CARDS_URL>/<code>.svg`. */
export const ERROR_CARDS_URL = 'https://shaft.axonpack.dev/errors';
/** The summary comment's status card: `<STATUS_CARDS_URL>/<status>.svg`, a verdict. */
export const STATUS_CARDS_URL = 'https://shaft.axonpack.dev/status';
