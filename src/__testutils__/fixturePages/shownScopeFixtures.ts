/**
 * Fixture pages for what an action's `Shown:` lists (#750), served by the
 * fixture server. For an earlier action's timers see `/effects` (`#steps`
 * adds 20 paragraphs 50 ms apart to `#results`, `#toast` adds a toast there).
 *
 * - `/shown-disclosure`: `#near-toggle` (`aria-expanded`) un-hides `#near-menu`
 *   (a `ul` beside it) and `#far-toggle` un-hides `#far-panel` (named by its
 *   `aria-controls`, at the end of the page); neither adds a node. `#plain`
 *   un-hides `#plain-note` and has no `aria-expanded`.
 * - `/shown-repeat`: actions that add or replace content, clicked repeatedly:
 *   `#more` appends 4 `li.item` at once, `#more-slow` appends 4 `li.slow` 60 ms
 *   apart, `#search` replaces the 3 `div.row` of `#res` with new ones
 *   (`Result N.1`..`N.3`, N counting the clicks), `#add` appends a `li.todo`.
 * - `/shown-quiet`: pages doing things by themselves next to buttons that do
 *   nothing: `#ticker-btn` (a `p` appended to its parent every 50 ms),
 *   `#clock-btn` (an `x-clock` rewriting its shadow root every 50 ms),
 *   `#car-btn` (`aria-expanded`, with a carousel advancing after it). The
 *   ticker is only known as one to bdg once the page has been acted on, so its
 *   button is clicked last.
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

/** Content added or replaced by clicks, repeatedly */
const SHOWN_REPEAT_HTML = `<!doctype html><title>shown repeat</title>
<div><button id="more">More</button><ul id="list"></ul></div>
<div><button id="more-slow">More slow</button><ul id="slow"></ul></div>
<div><button id="search">Search</button><div id="res"><div class="row">Old 1</div><div class="row">Old 2</div><div class="row">Old 3</div></div></div>
<div><button id="add">Add</button><ul id="todos"></ul></div>
<script>
  let rows = 0, searches = 0, todos = 0;
  document.getElementById('more').addEventListener('click', () => {
    const list = document.getElementById('list');
    for (let i = 0; i < 4; i++) list.insertAdjacentHTML('beforeend', '<li class="item">Row ' + ++rows + '</li>');
  });
  document.getElementById('more-slow').addEventListener('click', () => {
    let left = 4;
    const timer = setInterval(() => {
      document.getElementById('slow').insertAdjacentHTML('beforeend', '<li class="slow">Slow ' + ++rows + '</li>');
      if (--left === 0) clearInterval(timer);
    }, 60);
  });
  document.getElementById('search').addEventListener('click', () => {
    searches++;
    document.getElementById('res').innerHTML = [1, 2, 3].map((i) => '<div class="row">Result ' + searches + '.' + i + '</div>').join('');
  });
  document.getElementById('add').addEventListener('click', () => {
    document.getElementById('todos').insertAdjacentHTML('beforeend', '<li class="todo">Todo ' + ++todos + '</li>');
  });
</script>`;

/** Pages changing by themselves beside buttons that do nothing */
const SHOWN_QUIET_HTML = `<!doctype html><title>shown quiet</title>
<div id="t"><button id="ticker-btn">Plain</button></div>
<div id="c"><button id="clock-btn">Plain</button><x-clock></x-clock></div>
<div id="k"><button id="car-btn" aria-expanded="false">More</button><div><p class="s">Slide 1</p><p class="s" hidden>Slide 2</p><p class="s" hidden>Slide 3</p></div></div>
<script>
  let n = 0, cur = 0;
  setInterval(() => document.getElementById('t').insertAdjacentHTML('beforeend', '<p>tick ' + n++ + '</p>'), 50);
  setInterval(() => document.querySelectorAll('.s').forEach((slide, i) => { slide.hidden = i !== cur % 3; cur += i === 2 ? 1 : 0; }), 100);
  customElements.define('x-clock', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      setInterval(() => { this.shadowRoot.innerHTML = '<span>Time ' + (Date.now() % 10000) + '</span>'; }, 50);
    }
  });
</script>`;

export const ROUTES: FixtureRoutes = {
  '/shown-disclosure': SHOWN_DISCLOSURE_HTML,
  '/shown-shadow': SHOWN_SHADOW_HTML,
  '/shown-repeat': SHOWN_REPEAT_HTML,
  '/shown-quiet': SHOWN_QUIET_HTML,
};
