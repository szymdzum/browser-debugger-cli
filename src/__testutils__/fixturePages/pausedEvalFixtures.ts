/**
 * Fixture page for `eval` on a page paused in the debugger (#857), served by
 * the fixture server: on `/paused`, clicking `#b` tells the fixture server
 * (`/beacon?paused`, a synchronous request, so the server has it before the
 * pause), hits a `debugger;` statement and, once resumed, sets the title to
 * `after`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A button whose click handler pauses the debugger */
const PAUSED_HTML = `<!doctype html><title>before</title>
<button id="b" onclick="(() => { const r = new XMLHttpRequest(); r.open('GET', '/beacon?paused', false); r.send(); })(); debugger; document.title = 'after'">go</button>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/paused': PAUSED_HTML,
};
