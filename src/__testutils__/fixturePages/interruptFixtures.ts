/**
 * Fixture page for commands interrupted while the page is busy (#611),
 * served by the fixture server: on `/busy`, clicking `#b` tells the fixture
 * server (`/beacon?clicked`, a synchronous request, so the server has it
 * before the page turns busy) and then keeps the page's main thread busy for
 * {@link BUSY_MS}, so a `bdg dom click '#b'` is still waiting for the page
 * when the test interrupts it.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** How long a click keeps the page busy; the test signals within milliseconds */
export const BUSY_MS = 8000;

/** A button whose click handler busy-waits */
const BUSY_HTML = `<!doctype html><title>busy</title>
<button id="b">Busy</button>
<script>
  document.getElementById('b').addEventListener('click', () => {
    const beacon = new XMLHttpRequest();
    beacon.open('GET', '/beacon?clicked', false);
    beacon.send();
    const end = Date.now() + ${BUSY_MS};
    while (Date.now() < end);
  });
</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/busy': BUSY_HTML,
};
