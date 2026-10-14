/**
 * Fixture pages for clicking elements that have no `click()` method (#692),
 * served by the fixture server: `/svg-click` has an SVG with two empty
 * `<g role="button">` groups (zero size, so the mouse cannot reach them;
 * `aria-label` "c25x" and "other") and a listener on the SVG that appends the
 * event type and the clicked label to `window.__events`. `/svg-click-box` has
 * the same group with a `<rect>` child, so the mouse reaches it.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Script recording the events the SVG sees */
const RECORD_SCRIPT = `<script>
window.__events = [];
for (const type of ['click', 'dblclick']) {
  document.querySelector('svg').addEventListener(type, (event) => {
    window.__events.push(type + ':' + event.target.getAttribute('aria-label') + ':' + event.constructor.name);
  });
}
</script>`;

/** Zero-size groups: the DOM fallback handles the click */
const SVG_CLICK_HTML = `<!doctype html><title>svg click</title>
<svg width="100" height="100"><g role="button" aria-label="c25x"></g><g role="button" aria-label="other"></g></svg>
${RECORD_SCRIPT}`;

/** A group with a box: the mouse reaches it */
const SVG_CLICK_BOX_HTML = `<!doctype html><title>svg click box</title>
<svg width="100" height="100"><g role="button" aria-label="c25x"><rect width="50" height="50" fill="red"></rect></g></svg>
${RECORD_SCRIPT}`;

/** SVG click pages by path */
export const ROUTES: FixtureRoutes = {
  '/svg-click': SVG_CLICK_HTML,
  '/svg-click-box': SVG_CLICK_BOX_HTML,
};
