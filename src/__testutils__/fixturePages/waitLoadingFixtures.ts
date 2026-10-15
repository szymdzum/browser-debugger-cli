/**
 * Fixture page for the timeout of `bdg dom wait` on a page that is still
 * loading (#775), served by the fixture server.
 *
 * - `/wait-load-hang`: a script in the head comes from `/slow`, which the
 *   fixture server answers after 8 s, so the parser is blocked and the
 *   document stays `loading` with that request pending for far longer than
 *   the short `--timeout` the test waits with.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A page whose head script arrives long after a short wait gives up */
const WAIT_LOAD_HANG_HTML = `<!doctype html><html><head><title>wait load hang</title>
<script src="/slow"></script></head>
<body><p id="done">loaded</p></body></html>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/wait-load-hang': WAIT_LOAD_HANG_HTML,
};
