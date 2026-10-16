/**
 * Fixture pages for what `New text:` reports after a navigation (#459),
 * served by the fixture server.
 *
 * - `/footer-a`: `#next` links to `/footer-b`, `#cookie` to `/footer-cookie`.
 * - `/footer-b`: static page whose footer, below the first viewport, holds
 *   `h2#feedback` ("Help improve the docs"), a `div.invalid-feedback` ("Tell
 *   us what you think") and a `section` labelled by `h3#related-title`
 *   ("Related pages").
 * - `/footer-cookie`: an `h2#feedback` in view and a cookie banner `div.notice` fixed to the bottom of the
 *   first viewport.
 * - `/footer-field`: `#check` shows `div.invalid-feedback` ("Name is
 *   required") beside the `#name` field on the same page.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Page that links to the pages below */
const FOOTER_A_HTML = `<!doctype html><title>footer a</title>
<main><h1>Start</h1><a id="next" href="/footer-b">Docs</a> <a id="cookie" href="/footer-cookie">Cookies</a></main>`;

/** Static page with headings and a feedback block far below the first viewport */
const FOOTER_B_HTML = `<!doctype html><title>footer b</title>
<main><h1>Docs</h1><div style="height:4000px">Long article</div></main>
<footer>
<section><h2 id="feedback">Help improve the docs</h2><div class="invalid-feedback">Tell us what you think</div></section>
<section aria-labelledby="related-title"><h3 id="related-title">Related pages</h3><ul><li>One</li></ul></section>
</footer>`;

/** Page with a cookie banner fixed to the bottom of the viewport */
const FOOTER_COOKIE_HTML = `<!doctype html><title>footer cookie</title>
<main><h1>Cookies</h1><h2 id="feedback">Feedback</h2><p>Page text</p></main>
<div class="notice" style="position:fixed;bottom:0;left:0;right:0;background:#eee">We use cookies</div>`;

/** Same-page validation message shown by a click */
const FOOTER_FIELD_HTML = `<!doctype html><title>footer field</title>
<main><label>Name <input id="name"></label><div class="invalid-feedback" id="msg" hidden>Name is required</div>
<button id="check">Check</button></main>
<script>document.getElementById('check').addEventListener('click', () => { document.getElementById('msg').hidden = false; });</script>`;

export const ROUTES: FixtureRoutes = {
  '/footer-a': FOOTER_A_HTML,
  '/footer-b': FOOTER_B_HTML,
  '/footer-cookie': FOOTER_COOKIE_HTML,
  '/footer-field': FOOTER_FIELD_HTML,
};
