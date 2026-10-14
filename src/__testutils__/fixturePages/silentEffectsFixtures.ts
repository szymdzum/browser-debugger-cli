/**
 * Fixture pages for the effects of an action that were silent (#670), served
 * by the fixture server. `/silent-effects` has: `#expander` (a button whose
 * `aria-expanded` flips and which inserts or removes a `Close menu` button, as
 * bbc.com's menu does) with an icon `span` inside it (`#expander-icon`);
 * `#mover`, whose `input` handler moves focus to `#other`; `#counted`, whose
 * `input` handler echoes its value in `#count` next to it (focus stays);
 * `#disclosure`, which only toggles `hidden` on `#panel`; `#plain-hover`, a
 * button with a CSS-only `:hover` style; `#fetch-append`, which fetches the
 * page and appends 5 `<u>` elements (a request is reported, so no DOM change
 * line); and `#noop`, a button with no handler.
 * `/silent-effects-busy` re-renders a list of 60 items every 100 ms from the
 * load on, whatever the user does; it has `#noop` too. For the hover that
 * removes 200 elements see `/effects` (`#shift-target`), and for a release
 * on another element `/press-check` (`#gone-mousedown`).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A menu button, two fields whose handlers act, and controls that change nothing visible */
const SILENT_EFFECTS_HTML = `<!doctype html><title>silent effects</title>
<style>#plain-hover:hover { color: red; background: #eee }</style>
<nav id="bar"><button id="expander" aria-expanded="false"><span id="expander-icon">Open menu</span></button></nav>
<p><input id="mover" aria-label="Mover"> <input id="other" aria-label="Other"></p>
<p><input id="counted" aria-label="Counted"> <span id="count">0</span></p>
<p><button id="disclosure">Details</button><span id="panel" hidden>More details</span></p>
<p><button id="plain-hover">Plain hover</button> <button id="noop">Noop</button> <button id="fetch-append">Fetch</button></p>
<script>
  const expander = document.getElementById('expander');
  expander.addEventListener('click', () => {
    const open = expander.getAttribute('aria-expanded') !== 'true';
    expander.setAttribute('aria-expanded', String(open));
    const existing = document.getElementById('close-menu');
    if (open && !existing) {
      const close = document.createElement('button');
      close.id = 'close-menu';
      close.setAttribute('aria-label', 'Close menu');
      document.getElementById('bar').append(close);
    } else if (!open && existing) existing.remove();
  });
  document.getElementById('fetch-append').addEventListener('click', () => {
    fetch('/silent-effects');
    document.body.insertAdjacentHTML('beforeend', '<u>a</u><u>b</u><u>c</u><u>d</u><u>e</u>');
  });
  document.getElementById('mover').addEventListener('input', () => document.getElementById('other').focus());
  document.getElementById('counted').addEventListener('input', (event) => {
    document.getElementById('count').textContent = String(event.target.value.length);
  });
  document.getElementById('disclosure').addEventListener('click', () => {
    const panel = document.getElementById('panel');
    panel.hidden = !panel.hidden;
  });
</script>`;

/** A page that re-renders a big list on a timer, and a button that does nothing */
const SILENT_EFFECTS_BUSY_HTML = `<!doctype html><title>silent effects busy</title>
<button id="noop">Noop</button>
<ul id="list"></ul>
<script>
  let round = 0;
  setInterval(() => {
    round++;
    document.getElementById('list').innerHTML = Array.from({ length: 60 }, (_, i) => '<li>' + round + '.' + i + '</li>').join('');
  }, 100);
</script>`;

/** Silent-effects pages by path */
export const ROUTES: FixtureRoutes = {
  '/silent-effects': SILENT_EFFECTS_HTML,
  '/silent-effects-busy': SILENT_EFFECTS_BUSY_HTML,
};
