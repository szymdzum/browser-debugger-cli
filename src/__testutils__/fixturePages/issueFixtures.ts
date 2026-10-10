/**
 * Fixture pages for Chrome Issues, served by the fixture server: each makes
 * Chrome report exactly one issue bdg keeps. `/issues/quirks` has no
 * doctype; `/issues/label-for` has a label whose `for` matches no id;
 * `/issues/duplicate-ids` has two form fields with the same id;
 * `/issues/import` imports a stylesheet that is not found
 * ({@link ISSUE_MISSING_STYLESHEET}, answered 404); `/issues/csp-eval` calls
 * `eval` under a CSP without `unsafe-eval`; `/issues/clean` has none.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Stylesheet `/issues/import` imports, which the server answers with 404 */
export const ISSUE_MISSING_STYLESHEET = '/issues/missing.css';

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/issues/quirks': '<html><head><title>quirks</title></head><body><p>No doctype</p></body></html>',
  '/issues/label-for': `<!doctype html><title>label for</title>
<form onsubmit="event.preventDefault()">
<label for="missing">Nickname</label>
<label for="pet">Pet</label><input id="pet" name="pet">
<button>Save</button>
</form>`,
  '/issues/duplicate-ids': `<!doctype html><title>duplicate ids</title>
<form onsubmit="event.preventDefault()">
<label>First pet <input id="pet" name="first-pet"></label>
<label>Second pet <input id="pet" name="second-pet"></label>
<button>Save</button>
</form>`,
  '/issues/import': `<!doctype html><title>import</title>
<style>
@import url("${ISSUE_MISSING_STYLESHEET}");
body { color: #333; }
</style>
<p>Imports a missing stylesheet</p>`,
  '/issues/csp-eval': `<!doctype html><title>csp eval</title>
<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'">
<script>try { eval('1 + 1'); } catch (error) { window.evalBlocked = true; }</script>
<p>eval is blocked</p>`,
  '/issues/clean': '<!doctype html><title>clean</title><p>No issues</p>',
};
