/**
 * Fixture pages for commands given while a click-started navigation waits
 * for the server (#946), served by the fixture server.
 *
 * - `/pending-nav`: a link `#orders` to `/authenticate-hanging` (the fixture
 *   server reads that request and never answers), a link `#help` to
 *   `/pending-nav-help` (which answers), a link `#slow8` to `/slow` (the
 *   fixture server answers it after 8 s with its main test page, which has
 *   `#test-button`), a text field `#name` and a button
 *   `#save`. Clicking `#orders` leaves the page with a pending navigation,
 *   so Chrome holds every later command for the page.
 * - `/pending-nav-help`: a plain page titled {@link PENDING_NAV_HELP_TITLE}.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Title of `/pending-nav-help` */
export const PENDING_NAV_HELP_TITLE = 'pending nav help';

/** The page whose `#orders` link never gets an answer */
const PENDING_NAV_HTML = `<!doctype html><title>pending nav</title>
<a id="orders" href="/authenticate-hanging">orders</a>
<a id="help" href="/pending-nav-help">help</a>
<a id="slow8" href="/slow">slow</a>
<input id="name" value="">
<button id="save" type="button">save</button>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/pending-nav': PENDING_NAV_HTML,
  '/pending-nav-help': `<!doctype html><title>${PENDING_NAV_HELP_TITLE}</title><h1>help</h1>`,
};
