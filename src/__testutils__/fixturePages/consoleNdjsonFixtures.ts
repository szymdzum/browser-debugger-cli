/**
 * Fixture pages for `console --follow --ndjson`, served by the fixture
 * server: `/ndjson-start` logs `start message` and has a `#go` button that
 * navigates to `/ndjson-quiet?token=hunter2secret`, a page that logs nothing
 * and has a `#next` button that navigates to `/ndjson-end`, which logs
 * `end message`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

const START_HTML = `<!doctype html><title>ndjson start</title>
<button id="go" onclick="location.href = '/ndjson-quiet?token=hunter2secret'">Go</button>
<script>console.log('start message');</script>`;

const QUIET_HTML = `<!doctype html><title>ndjson quiet</title>
<button id="next" onclick="location.href = '/ndjson-end'">Next</button>`;

const END_HTML = `<!doctype html><title>ndjson end</title>
<script>console.log('end message');</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/ndjson-start': START_HTML,
  '/ndjson-quiet': QUIET_HTML,
  '/ndjson-end': END_HTML,
};
