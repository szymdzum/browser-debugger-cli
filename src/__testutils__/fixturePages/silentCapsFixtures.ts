/**
 * Fixture pages for caps and filters that must say what they left out (#759),
 * served by the fixture server.
 *
 * - `/caps-console`: logs 3 `console.info` messages on load.
 * - `/caps-shown`: `#big` appends 15 `li` rows next to it (more than the 10 a
 *   read returns).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A page that logs three info messages */
const CAPS_CONSOLE_HTML = `<!doctype html><title>caps console</title>
<main>Logging</main>
<script>
  for (const n of [1, 2, 3]) console.info('info message ' + n);
</script>`;

/** A button that appends 15 rows */
const CAPS_SHOWN_HTML = `<!doctype html><title>caps shown</title>
<div><button id="big">Big</button><ul id="list"></ul></div>
<script>
  document.getElementById('big').addEventListener('click', () => {
    for (let i = 0; i < 15; i++) document.getElementById('list').insertAdjacentHTML('beforeend', '<li>big ' + i + '</li>');
  });
</script>`;

export const ROUTES: FixtureRoutes = {
  '/caps-console': CAPS_CONSOLE_HTML,
  '/caps-shown': CAPS_SHOWN_HTML,
};
