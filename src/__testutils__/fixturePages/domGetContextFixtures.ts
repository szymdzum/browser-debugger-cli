/**
 * Fixture page for what `dom get` says about an element (#586), served by the
 * fixture server: `/dom-get-context` has a paragraph with an id (`#x`) and one
 * without, a text input, a select, a textarea, an image, a horizontal rule, a
 * checkbox, and two empty divs (`#hollow` with an id, `.bare` without).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Elements with and without ids, void elements, form controls and empty divs */
const DOM_GET_CONTEXT_HTML = `<!doctype html><title>dom get context</title>
<p id="x">Hello para</p>
<p class="anon">No id here</p>
<input id="q" type="text" name="q" value="typed">
<input id="agree" type="checkbox" name="agree">
<select id="pick" name="pick"><option>One</option><option>Two</option></select>
<textarea id="notes" name="notes"></textarea>
<img id="pic" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<hr id="rule">
<div id="hollow"></div>
<div class="bare"></div>`;

/** dom get context pages by path */
export const ROUTES: FixtureRoutes = {
  '/dom-get-context': DOM_GET_CONTEXT_HTML,
};
