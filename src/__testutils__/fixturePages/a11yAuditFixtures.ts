/**
 * Fixture pages for `bdg dom audit a11y` (#455):
 * - `/a11y-audit-bad`: one of each failure (an image without alt, an unlabeled
 *   input, an icon-only button, two h1 and an h1 followed by an h4, no `main`,
 *   a duplicate id, an `aria-labelledby` naming no element), plus an unlabeled
 *   input in an open shadow root and an image without alt in an iframe.
 * - `/a11y-audit-good`: only correct variants (`alt=""`, `role="presentation"`,
 *   `aria-hidden`, hidden elements, controls named by `aria-label`,
 *   `aria-labelledby`, `<label for>`, a wrapping label and `title`, a hidden
 *   input, a button with text); every rule must report zero.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** One of each failure, no landmark */
const A11Y_BAD_HTML = `<!doctype html><title>a11y bad</title>
<h1>Title</h1>
<h1>Second title</h1>
<img id="pic" src="x.png">
<input id="plain" type="text">
<button id="icon"><svg width="10" height="10"></svg></button>
<h4>Skipped</h4>
<div id="dup">one</div>
<div id="dup">two</div>
<p id="ghosted" aria-labelledby="ghost">described by nothing</p>
<div id="host"></div>
<iframe srcdoc="<img id='framed' src='y.png'>"></iframe>
<script>document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<input id="shadowed" type="text"><button><svg width="10" height="10"></svg></button>';</script>`;

/** Only correct variants, all inside one landmark */
const A11Y_GOOD_HTML = `<!doctype html><title>a11y good</title>
<main>
<h1>Title</h1>
<h2>Section</h2>
<h3>Part</h3>
<img src="x.png" alt="">
<img src="x.png" role="presentation">
<img src="x.png" alt="A named picture">
<div aria-hidden="true"><button>x</button><img src="x.png"><input type="text"></div>
<input type="text" style="display:none">
<button hidden></button>
<input type="text" aria-label="Search">
<span id="name-source">Email</span>
<input type="text" aria-labelledby="name-source">
<label for="by-for">City</label><input id="by-for" type="text">
<label>Street <input type="text"></label>
<input type="text" title="Postcode">
<input type="hidden" name="token" value="abc">
<button>Save</button>
<a href="/somewhere">Read more</a>
<img src="/missing.png" alt="Logo">
<input type="text" placeholder="Search here">
<label for="pw">Password</label><input id="pw" type="password" value="hunter2">
</main>`;

/** a11y audit pages by path */
export const ROUTES: FixtureRoutes = {
  '/a11y-audit-bad': A11Y_BAD_HTML,
  '/a11y-audit-good': A11Y_GOOD_HTML,
};
