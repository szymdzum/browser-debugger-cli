/**
 * Fixture page for the selector in action results for an index (#630), served
 * by the fixture server: `/index-selector` has `#with-id` ("WithId"), two
 * identical rows (`data-row` 1 and 2) of an id-less button ("Plain", so only a
 * path tells them apart), `InWrap` and `Sibling` in `div#wrap`, `Shadowed` in a `<p>` of an open shadow root (`<x-open>`), `Ambiguous` in a
 * `<div>` of one (`<x-ambiguous>`; the same `div > button` path as a row's
 * button), and `Framed` in an iframe. Every click is noted in `window.clicks` as `row<n>:<text>` (rows) or the button text.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Buttons with an id, without one (twice), in an open shadow root and in a frame */
const INDEX_SELECTOR_HTML = `<!doctype html><title>index selector</title>
<button id="with-id" type="button">WithId</button>
<section><div class="row" data-row="1"><button type="button">Plain</button></div><div class="row" data-row="2"><button type="button">Plain</button></div></section>
<div id="wrap"><button type="button">InWrap</button><button type="button">Sibling</button></div>
<x-open></x-open>
<x-ambiguous></x-ambiguous>
<iframe srcdoc="<button type=button>Framed</button>"></iframe>
<script>
  window.clicks = [];
  const define = (name, html) => customElements.define(name, class extends HTMLElement {
    connectedCallback() { this.attachShadow({ mode: 'open' }).innerHTML = html; }
  });
  define('x-open', '<p><button type="button">Shadowed</button></p>');
  define('x-ambiguous', '<div><button type="button">Ambiguous</button></div>');
  document.addEventListener('click', (e) => { const row = e.target.closest('[data-row]'); window.clicks.push((row ? 'row' + row.dataset.row + ':' : '') + e.target.textContent); }, true);
</script>`;

/** Index selector pages by path */
export const ROUTES: FixtureRoutes = {
  '/index-selector': INDEX_SELECTOR_HTML,
};
