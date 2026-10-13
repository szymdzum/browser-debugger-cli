/**
 * Fixture pages for the loading state in `bdg status` and `bdg peek` (#640),
 * served by the fixture server.
 *
 * - `/loading-slow-script`: a script in the head comes from `/slow`, which
 *   the fixture server answers after 8 s, so the parser is blocked and the
 *   document stays `loading` with that request pending, then shows `#done`.
 *   (A script that busy-loops would block the page's main thread, which then
 *   cannot answer for `document.readyState` either.)
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Title of `/loading-slow-script` */
export const LOADING_SLOW_TITLE = 'slow script loading';

/** A page whose head script arrives late */
const LOADING_SLOW_HTML = `<!doctype html><html><head><title>${LOADING_SLOW_TITLE}</title>
<script src="/slow"></script></head>
<body><p id="done">loaded</p></body></html>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/loading-slow-script': LOADING_SLOW_HTML,
};
