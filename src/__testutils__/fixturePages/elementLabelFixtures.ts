/**
 * Fixture page for how action output names an element (#740), served by the
 * fixture server: `/element-labels` has an icon-only button with an
 * `aria-label` inside a header with text, a button named by
 * `aria-labelledby`, a button with only a `title`, an image-only button
 * whose image has alt text, a button with visible text, a checkbox with no
 * name of its own inside a paragraph with text, and two identical
 * `aria-label` buttons. None of the elements has an id, so each is named by
 * its classes, name and context.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Elements with and without a name of their own, inside text containers */
const ELEMENT_LABELS_HTML = `<!doctype html><meta charset="utf-8"><title>element labels</title>
<div class="hdr"><button class="menu" aria-label="Open menu"></button> <a href="#r">Register</a> <a href="#s">Sign In</a></div>
<div class="cfg"><span id="settings-name">Settings name</span><button class="settings" aria-labelledby="settings-name"></button></div>
<div class="bar">Toolbar <button class="print" title="Print"></button></div>
<div class="tools">Tools <button class="download"><img alt="Download" width="8" height="8" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="></button></div>
<div class="plain"><button class="save">Save</button></div>
<p class="note">Remember me <input type="checkbox" class="remember"></p>
<div class="pair"><button class="share" aria-label="Share"></button><button class="share" aria-label="Share"></button></div>`;

/** Element label pages by path */
export const ROUTES: FixtureRoutes = {
  '/element-labels': ELEMENT_LABELS_HTML,
};
