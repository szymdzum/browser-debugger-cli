/**
 * Fixture page for the suggestion after an action script threw on an element
 * given by index (#630), served by the fixture server: `/index-script-failure`
 * has one button, `#go` ("Go"). A test makes `Math.round` throw (a built-in
 * the click script uses that bdg does not check for replacement), so the
 * click script fails in the page.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A page with a single button */
const INDEX_SCRIPT_FAILURE_HTML = `<!doctype html><title>index script failure</title>
<button id="go" type="button">Go</button>`;

/** Index script failure pages by path */
export const ROUTES: FixtureRoutes = {
  '/index-script-failure': INDEX_SCRIPT_FAILURE_HTML,
};
