/**
 * Fixture page for the grouping of repeated requests in an action's human
 * output (#670), served by the fixture server: `/repeated-requests` has
 * `#fire`, which sends 8 `POST /event?s=0..7` beacons (one query string
 * each) and 2 distinct requests, `GET /api/test` and `POST /api/other`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A button that fires 8 identical-path beacons and 2 other requests */
const REPEATED_REQUESTS_HTML = `<!doctype html><title>repeated requests</title>
<button id="fire" type="button" onclick="
  for (let i = 0; i < 8; i++) fetch('/event?s=' + i, { method: 'POST', body: 'x' });
  fetch('/api/test');
  fetch('/api/other', { method: 'POST', body: 'y' });
">Fire</button>`;

export const ROUTES: FixtureRoutes = {
  '/repeated-requests': REPEATED_REQUESTS_HTML,
  '/event': 'ok',
  '/api/other': 'ok',
};
