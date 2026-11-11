/**
 * Fixture pages for the 1.0 names of DOM action `--json` fields (#844),
 * served by the fixture server. `/field-names` has `#many-requests`, a
 * button whose click starts 60 fetches to `/field-names-ping?n=<n>` (more
 * than the 50 an action lists, so the rest are counted), a form
 * `#blocked-form` with six empty required fields and submit button
 * `#blocked-submit` (more than the 5 blocked fields an action names), and a
 * GET form `#nav-form` that goes to `/field-names-done`, a plain page.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Six empty required fields */
const REQUIRED_FIELDS = Array.from(
  { length: 6 },
  (_, n) => `<input name="f${n}" required>`
).join('\n    ');

/** A request burst, a form blocked by six fields and a navigating form */
const FIELD_NAMES_HTML = `<!doctype html><title>field names</title>
<button id="many-requests">Many</button>
<form id="blocked-form">
    ${REQUIRED_FIELDS}
    <button id="blocked-submit">Send</button>
</form>
<form id="nav-form" action="/field-names-done">
    <input name="q" value="x">
    <button>Go</button>
</form>
<script>
  document.getElementById('many-requests').addEventListener('click', () => {
    for (let n = 0; n < 60; n++) fetch('/field-names-ping?n=' + n).catch(() => {});
  });
</script>`;

/** The page the navigating form goes to */
const FIELD_NAMES_DONE_HTML = '<!doctype html><title>done</title><p>done</p>';

export const ROUTES: FixtureRoutes = {
  '/field-names': FIELD_NAMES_HTML,
  '/field-names-done': FIELD_NAMES_DONE_HTML,
};
