/**
 * Fixture page for object groups left by a killed CLI (#606), served by the
 * fixture server: `/many` holds {@link MANY_ELEMENTS} elements, so a
 * `bdg dom query "*"` keeps its selection in the page long enough for the
 * test to kill the CLI while the query is in flight.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Elements on `/many` */
export const MANY_ELEMENTS = 300000;

/** A page with many elements, built by its own script */
const MANY_HTML = `<!doctype html><title>many</title>
<div id="box"></div>
<script>
  document.getElementById('box').innerHTML = '<span></span>'.repeat(${MANY_ELEMENTS});
</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/many': MANY_HTML,
};
