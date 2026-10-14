/**
 * Fixture pages for caps and filters that must say what they left out (#759),
 * served by the fixture server.
 *
 * - `/caps-console`: logs 3 `console.info` messages on load.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A page that logs three info messages */
const CAPS_CONSOLE_HTML = `<!doctype html><title>caps console</title>
<main>Logging</main>
<script>
  for (const n of [1, 2, 3]) console.info('info message ' + n);
</script>`;

export const ROUTES: FixtureRoutes = {
  '/caps-console': CAPS_CONSOLE_HTML,
};
