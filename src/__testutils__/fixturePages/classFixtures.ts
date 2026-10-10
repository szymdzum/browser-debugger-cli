/**
 * Fixture page for the class lists bdg reports, served by the fixture
 * server: `/classes` has an input without a class attribute (`#plain`), a
 * paragraph with an empty one (`#empty`), a paragraph with a blank one
 * (`#blank`) and a button with two classes (`#styled`).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Elements with no, empty, blank and two classes */
const CLASSES_HTML = `<!doctype html><title>classes</title>
<input id="plain" name="plain">
<p id="empty" class="">Empty class</p>
<p id="blank" class="   ">Blank class</p>
<button id="styled" class="primary  large">Save</button>`;

/** Class list pages by path */
export const ROUTES: FixtureRoutes = {
  '/classes': CLASSES_HTML,
};
