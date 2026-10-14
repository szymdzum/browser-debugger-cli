/**
 * Fixture pages for `bdg attach` (#473), opened in a Chrome before bdg
 * attaches to it: `/attach-a` ("Attach A") logs an error and sets
 * `window.__marker` as it loads, so a test can tell that bdg kept the page
 * (no reload) and recovered the error logged before it attached;
 * its link `#attach-download` downloads `note.html`; `/attach-b` ("Attach
 * B") is a second tab to choose against.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** The tab to attach to */
const ATTACH_A_HTML = `<!doctype html><title>Attach A</title>
<h1 id="attach-heading">Tab A</h1>
<a id="attach-download" href="/attach-b" download="note.html">Download</a>
<script>
  window.__marker = 'kept';
  console.error('early error from tab A');
</script>`;

/** Another tab */
const ATTACH_B_HTML = `<!doctype html><title>Attach B</title>
<h1>Tab B</h1>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/attach-a': ATTACH_A_HTML,
  '/attach-b': ATTACH_B_HTML,
};
