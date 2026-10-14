/**
 * Fixture pages for what an action's `Shown:` lists (#750), served by the
 * fixture server. For an earlier action's timers see `/effects` (`#steps`
 * adds 20 paragraphs 50 ms apart to `#results`, `#toast` adds a toast there).
 *
 * - `/shown-disclosure`: `#near-toggle` (`aria-expanded`) un-hides `#near-menu`
 *   (a `ul` beside it) and `#far-toggle` un-hides `#far-panel` (named by its
 *   `aria-controls`, at the end of the page); neither adds a node. `#plain`
 *   un-hides `#plain-note` and has no `aria-expanded`.
 * - `/shown-shadow`: `#open-dialog` opens a `<dialog>` with a heading and a
 *   search field in the open shadow root of `x-dialog`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Disclosure buttons that only toggle `hidden` */
const SHOWN_DISCLOSURE_HTML = `<!doctype html><title>shown disclosure</title>
<header><div class="bar"><button id="near-toggle" aria-expanded="false" aria-controls="near-menu">Menu</button><ul id="near-menu" hidden><li>Pricing</li><li>Careers</li></ul></div></header>
<main>
<p><button id="far-toggle" aria-expanded="false" aria-controls="far-panel">Shipping</button></p>
<p><button id="plain">Note</button><span id="plain-note" hidden>Plain note</span></p>
</main>
<footer><div><section><div id="far-panel" hidden>Ships within 3 days</div></section></div></footer>
<script>
  for (const id of ['near-toggle', 'far-toggle']) {
    const button = document.getElementById(id);
    button.addEventListener('click', () => {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
    });
  }
  document.getElementById('plain').addEventListener('click', () => {
    document.getElementById('plain-note').hidden = false;
  });
</script>`;

/** A dialog rendered inside an open shadow root */
const SHOWN_SHADOW_HTML = `<!doctype html><title>shown shadow</title>
<main>
<button id="open-dialog">Open search</button>
<x-dialog></x-dialog>
</main>
<script>
  customElements.define('x-dialog', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
    }
    open() {
      this.shadowRoot.innerHTML = '<dialog open><h2>Search the site</h2><input type="search" aria-label="Search"></dialog>';
    }
  });
  document.getElementById('open-dialog').addEventListener('click', () => document.querySelector('x-dialog').open());
</script>`;

export const ROUTES: FixtureRoutes = {
  '/shown-disclosure': SHOWN_DISCLOSURE_HTML,
  '/shown-shadow': SHOWN_SHADOW_HTML,
};
