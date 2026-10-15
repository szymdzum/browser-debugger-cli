/**
 * Fixture pages for elements a page adds by itself while an action is
 * watched (#750), served by the fixture server.
 *
 * - `/self-updating-stream`: `#steps` starts a chain appending `p "Step N"` to
 *   `#log` (below the buttons, so they do not move) every 50 ms for 5 s;
 *   `#note` appends `p "Note added"` to the same `#log` in its click handler. `#more` appends 5 `li` to `#items` at once,
 *   `#slow` 350 ms later; `#items` changes only then.
 * - `/self-updating-ticker`: a ticker appends a `p[role=status]` to
 *   `aside#ticker` every 50 ms from the load on (keeping the last 5). `#rows`
 *   appends 5 `p "row N"` near it, `#toggle` (`aria-expanded`) un-hides 4
 *   panels, `#noop` does nothing.
 * - `/self-updating-async`: a ticker appends a `p[role=status]` to `div#tk`
 *   every 50 ms (keeping the last 5); `#raf-busy` and `#timer-busy` append
 *   `p "Raf message N"` / `p "Timer message N"` to `#tk` from a
 *   `requestAnimationFrame` / `setTimeout(0)` callback, `#raf-quiet` and
 *   `#timer-quiet` the same to `div#quiet`, which nothing else changes.
 * - `/self-updating-nested`: a bot appends `li "Bot says N"` to `ul#msgs`
 *   (below the buttons) every 60 ms; `#focus-first` focuses `#in1` and then
 *   appends `li "Me hello"`, `#focus-between` appends `li "Me first"`,
 *   focuses `#in2` and appends `li "Me second"`, `#click-other` appends
 *   `li "Me before"`, clicks `#other` (which appends `li "Other said"`) and
 *   appends `li "Me after"`; `#noop` does nothing.
 * - `/self-updating-chat`: a bot appends `li "Bot says N"` to `ul#messages`
 *   (below the buttons, so they do not move) every 60 ms; `#send` appends `li "Me: hello"` to it in its click handler;
 *   `#noop` does nothing.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Buttons whose handlers add their result a frame or a task later, to a busy and to a quiet container */
const ASYNC_HTML = `<!doctype html><title>self-updating async</title>
<div><p><button id="raf-busy">Raf busy</button> <button id="timer-busy">Timer busy</button></p><div id="tk"></div></div>
<div><p><button id="raf-quiet">Raf quiet</button> <button id="timer-quiet">Timer quiet</button></p><div id="quiet"></div></div>
<script>
  let tick = 0;
  let sent = 0;
  const tk = document.getElementById('tk');
  setInterval(() => {
    tk.insertAdjacentHTML('beforeend', '<p role="status">tick ' + tick++ + '</p>');
    if (tk.children.length > 5) tk.querySelector('p[role=status]').remove();
  }, 50);
  const append = (id, text) => document.getElementById(id).insertAdjacentHTML('beforeend', '<p>' + text + ' ' + sent++ + '</p>');
  document.getElementById('raf-busy').onclick = () => requestAnimationFrame(() => append('tk', 'Raf message'));
  document.getElementById('timer-busy').onclick = () => setTimeout(() => append('tk', 'Timer message'), 0);
  document.getElementById('raf-quiet').onclick = () => requestAnimationFrame(() => append('quiet', 'Raf message'));
  document.getElementById('timer-quiet').onclick = () => setTimeout(() => append('quiet', 'Timer message'), 0);
</script>`;

/** Click handlers that fire events of their own (focus, another click) between their additions */
const NESTED_HTML = `<!doctype html><title>self-updating nested</title>
<section><p><input id="in1" aria-label="One"> <input id="in2" aria-label="Two"> <button id="focus-first">Focus first</button> <button id="focus-between">Focus between</button> <button id="click-other">Click other</button> <button id="other">Other</button> <button id="noop">Noop</button></p><ul id="msgs"></ul></section>
<script>
  const msgs = document.getElementById('msgs');
  const add = (text) => msgs.insertAdjacentHTML('beforeend', '<li>' + text + '</li>');
  let said = 0;
  setInterval(() => add('Bot says ' + said++), 60);
  document.getElementById('focus-first').onclick = () => {
    document.getElementById('in1').focus();
    add('Me hello');
  };
  document.getElementById('focus-between').onclick = () => {
    add('Me first');
    document.getElementById('in2').focus();
    add('Me second');
  };
  document.getElementById('other').onclick = () => add('Other said');
  document.getElementById('click-other').onclick = () => {
    add('Me before');
    document.getElementById('other').click();
    add('Me after');
  };
</script>`;

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
<section><p><button id="send">Send</button></p><ul id="messages"></ul></section>
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
  '/self-updating-async': ASYNC_HTML,
  '/self-updating-nested': NESTED_HTML,
};
