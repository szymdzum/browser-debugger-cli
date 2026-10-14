/**
 * Fixture pages for `console --follow` across a navigation, served by the
 * fixture server: `/follow-left` logs `left loaded` as it loads and has a
 * `#leave` button whose handler logs four errors (`first error` … `fourth
 * error`) and a warning, then navigates to `/follow-arrived` in the same
 * task, so the page is left before any poll could see it gone. `/follow-arrived`
 * logs `arrived error` and `arrived warning`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

const FOLLOW_LEFT_HTML = `<!doctype html><title>follow left</title>
<button id="leave" onclick="['first', 'second', 'third', 'fourth'].forEach((text) => console.error(text + ' error')); console.warn('left warning'); location.href = '/follow-arrived'">Leave</button>
<script>console.log('left loaded');</script>`;

const FOLLOW_ARRIVED_HTML = `<!doctype html><title>follow arrived</title>
<script>console.error('arrived error'); console.warn('arrived warning');</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/follow-left': FOLLOW_LEFT_HTML,
  '/follow-arrived': FOLLOW_ARRIVED_HTML,
};
