/**
 * Fixture page for a page that removes `globalThis` (#637): `/no-globalthis`
 * sets `window.globalThis = undefined` in a head script (a writable global
 * property, so it takes) and has a text field (`#name`) and a button (`#go`,
 * whose text becomes "Clicked" when clicked). bdg's actions must not depend
 * on it to find the page's global object.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

const NO_GLOBALTHIS_HTML = `<!doctype html><html><head><title>No globalThis</title>
<script>window.globalThis = undefined;</script>
</head><body>
<input id="name">
<button type="button" id="go" onclick="this.textContent = 'Clicked'">Go</button>
</body></html>`;

export const ROUTES: FixtureRoutes = {
  '/no-globalthis': NO_GLOBALTHIS_HTML,
};
