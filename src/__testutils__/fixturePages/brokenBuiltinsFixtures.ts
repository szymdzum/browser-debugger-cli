/**
 * Fixture page for a page that breaks a built-in bdg's action scripts use,
 * served by the fixture server: `/broken-root` replaces
 * `Node.prototype.getRootNode` with a function that throws (as an anti-bot
 * script does), and has the text field `#name`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A field on a page whose `getRootNode` throws */
const BROKEN_ROOT_HTML = `<!doctype html><title>broken root</title>
<input id="name">
<script>
  Node.prototype.getRootNode = function () { throw new Error('anti-bot: getRootNode'); };
</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/broken-root': BROKEN_ROOT_HTML,
};
