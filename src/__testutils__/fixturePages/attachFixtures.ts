/**
 * Fixture pages for `bdg attach` (#473), opened in a Chrome before bdg
 * attaches to it: `/attach-a` ("Attach A") logs an error and sets
 * `window.__marker` as it loads, so a test can tell that bdg kept the page
 * (no reload) and recovered the error logged before it attached;
 * its link `#attach-download` downloads `note.html`; `/attach-b` ("Attach
 * B") is a second tab to choose against. `/attach-frame` embeds
 * `/attach-frame-inner` from `inner.test` instead of `127.0.0.1` (another
 * site, so an out-of-process iframe; the test maps `inner.test` to
 * 127.0.0.1 with `--host-resolver-rules` and lets it download over http), whose link `#inner-download`
 * downloads `inner.html`.
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

/** A tab with a cross-site iframe */
const ATTACH_FRAME_HTML = `<!doctype html><title>Attach frame</title>
<iframe id="inner"></iframe>
<script>
  document.getElementById('inner').src =
    location.href.replace('127.0.0.1', 'inner.test').replace('attach-frame', 'attach-frame-inner');
</script>`;

/** The cross-site iframe's page */
const ATTACH_FRAME_INNER_HTML = `<!doctype html><title>Inner</title>
<a id="inner-download" href="/attach-b" download="inner.html">Download</a>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/attach-frame': ATTACH_FRAME_HTML,
  '/attach-frame-inner': ATTACH_FRAME_INNER_HTML,
  '/attach-a': ATTACH_A_HTML,
  '/attach-b': ATTACH_B_HTML,
};
