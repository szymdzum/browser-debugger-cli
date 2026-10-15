/**
 * Fixture pages for elements a page adds by itself while an action is
 * watched (#750), served by the fixture server.
 *
 * - `/self-updating-stream`: `#steps` starts a chain appending `p "Step N"` to
 *   `#log` (below the buttons, so they do not move) every 50 ms for 5 s; `#note` appends `p "Note added"` to the same
 *   `#log` in its click handler. `#more` appends 5 `li` to `#items` at once,
 *   `#slow` 350 ms later; `#items` changes only then.
 * - `/self-updating-ticker`: a ticker appends a `p[role=status]` to
 *   `aside#ticker` every 50 ms from the load on (keeping the last 5). `#rows`
 *   appends 5 `p "row N"` near it, `#toggle` (`aria-expanded`) un-hides 4
 *   panels, `#noop` does nothing.
 * - `/self-updating-chat`: a bot appends `li "Bot says N"` to `ul#messages`
 *   every 60 ms; `#send` appends `li "Me: hello"` to it in its click handler;
 *   `#noop` does nothing.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A container a timer chain and a click both append to, and a list only clicks change */
const STREAM_HTML = `<!doctype html><title>self-updating stream</title>
<section><p><button id="steps">Steps</button> <button id="note">Note</button></p><div id="log"></div></section>
<section><ul id="items"><li>Item 0</li></ul><p><button id="more">Load more</button> <button id="slow">Load more slowly</button></p></section>
<script>
  const log = document.getElementById('log');
  const append = (text) => log.insertAdjacentHTML('beforeend', '<p>' + text + '</p>');
  document.getElementById('steps').onclick = () => {
    let step = 0;
    const next = () => { append('Step ' + step); if (++step < 100) setTimeout(next, 50); };
    next();
  };
  document.getElementById('note').onclick = () => append('Note added');
  let item = 1;
  const addItems = () => {
    for (let i = 0; i < 5; i++) document.getElementById('items').insertAdjacentHTML('beforeend', '<li>Item ' + item++ + '</li>');
  };
  document.getElementById('more').onclick = addItems;
  document.getElementById('slow').onclick = () => setTimeout(addItems, 350);
</script>`;

/** A page-wide status ticker beside controls that add rows or reveal panels */
const TICKER_HTML = `<!doctype html><title>self-updating ticker</title>
<div><div><button id="rows">Add rows</button><div id="table"></div></div></div>
<div><button id="toggle" aria-expanded="false" aria-controls="panels">Show panels</button><div id="panels" hidden><p>Panel A</p><p>Panel B</p><p>Panel C</p><p>Panel D</p></div></div>
<p><button id="noop">Noop</button></p>
<aside id="ticker"></aside>
<script>
  let tick = 0;
  setInterval(() => {
    const ticker = document.getElementById('ticker');
    ticker.insertAdjacentHTML('beforeend', '<p role="status">tick ' + tick++ + '</p>');
    if (ticker.children.length > 5) ticker.firstElementChild.remove();
  }, 50);
  document.getElementById('rows').onclick = () => {
    for (let i = 0; i < 5; i++) document.getElementById('table').insertAdjacentHTML('beforeend', '<p>row ' + i + '</p>');
  };
  const toggle = document.getElementById('toggle');
  toggle.onclick = () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    document.getElementById('panels').hidden = !open;
  };
</script>`;

/** A chat log a bot writes to, and a send button writing to it too */
const CHAT_HTML = `<!doctype html><title>self-updating chat</title>
<section><ul id="messages"></ul><p><button id="send">Send</button></p></section>
<p><button id="noop">Noop</button></p>
<script>
  const messages = document.getElementById('messages');
  let said = 0;
  setInterval(() => messages.insertAdjacentHTML('beforeend', '<li>Bot says ' + said++ + '</li>'), 60);
  document.getElementById('send').onclick = () => messages.insertAdjacentHTML('beforeend', '<li>Me: hello</li>');
</script>`;

/** Self-updating pages by path */
export const ROUTES: FixtureRoutes = {
  '/self-updating-stream': STREAM_HTML,
  '/self-updating-ticker': TICKER_HTML,
  '/self-updating-chat': CHAT_HTML,
};
