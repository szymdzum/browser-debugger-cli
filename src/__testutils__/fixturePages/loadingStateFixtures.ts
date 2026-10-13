/**
 * Fixture pages for the loading state in `bdg status` and `bdg peek` (#640),
 * served by the fixture server.
 *
 * - `/loading-busy`: an inline script in the head busy-loops for
 *   {@link LOADING_BUSY_MS} before the body, so the document stays `loading`
 *   (the parser is blocked) until the loop ends, then shows `#done`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** How long the head script keeps the parser blocked */
export const LOADING_BUSY_MS = 15000;

/** Title of `/loading-busy` */
export const LOADING_BUSY_TITLE = 'busy loading';

/** A page whose head script busy-waits before the body */
const LOADING_BUSY_HTML = `<!doctype html><html><head><title>${LOADING_BUSY_TITLE}</title>
<script>
  const end = Date.now() + ${LOADING_BUSY_MS};
  while (Date.now() < end);
</script></head>
<body><p id="done">loaded</p></body></html>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/loading-busy': LOADING_BUSY_HTML,
};
