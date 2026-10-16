/**
 * Fixture page for the action output rows of tracker errors and of index
 * targets (#694), served by the fixture server: `/tracker-rows` has
 * `#trk`, whose handler logs two errors from a script that claims to be
 * Google Tag Manager (a first stack frame on a filtered tracker host, so
 * the errors are hidden and only counted), `#mixed`, which logs one page
 * error and one tracker error, and a custom element in `div#nav` wrapping a class-only button
 * ("Menu", so its selector is a path from an ancestor's id), and three buttons without an id
 * (`button.b`: "Save", "Cancel", "Delete") that only a path tells apart.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Page with tracker-error buttons and id-less buttons */
const TRACKER_ERRORS_HTML = `<!doctype html><title>tracker errors</title>
<button id="trk" type="button">Track</button>
<button id="mixed" type="button">Mixed</button>
<div id="nav"><x-dd><button class="tab" type="button">Menu</button></x-dd></div>
<div><button class="b" type="button">Save</button><button class="b" type="button">Cancel</button><button class="b" type="button">Delete</button></div>
<script>
  const fromTracker = (text) => new Function("console.error(" + JSON.stringify(text) + ");\\n//# sourceURL=https://www.googletagmanager.com/gtm.js")();
  document.getElementById('trk').onclick = () => { fromTracker('tag one'); fromTracker('tag two'); };
  document.getElementById('mixed').onclick = () => { console.error('app failed'); fromTracker('tag one'); };
</script>`;

/** Tracker error pages by path */
export const ROUTES: FixtureRoutes = {
  '/tracker-rows': TRACKER_ERRORS_HTML,
};
