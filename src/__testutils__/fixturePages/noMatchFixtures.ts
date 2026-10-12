/**
 * Fixture page for the "selector matches nothing" message, served by the
 * fixture server: `/no-match` has a heading, a field and a button, and no
 * element with the id `nothing`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A page with a few elements, none of which `#nothing` matches */
const NO_MATCH_HTML = `<!doctype html><title>no match</title>
<h1 id="title">No match</h1>
<form id="form"><input id="field" name="field"><button id="go" type="button">Go</button></form>`;

/** No-match pages by path */
export const ROUTES: FixtureRoutes = {
  '/no-match': NO_MATCH_HTML,
};
