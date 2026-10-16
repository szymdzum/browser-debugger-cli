/**
 * Fixture pages for regions a page updates on its own while an action runs
 * (#774), served by the fixture server. Each page counts its own updates in
 * `window.ticks`, so a test can wait until the page has visibly been
 * updating before it acts.
 *
 * - `/self-status-text`: `aside#t[role=status]` whose text is replaced with
 *   `tick N` every 50 ms; `#rows` appends 3 `<li>` to `ul#list`.
 * - `/self-status-live`: the same with `aria-live=polite` instead of the role.
 * - `/self-status-append`: the ticker appends a `<p>tick N</p>` to the
 *   `role=status` aside every 50 ms (keeping the last 5); `#rows` as above.
 * - `/self-status-nested`: `div#st[role=status]` holding `span#clock` whose
 *   text is replaced with `tick N` every 50 ms; `#rows` as above.
 * - `/self-status-box`: `div#box[role=status]` holding `span#clk`, whose
 *   number ticks every 100 ms, and an empty `span#res`; `#place` sets
 *   `#res` to "Order placed" (the click's own message next to a ticker).
 * - `/self-status-replace`: `div#box[role=status]` whose ticker replaces its
 *   number `<span>` with a new one every 50 ms; `#go` appends
 *   `<span> Saved!</span>` to the box.
 * - `/self-status-stream`: the same box; `#go` appends ten `<span>` parts
 *   ` part 1` … ` part 10` to it, 100 ms apart.
 * - `/self-status-toast`: `#save` shows "Saved" in `div#s[role=status]` 300 ms
 *   after the click; nothing updates on its own.
 * - `/self-status-flash`: submitting `form#f` (`#go`) renders a `.flash`
 *   `role=alert` "Invalid email" without a navigation.
 * - `/self-status-more`: `#more` appends 3 chunks of 10 results 150 ms apart
 *   and updates `p#st[role=status]` "Showing N of 90".
 * - `/self-status-slow`: `#load` fetches `/api/delayed` and writes the answer
 *   into `div#live[aria-live]`.
 * - `/self-status-cart`: `span#cart[role=status]` re-rendered with the same
 *   "3 items" every 100 ms (a poll), `#add` makes it "4 items".
 * - `/self-status-list`: `ul#list` re-rendered with 60 random numbers every
 *   100 ms; `#noop` has no handler.
 * - `/self-status-app`: a framework-style app whose `div#view` is
 *   re-rendered with `innerHTML` every 100 ms and on each input of `input#f`
 *   (kept in place, outside the view);
 *   a value over 5 characters renders `p#err[role=alert]` "Too long".
 * - `/self-status-search`: a `<search>` box (`#go` appends a suggestion to
 *   its `ul#sugg`) inside a `section` where the same click also adds a
 *   "Promo banner" paragraph outside the search box.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/**
 * A page from its body and script.
 *
 * @param title - Page title
 * @param body - Body HTML
 * @param script - Script run at the end of the body
 * @returns HTML page
 */
function page(title: string, body: string, script: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<main>${body}</main>
<script>window.ticks = 0;
${script}</script>`;
}

/** Body of the ticker pages: the ticker, then the button that adds rows */
const TICKER_BODY = (aside: string): string =>
  `${aside}<section><div><button id="rows">Add rows</button></div><ul id="list"></ul></section>`;

/** `#rows` appends three rows to `ul#list` */
const ADD_ROWS = `document.getElementById('rows').addEventListener('click', () => {
  const list = document.getElementById('list');
  for (let i = 0; i < 3; i++) {
    const li = document.createElement('li');
    li.textContent = 'row ' + list.children.length;
    list.append(li);
  }
});`;

/** Replaces the aside's text every 50 ms */
const TEXT_TICKER = `setInterval(() => { document.getElementById('t').textContent = 'tick ' + (++window.ticks); }, 50);`;

/** A status box whose first child is a ticking number `<span>`, and a button */
const REPLACING_BOX =
  '<div id="box" role="status"><span>0</span></div><section><div><button id="go">Go</button></div></section>';

/** Replaces the box's number `<span>` with a new one every 50 ms */
const REPLACING_TICKER = `setInterval(() => {
  const span = document.createElement('span');
  span.textContent = String(++window.ticks);
  document.getElementById('box').firstElementChild.replaceWith(span);
}, 50);`;

export const ROUTES: FixtureRoutes = {
  '/self-status-text': page(
    'status text ticker',
    TICKER_BODY('<aside id="t" role="status">tick 0</aside>'),
    `${TEXT_TICKER}\n${ADD_ROWS}`
  ),
  '/self-status-live': page(
    'live text ticker',
    TICKER_BODY('<aside id="t" aria-live="polite">tick 0</aside>'),
    `${TEXT_TICKER}\n${ADD_ROWS}`
  ),
  '/self-status-append': page(
    'status append ticker',
    TICKER_BODY('<aside id="t" role="status"></aside>'),
    `setInterval(() => {
  const t = document.getElementById('t');
  const p = document.createElement('p');
  p.textContent = 'tick ' + (++window.ticks);
  t.append(p);
  if (t.children.length > 5) t.firstElementChild.remove();
}, 50);
${ADD_ROWS}`
  ),
  '/self-status-nested': page(
    'nested status ticker',
    TICKER_BODY('<div id="st" role="status">Now: <span id="clock">tick 0</span></div>'),
    `setInterval(() => { document.getElementById('clock').textContent = 'tick ' + (++window.ticks); }, 50);
${ADD_ROWS}`
  ),
  '/self-status-box': page(
    'message next to a ticker',
    '<div id="box" role="status"><span id="clk">0</span> <span id="res"></span></div><section><div><button id="place">Place order</button></div></section>',
    `setInterval(() => { document.getElementById('clk').textContent = String(++window.ticks); }, 100);
document.getElementById('place').addEventListener('click', () => {
  document.getElementById('res').textContent = 'Order placed';
});`
  ),
  '/self-status-replace': page(
    'ticker replacing its span',
    REPLACING_BOX,
    `${REPLACING_TICKER}
document.getElementById('go').addEventListener('click', () => {
  const saved = document.createElement('span');
  saved.textContent = ' Saved!';
  document.getElementById('box').append(saved);
});`
  ),
  '/self-status-stream': page(
    'result streamed next to a ticker',
    REPLACING_BOX,
    `${REPLACING_TICKER}
document.getElementById('go').addEventListener('click', () => {
  let part = 0;
  const next = () => {
    const span = document.createElement('span');
    span.textContent = ' part ' + (++part);
    document.getElementById('box').append(span);
    if (part < 10) setTimeout(next, 100);
  };
  next();
});`
  ),
  '/self-status-toast': page(
    'toast',
    '<section><div><button id="save">Save</button></div></section><div id="s" role="status"></div>',
    `window.ticks = 3;
document.getElementById('save').addEventListener('click', () => {
  setTimeout(() => { document.getElementById('s').textContent = 'Saved'; }, 300);
});`
  ),
  '/self-status-flash': page(
    'flash',
    '<form id="f"><input name="email" value="x" aria-label="Email"><button id="go">Send</button></form><div id="out"></div>',
    `window.ticks = 3;
document.getElementById('f').addEventListener('submit', (event) => {
  event.preventDefault();
  const flash = document.createElement('div');
  flash.className = 'flash';
  flash.setAttribute('role', 'alert');
  flash.textContent = 'Invalid email';
  document.getElementById('out').append(flash);
});`
  ),
  '/self-status-more': page(
    'load more',
    '<section><ul id="results"></ul><div><button id="more">Load more</button></div><p id="st" role="status">Showing 0 of 90</p></section>',
    `window.ticks = 3;
let count = 0;
document.getElementById('more').addEventListener('click', () => {
  let chunks = 0;
  const chunk = () => {
    const results = document.getElementById('results');
    for (let i = 0; i < 10; i++) {
      const li = document.createElement('li');
      li.textContent = 'result ' + (++count);
      results.append(li);
    }
    document.getElementById('st').textContent = 'Showing ' + count + ' of 90';
    if (++chunks < 3) setTimeout(chunk, 150);
  };
  setTimeout(chunk, 150);
});`
  ),
  '/self-status-slow': page(
    'slow response',
    '<section><div><button id="load">Load</button></div></section><div id="live" aria-live="polite"></div>',
    `window.ticks = 3;
document.getElementById('load').addEventListener('click', async () => {
  const response = await fetch('/api/delayed');
  document.getElementById('live').textContent = 'Result: ' + response.status;
});`
  ),
  '/self-status-cart': page(
    'cart badge',
    '<header><span id="cart" role="status"><b>3 items</b></span></header><section><div><button id="add">Add to cart</button></div></section>',
    `let items = 3;
const render = () => {
  const b = document.createElement('b');
  b.textContent = items + ' items';
  document.getElementById('cart').replaceChildren(b);
};
setInterval(() => { render(); window.ticks++; }, 100);
document.getElementById('add').addEventListener('click', () => { items++; render(); });`
  ),
  '/self-status-list': page(
    'self-updating list',
    '<section><div><button id="noop">Nothing</button></div><ul id="list"></ul></section>',
    `setInterval(() => {
  const list = document.getElementById('list');
  list.innerHTML = '';
  for (let i = 0; i < 60; i++) {
    const li = document.createElement('li');
    li.textContent = (Math.random() * 200).toFixed(1);
    list.append(li);
  }
  window.ticks++;
}, 100);`
  ),
  '/self-status-app': page(
    'framework root',
    '<div id="app"><input id="f" aria-label="Name"><div id="view"></div></div>',
    `const render = () => {
  const value = document.getElementById('f').value;
  document.getElementById('view').innerHTML =
    value.length > 5 ? '<p id="err" role="alert">Too long</p>' : '<p>Name</p>';
};
setInterval(() => { render(); window.ticks++; }, 100);
document.getElementById('f').addEventListener('input', render);`
  ),
  '/self-status-search': page(
    'search element',
    '<section><p>Find</p><search><input id="q" value="ab" aria-label="Query"><button id="go">Go</button><ul id="sugg"></ul></search><div id="promo"></div></section>',
    `window.ticks = 3;
document.getElementById('go').addEventListener('click', () => {
  const li = document.createElement('li');
  li.textContent = 'suggestion ab';
  document.getElementById('sugg').append(li);
  const p = document.createElement('p');
  p.textContent = 'Promo banner';
  document.getElementById('promo').append(p);
});`
  ),
};
