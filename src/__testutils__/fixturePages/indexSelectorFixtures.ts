/**
 * Fixture page for the selector in action results for an index (#630), served
 * by the fixture server: `/index-selector` has `#with-id` ("WithId"), two
 * identical rows of an id-less button ("Plain", so only a path tells them
 * apart), a `Plain` button in an open shadow root (`<x-open>`), and one in an
 * iframe. Every button notes its click in `window.clicks`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Buttons with an id, without one (twice), in an open shadow root and in a frame */
const INDEX_SELECTOR_HTML = `<!doctype html><title>index selector</title>
<button id="with-id" type="button">WithId</button>
<section><div class="row"><button type="button">Plain</button></div><div class="row"><button type="button">Plain</button></div></section>
<x-open></x-open>
<iframe srcdoc="<button type=button>Framed</button>"></iframe>
<script>
  window.clicks = [];
  customElements.define('x-open', class extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: 'open' }).innerHTML = '<div><button type="button">Shadowed</button></div>';
    }
  });
  document.addEventListener('click', (e) => window.clicks.push(e.target.textContent), true);
</script>`;

/** Index selector pages by path */
export const ROUTES: FixtureRoutes = {
  '/index-selector': INDEX_SELECTOR_HTML,
};
