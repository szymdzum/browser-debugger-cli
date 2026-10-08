/**
 * Local fixture HTTP server and free-port helpers for smoke tests.
 *
 * Serves `src/__tests__/fixtures/index.html` plus a small JSON endpoint so smoke
 * tests never depend on the public internet. `/slow` delays its response so a
 * session start can be interrupted while the page is loading (and a click can
 * start a slow navigation), `/api/delayed` answers after 500 ms; `/redirect`
 * answers 302 to `/`; `/interactions` serves a form for input/key/click tests;
 * `/ws` is a WebSocket echo server; `/frames` embeds a cross-origin iframe
 * (`localhost` vs `127.0.0.1`), starts a worker and requests a missing image;
 * `/deep` has controls inside an open shadow root and a same-origin iframe;
 * `/eval-frames` embeds a same-origin and a cross-origin iframe;
 * `/frame-origins` has srcdoc, about:blank, data: and sandboxed iframes;
 * `/framework-listeners` has React- and jQuery-style listeners; `/forms`
 * has a checkout form for readiness and fill read-back checks; `/layout`
 * places elements in view, under an overlay, below the fold, hidden and in
 * an iframe; `/hanging` is stuck loading on a script (`/never.js`) whose
 * server never answers, `/hanging-head` on one in its head (no body yet),
 * `/hanging-login` posts to `/authenticate-hanging`, which never answers; `/dynamic-loading` reveals a result a while after its
 * Start button is clicked (like the-internet's dynamic_loading); `/login`
 * posts to `/authenticate`, which redirects to `/secure` for the password
 * `secret` and otherwise back to `/login` with an error flash (like
 * the-internet's login); `/cross-frame` (loaded from `a.b.localhost`) embeds a
 * bordered and a scaled cross-origin iframe of the same site, each with a
 * button and a field; `/effects` has a tooltip, CSS hover captions, a to-do
 * field, buttons whose results come late and a covered button; `/attributes`
 * has an image, a link, a form with fields and an iframe for `dom query`'s key
 * attributes; `/repeated-headers` sends the same header value twice;
 * `/downloads` links to `/report-download` (an attachment of 15 bytes, also
 * opened in a new tab by a `target=_blank` link and by `window.open()`) and
 * `/slow-download` (an attachment whose second half is held back until
 * `/slow-download/release` is requested). Pages for
 * frame order, rejections and framework listeners come from
 * `knownLimitFixtures.ts`; the `dom inspect` pages from `inspectFixtures.ts`.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { WebSocketServer } from 'ws';

import { INSPECT_ROUTES } from '@/__testutils__/inspectFixtures.js';
import { KNOWN_LIMIT_ROUTES } from '@/__testutils__/knownLimitFixtures.js';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../__tests__/fixtures'
);
const FIXTURE_HTML = path.join(FIXTURES_DIR, 'index.html');
const INTERACTIONS_HTML = path.join(FIXTURES_DIR, 'interactions.html');

/** Delay for the `/slow` route, long enough to stop a session mid-startup. */
const SLOW_RESPONSE_MS = 8000;

/** Delay for the `/api/delayed` route, longer than an action's 150 ms idle wait. */
const DELAYED_API_MS = 500;

/** 1x1 PNG served at /pixel.png (binary response bodies). */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Page whose console output comes from other targets and from the browser. */
const FRAMES_HTML = `<!doctype html><title>frames</title>
<img src="/not-found.png">
<script>
  const frame = document.createElement('iframe');
  frame.src = 'http://localhost:' + location.port + '/frame-child';
  document.body.append(frame);
  new Worker(URL.createObjectURL(new Blob(['console.warn("from worker")'])));
</script>`;

/** Cross-origin iframe content: logs an object that needs expansion. */
const FRAME_CHILD_HTML = `<!doctype html><script>
  console.log('from cross-origin frame', { nested: { deep: { value: 42 } } });
</script>`;

/** Page with controls in an open shadow root and in a same-origin iframe. */
const DEEP_HTML = `<!doctype html><title>deep</title>
<p class="note">li<b>ght</b><span hidden> secret</span></p>
<shadow-form></shadow-form>
<iframe src="/deep-frame" style="margin-top: 40px; width: 400px; height: 200px; padding: 25px; border: 6px solid"></iframe>
<script>
  window.events = [];
  customElements.define('shadow-form', class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<p class="note">shadow</p><input id="shadow-input">' +
        '<button id="shadow-button">Shadow</button>';
      root.getElementById('shadow-button').onclick = () => window.events.push('shadow-click');
      root.getElementById('shadow-input').onkeydown = (e) => window.events.push('shadow-key:' + e.key);
    }
  });
</script>`;

/** Page with a same-origin iframe (`/deep-frame`) and a cross-origin one (`/frame-child`). */
const EVAL_FRAMES_HTML = `<!doctype html><title>eval frames</title>
<iframe name="same" src="/deep-frame"></iframe>
<script>
  const frame = document.createElement('iframe');
  frame.id = 'cross';
  frame.src = 'http://localhost:' + location.port + '/frame-child';
  document.body.append(frame);
</script>`;

/**
 * Frames whose origin is not their URL's: srcdoc and about:blank (inherit
 * the page's), data: and sandboxed without allow-same-origin (opaque), and a
 * sandbox that allows same-origin.
 */
const FRAME_ORIGINS_HTML = `<!doctype html><title>frame origins</title>
<iframe id="sd" srcdoc="<p>srcdoc</p><iframe id=inner srcdoc='<p>inner</p>'></iframe>"></iframe>
<iframe id="blank"></iframe>
<iframe id="dataf" src="data:text/html,<p>data</p>"></iframe>
<iframe id="sb" sandbox="allow-scripts" src="/deep-frame"></iframe>
<iframe id="sbso" sandbox="allow-scripts allow-same-origin" src="/deep-frame"></iframe>`;

/**
 * Form readiness and action feedback: required fields (label `*` and the
 * attribute), a last-name field whose input handler moves the value into the
 * first name, a radio group, a checkbox group, a Cancel button before the
 * submit button, two to-do rows with checkboxes, a covered button, and a
 * button loading a stylesheet, an image and a fetch, a select whose
 * change handler submits its form (navigating away), a button that does
 * nothing (like saucedemo problem_user's Remove), one that changes its text,
 * one that shows an error text, a link changing the URL's hash, a mailto:
 * link (its default action prevented, so the system mail app never opens), a button copying to the clipboard and one attaching a closed shadow
 * root.
 */
const FORMS_HTML = `<!doctype html><title>forms</title>
<form id="checkout" onsubmit="return false">
  <label for="first">First Name *</label><input id="first" name="first">
  <label for="last">Last Name *</label>
  <input id="last" name="last" oninput="document.getElementById('first').value = this.value; this.value = ''">
  <label for="zip">Zip</label><input id="zip" name="zip" required>
  <fieldset><legend>Size</legend>
    <label><input type="radio" name="size" value="s"> Small</label>
    <label><input type="radio" name="size" value="l"> Large</label>
  </fieldset>
  <label><input type="checkbox" name="extra" value="cheese"> Cheese</label>
  <label><input type="checkbox" name="extra" value="onion"> Onion</label>
  <button id="cancel" class="btn btn_secondary">Cancel</button>
  <input type="submit" id="continue" class="btn btn_primary" value="Continue">
</form>
<ul><li><input type="checkbox" class="toggle"><label>Write report</label></li>
<li><input type="checkbox" class="toggle"><label>Buy milk</label></li></ul>
<div style="position:relative"><button id="behind" type="button">Behind</button>
<div style="position:absolute;inset:0"></div></div>
<button id="load-assets" type="button" onclick="
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/style.css?' + Date.now(); document.head.append(link);
  const img = new Image(); img.src = '/pixel.png?' + Date.now(); document.body.append(img);
  fetch('/api/test');
">Load</button>
<form id="jump" action="/forms-jumped"><select id="jump-to" name="to" onchange="this.form.submit()">
<option value="a">A</option><option value="b">B</option></select></form>
<button id="broken" type="button" onclick="void 0">Remove</button>
<button id="add" type="button" onclick="this.textContent = this.textContent === 'Add' ? 'Added' : 'Add'">Add</button>
<button id="validate" type="button" onclick="document.getElementById('form-error').textContent = 'Zip is required'">Check</button>
<p id="form-error" class="error"></p>
<a id="filter-active" href="#/active">Active</a>
<a id="mail" href="mailto:help@example.test" onclick="event.preventDefault()">Mail us</a>
<button id="copy" type="button" onclick="document.execCommand('copy')">Copy</button>
<div id="host"></div>
<button id="attach" type="button" onclick="document.getElementById('host').attachShadow({ mode: 'closed' }).innerHTML = '<p>Inside</p>'">Attach</button>`;

/**
 * Framework-style listeners: a React-like root container (two bound
 * dispatchers for 12 event types, capture and bubble) with a no-op
 * `onclick` on its buttons, React props (`__reactProps$abc` with an
 * `onClick` on `#buy`, a fiber with `onKeyDownCapture` on `#card`), and a
 * minimal jQuery stand-in (`jQuery._data`) whose dispatcher on `document`
 * holds a delegate for `.row` and one for `.nomatch`.
 */
const FRAMEWORK_LISTENERS_HTML = `<!doctype html><title>framework listeners</title>
<div id="root"><button id="go">Go</button><div class="row" id="row">Row</div>
<div id="card"><button id="buy">Buy</button></div></div>
<script>
  const root = document.getElementById('root');
  function dispatchDiscreteEvent() {}
  function dispatchEvent() {}
  ['click', 'keydown', 'keyup', 'input', 'change', 'pointerdown', 'pointerup', 'focusin', 'focusout']
    .forEach((type) => [true, false].forEach((capture) => root.addEventListener(type, dispatchDiscreteEvent.bind(null, type), capture)));
  ['scroll', 'wheel', 'mousemove']
    .forEach((type) => [true, false].forEach((capture) => root.addEventListener(type, dispatchEvent.bind(null, type), capture)));
  document.getElementById('go').onclick = function noop() {};
  const buy = document.getElementById('buy');
  buy.onclick = function noop() {};
  buy.__reactProps$abc = { onClick: function handleBuy() { return 'bought'; }, children: 'Buy' };
  document.getElementById('card').__reactFiber$abc = { memoizedProps: { onKeyDownCapture: function cardKeys() {} } };
  const handle = function (e) { return jQuery.event.dispatch(e); };
  const events = { click: [
    { type: 'click', origType: 'click', selector: '.row', handler: function rowClicked() { return 'row'; } },
    { type: 'click', origType: 'click', selector: '.nomatch', handler: function neverRuns() {} },
  ] };
  window.jQuery = { fn: { jquery: 'stub' }, event: {}, _data: (node) => (node === document ? { handle, events } : undefined) };
  document.addEventListener('click', handle);
</script>`;

/** Same-origin iframe content of `/deep`. */
const DEEP_FRAME_HTML = `<!doctype html><p class="note">frame</p>
<input id="frame-input" aria-label="Frame field">
<button id="frame-button" style="margin-left: 120px">Frame</button>
<script>
  document.getElementById('frame-button').onclick = () => parent.events.push('frame-click');
  document.getElementById('frame-input').onkeydown = (e) => parent.events.push('frame-key:' + e.key);
</script>`;

/**
 * Page for `dom layout`: a button in view, one under an overlay, one below
 * the fold, a hidden paragraph, a same-origin iframe at a known offset, a
 * button with `pointer-events: none`, one under a `pointer-events: none`
 * overlay, a dropdown escaping an `overflow: hidden` parent, a link
 * wrapped over two lines, a button in a closed `<details>`, a fixed
 * off-canvas link, a skip link beyond the page's scroll range, a fixed
 * element inside a transformed container (which scrolls with the page), a
 * scroll list inside CSS `zoom: 2`, a button under its card's `::after`
 * overlay, a link in a collapsed `height: 0` accordion, a link in an
 * `opacity: 0` parent, a `visibility: hidden` text, an sr-only `clip`, a
 * `clip-path: inset(50%)` parent, an `<option>`, a link slotted into a
 * transparent shadow wrapper and a link in a 0.4px tall clipping container.
 */
const LAYOUT_HTML = `<!doctype html><title>layout</title>
<style>body { margin: 0; height: 3000px; } button { position: absolute; width: 100px; height: 30px; }</style>
<button id="top" style="left: 10px; top: 10px">Top</button>
<button id="covered" style="left: 10px; top: 60px">Covered</button>
<div id="overlay" style="position: absolute; left: 0; top: 50px; width: 200px; height: 50px; background: rgba(0, 0, 0, 0.4)"></div>
<p id="gone" style="display: none">Gone</p>
<iframe src="/deep-frame" style="position: absolute; left: 300px; top: 100px; width: 400px; height: 200px; border: 5px solid; padding: 10px"></iframe>
<button id="save" style="left: 20px; top: 2000px; width: 120px; height: 40px">Save</button>
<div id="floor" style="position: absolute; left: 0; top: 115px; width: 200px; height: 40px"></div>
<button id="click-through" style="left: 10px; top: 120px; pointer-events: none">Through</button>
<div id="glass" style="position: absolute; left: 0; top: 160px; width: 200px; height: 50px; pointer-events: none"></div>
<button id="under-glass" style="left: 10px; top: 170px">Under glass</button>
<div style="position: absolute; left: 10px; top: 250px; width: 200px">
  <div style="overflow: hidden; height: 20px">
    <ul id="dropdown" style="position: absolute; top: 30px; margin: 0"><li>Option</li></ul>
  </div>
</div>
<p style="position: absolute; left: 10px; top: 350px; margin: 0; width: 11ch; font: 20px/20px monospace"><b>AAAAAAA</b> <a id="wrapped" href="#">BB CC</a> <b>DDDDDDD</b></p>
<details style="position: absolute; left: 10px; top: 450px"><summary>FAQ</summary><button id="in-details" style="position: static">Answer</button></details>
<nav style="position: fixed; left: 0; top: 0; width: 200px; transform: translateX(-100%)"><a id="off-canvas" href="#">Menu</a></nav>
<a id="skip" href="#save" style="position: absolute; left: -9999px; top: 0">Skip</a>
<div style="position: absolute; top: 2000px; left: 0; transform: translateZ(0)"><div id="fixed-in-transform" style="position: fixed; top: 0; left: 0">Toast</div></div>
<div style="position: absolute; left: 750px; top: 10px"><div style="zoom: 2"><div id="zoom-box" style="width: 100px; height: 50px; overflow: auto; border: 2px solid">
  <p class="zoomed" style="height: 20px; margin: 0">Z0</p><p class="zoomed" style="height: 20px; margin: 0">Z1</p><p class="zoomed" style="height: 20px; margin: 0">Z2</p><p class="zoomed" style="height: 20px; margin: 0">Z3</p>
</div></div></div>
<style>.card::after { content: ''; position: absolute; inset: 0; }</style>
<div class="card" style="position: absolute; left: 750px; top: 150px; width: 150px; height: 50px"><button id="in-card" style="position: static">In card</button></div>
<div id="accordion" style="position: absolute; left: 750px; top: 250px; width: 150px; height: 0; overflow: hidden"><a id="in-accordion" href="#">Answer link</a></div>
<div id="faded" style="position: absolute; left: 750px; top: 300px; opacity: 0"><a id="in-faded" href="#">Faded link</a></div>
<span id="ghost" style="position: absolute; left: 750px; top: 350px; visibility: hidden">Ghost text</span>
<span id="sr-only" style="position: absolute; left: 750px; top: 400px; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">Skip</span>
<div id="clipped" style="position: absolute; left: 750px; top: 420px; clip-path: inset(50%)"><a id="in-clipped" href="#">Clipped</a></div>
<select style="position: absolute; left: 750px; top: 450px"><option id="first-option">One</option></select>
<div id="slot-host" style="position: absolute; left: 750px; top: 480px"><a id="slotted" href="#">Slotted</a></div>
<script>document.getElementById('slot-host').attachShadow({ mode: 'open' }).innerHTML = '<div id="slot-fade" style="opacity: 0"><slot></slot></div>';</script>
<div style="position: absolute; left: 750px; top: 510px; width: 100px; height: 0.4px; overflow: hidden"><a id="in-sliver" href="#">Sliver</a></div>`;

/**
 * Page embedding two cross-origin iframes of the same site (load it from
 * `a.b.localhost`; the frames come from `c.b.localhost`), which Chrome keeps
 * in the page's process, like a consent dialog served from a subdomain:
 * `#plain` with a margin, border and padding, `#scaled` also scaled to half
 * its size with `transform: scale(0.5)`.
 */
const CROSS_FRAME_HTML = `<!doctype html><title>cross frame</title>
<style>body { margin: 8px } iframe { display: block; width: 400px; height: 200px; margin-left: 150px }</style>
<p>Outside</p>
<script>
  window.events = [];
  window.addEventListener('message', (e) => window.events.push(e.data));
  const child = 'http://c.b.localhost:' + location.port + '/cross-frame-child#';
  document.body.insertAdjacentHTML('beforeend',
    '<iframe id="plain" src="' + child + 'plain" style="margin-top: 80px; border: 4px solid; padding: 10px"></iframe>' +
    '<iframe id="scaled" src="' + child + 'scaled" style="margin-top: 20px; border: 6px solid; padding: 8px; transform: scale(0.5); transform-origin: 0 0"></iframe>');
</script>`;

/**
 * Content of the `/cross-frame` iframes: a button and a field named after the
 * frame (its URL's hash) that report to the page.
 */
const CROSS_FRAME_CHILD_HTML = `<!doctype html><body style="margin: 0">
<label><span id="code-label">Code</span> <input id="code" style="margin-left: 60px"></label>
<button id="accept" style="margin: 30px 0 0 90px">Accept</button>
<script>
  const name = location.hash.slice(1);
  document.getElementById('code-label').textContent = 'Code ' + name;
  document.getElementById('accept').textContent = 'Accept ' + name;
  document.getElementById('accept').onclick = () => parent.postMessage('accepted:' + name, '*');
  document.getElementById('code').oninput = (e) => parent.postMessage('code:' + name + ':' + e.target.value, '*');
</script>`;

/** Page stuck in readyState "loading": its script request is never answered. */
const HANGING_HTML = `<!doctype html><title>hanging</title>
<p id="ready">Content</p>
<script src="/never.js"></script>
<p id="late">After the script</p>`;

/** Page stuck loading before its body exists: a script in the head is never answered. */
const HANGING_HEAD_HTML = `<!doctype html><html><head><title>hanging head</title>
<script src="/never.js"></script></head><body><form><input id="late-field"></form></body></html>`;

/**
 * Login page posting to `/authenticate`; `{flash}` is replaced by the error
 * flash after a failed login (with a "×" close link, like the-internet).
 */
const LOGIN_HTML = `<!doctype html><title>login</title>
<div id="flash-messages">{flash}</div>
<form id="login" method="post" action="/authenticate">
  <input id="username" name="username"><input id="password" name="password" type="password">
  <button type="submit">Login</button>
</form>`;

/** Login form whose POST (`/authenticate-hanging`) the server never answers. */
const HANGING_LOGIN_HTML = `<!doctype html><title>hanging login</title>
<form id="login" method="post" action="/authenticate-hanging">
  <input id="username" name="username"><button type="submit">Login</button>
</form>`;

/** Error flash shown on `/login` after a failed login */
const LOGIN_ERROR_FLASH =
  '<div id="flash" class="flash error">Your password is invalid!<a href="#" class="close">×</a></div>';

/** Page `/authenticate` redirects to after a successful login */
const SECURE_HTML = `<!doctype html><title>secure</title>
<div id="flash" class="flash success">You logged into a secure area!</div>`;

/** How long `/dynamic-loading` shows its spinner before the result */
const DYNAMIC_LOADING_MS = 1500;

/**
 * Timer-based loading without requests: Start hides itself and shows
 * "Loading...", which is removed {@link DYNAMIC_LOADING_MS} later when the
 * hidden `#finish` is shown and `#status` says "Done".
 */
const DYNAMIC_LOADING_HTML = `<!doctype html><title>dynamic loading</title>
<div id="start"><button>Start</button></div>
<div id="loading" style="display: none">Loading...</div>
<div id="finish" style="display: none"><h4>Hello World!</h4></div>
<p id="status">Idle</p>
<script>
  document.querySelector('#start button').onclick = () => {
    document.getElementById('start').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    setTimeout(() => {
      document.getElementById('loading').remove();
      document.getElementById('finish').style.display = 'block';
      document.getElementById('status').textContent = 'Done';
    }, ${DYNAMIC_LOADING_MS});
  };
</script>`;

/**
 * What actions show and leave unfinished: a help icon showing a tooltip on
 * mouseenter, cards whose caption only CSS `:hover` shows, a to-do field
 * adding an item on Enter (while a ticker elsewhere adds a line on every
 * key), buttons whose result comes later (after a spinner, in 50 ms steps,
 * in 50 ms steps on a page busy from 60 to 260 ms as on a slow machine,
 * after a 1.5 s long task), one rendering twice and then stopping, one
 * showing a toast that hides itself, a button covered by a transparent
 * overlay, and a hover target whose mouseenter removes 200 of the 1600
 * text elements beside it. The steps are 50 ms apart, well under the
 * 150 ms a still-changing page may stay quiet: timers on the macOS CI runner
 * run up to 75 ms late, so 100 ms steps came up to 175 ms apart there.
 */
const EFFECTS_HTML = `<!doctype html><title>effects</title>
<style>.card { width: 80px; height: 40px; display: inline-block; vertical-align: top; overflow: hidden } .card .caption { display: none } .card:hover .caption { display: block }</style>
<span id="help" style="padding: 4px">?</span><div id="tip" role="tooltip" hidden>Saves a draft every minute</div>
<div class="cards"><div class="card"><span class="caption">first card</span></div><div class="card"><span class="caption">second card</span></div></div>
<section id="todo-app"><header><input id="todo"></header><ul id="todos"></ul></section>
<button id="spin">Spin</button><button id="twice">Twice</button><button id="steps">Steps</button><button id="busy-steps">Busy steps</button><button id="block">Block</button><button id="toast">Toast</button>
<div id="results"></div>
<div style="position: relative; display: inline-block"><button id="covered">Covered</button><div id="cover" style="position: absolute; inset: 0"></div></div>
<aside id="ticker"></aside>
<div id="shift" style="font-size: 4px"><span id="shift-target" style="font-size: 16px">Shift</span></div>
<script>
  window.coveredClicks = 0;
  const results = document.getElementById('results');
  const add = (text) => results.insertAdjacentHTML('beforeend', '<p>' + text + '</p>');
  document.getElementById('help').onmouseenter = () => { document.getElementById('tip').hidden = false; };
  document.getElementById('todo').onkeydown = (event) => {
    if (event.key !== 'Enter' || !event.target.value) return;
    document.getElementById('todos').insertAdjacentHTML('beforeend', '<li>' + event.target.value + '</li>');
    event.target.value = '';
  };
  document.addEventListener('keydown', () => {
    document.getElementById('ticker').insertAdjacentHTML('beforeend', '<p>Market update</p>');
  });
  document.getElementById('twice').onclick = () => {
    add('First render');
    setTimeout(() => add('Second render'), 100);
  };
  const shift = document.getElementById('shift');
  shift.insertAdjacentHTML('beforeend', Array.from({ length: 1600 }, (_, i) => '<span> s' + i + '</span>').join(''));
  document.getElementById('shift-target').onmouseenter = () => {
    Array.from(shift.querySelectorAll('span:not(#shift-target)')).slice(0, 200).forEach((span) => span.remove());
  };
  document.getElementById('spin').onclick = () => {
    results.insertAdjacentHTML('beforeend', '<div class="spinner">Please wait</div>');
    setTimeout(() => { results.querySelector('.spinner').remove(); add('Spun'); }, 1500);
  };
  document.getElementById('steps').onclick = () => {
    let step = 0;
    const next = () => { add('Step ' + step); if (++step < 20) setTimeout(next, 50); };
    next();
  };
  document.getElementById('busy-steps').onclick = () => {
    document.getElementById('steps').onclick();
    setTimeout(() => {
      const end = Date.now() + 200;
      while (Date.now() < end);
    }, 60);
  };
  document.getElementById('block').onclick = () => setTimeout(() => {
    const end = Date.now() + 1500;
    while (Date.now() < end);
    add('Unblocked');
  }, 60);
  document.getElementById('toast').onclick = () => {
    results.insertAdjacentHTML('beforeend', '<div class="toast">Saved</div>');
    setTimeout(() => results.querySelector('.toast').remove(), 3000);
  };
  document.getElementById('covered').onclick = () => window.coveredClicks++;
</script>`;

/** Elements with key attributes for `dom query` (#346) */
const ATTRIBUTES_HTML = `<!doctype html><title>attributes</title>
<img id="logo" src="/static/media/sl-404.168b1cce.jpg" alt="Sauce Labs Backpack">
<a id="about" href="https://saucelabs.com/about/company">About</a>
<form id="login" action="/authenticate" method="post">
  <input id="user" name="user" placeholder="Username" value="ada">
  <input id="pass" name="pass" type="password" value="secret">
  <input id="csrf" name="csrf" type="hidden" value="tok-hidden-123">
  <input id="card" name="card" autocomplete="cc-number" value="4111111111111111">
  <input id="shown" name="password2" value="shown-secret">
  <input id="code" autocomplete="one-time-code" aria-label="Code" value="246810">
  <label><input type="radio" name="size" value="medium" checked> Medium</label>
  <select id="sort" name="sort"><option>Name</option><option selected>Price (low to high)</option></select>
  <button id="go">Go</button>
</form>
<iframe id="pay" src="/frame-child?x=1"></iframe>`;

/**
 * A page that logs in with credentials in headers, a JSON body and a cookie,
 * then sends the cookie back; the title says `done` when both requests finished.
 * The secrets are assembled in the script so the captured page source holds none.
 */
const HAR_SECRETS_HTML = `<!doctype html><title>har secrets</title>
<script>
const secret = ['SEC', 'RET'].join('');
fetch('/har-login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret, 'X-Api-Key': secret + '-KEY' },
  body: JSON.stringify({ user: 'ann', password: 'hunter' + 2 }),
})
  .then(() => fetch('/har-login', { method: 'POST', body: 'again' }))
  .then(() => {
    const socket = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
    socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: secret + '-WS' }));
    socket.onmessage = () => { document.title = 'done'; };
  });
</script>`;

/** Links to the attachments of `/report-download` and `/slow-download` */
const DOWNLOADS_HTML = `<!doctype html><title>downloads</title>
<a id="report" href="/report-download">Report</a>
<a id="report-tab" href="/report-download" target="_blank">Report in a new tab</a>
<button id="report-window" onclick="window.open('/report-download')">Report in a window</button>
<a id="slow" href="/slow-download">Slow</a>`;

/** Body of the `/report-download` attachment (15 bytes) */
export const REPORT_DOWNLOAD_BODY = 'fixture report\n';

/** File name the `/report-download` attachment suggests */
export const REPORT_DOWNLOAD_NAME = 'bdg-fixture-report.txt';

/** File name the `/slow-download` attachment suggests */
export const SLOW_DOWNLOAD_NAME = 'bdg-fixture-slow.bin';

/** Size of each half of the `/slow-download` attachment */
const SLOW_DOWNLOAD_HALF_BYTES = 10000;

/** Body of a 404 page */
const MISSING_PAGE_HTML = '<!doctype html><title>Not found</title><h1>Not found</h1>';

/** A 404 page that loads the app, as single-page apps on static hosts do */
const SPA_MISSING_HTML =
  "<!doctype html><title>Not found</title><script>location.replace('/?' + location.pathname)</script>";

/**
 * Running fixture server handle.
 */
export interface FixtureServer {
  /** Base URL, e.g. `http://127.0.0.1:53211/` */
  url: string;
  /** Stop the server */
  close: () => Promise<void>;
  /** Query strings of the `/beacon?…` requests the pages sent, in order */
  beacons: string[];
}

/**
 * Start the fixture server on an ephemeral port.
 *
 * @returns Server handle with its URL
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const html = fs.readFileSync(FIXTURE_HTML);
  const interactionsHtml = fs.readFileSync(INTERACTIONS_HTML);
  let loginFailed = false;
  const heldDownloads = new Set<http.ServerResponse>();
  const beacons: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/beacon?')) {
      beacons.push(req.url.slice('/beacon?'.length));
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === '/authenticate' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        const password = new URLSearchParams(body).get('password');
        loginFailed = password !== 'secret';
        res.writeHead(303, { Location: loginFailed ? '/login' : '/secure' });
        res.end();
      });
      return;
    }
    if (req.url === '/login' || req.url === '/secure') {
      const page =
        req.url === '/secure'
          ? SECURE_HTML
          : LOGIN_HTML.replace('{flash}', loginFailed ? LOGIN_ERROR_FLASH : '');
      if (req.url === '/login') loginFailed = false;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page);
      return;
    }
    if (req.url === '/slow') {
      const timer = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      }, SLOW_RESPONSE_MS);
      req.on('close', () => clearTimeout(timer));
      return;
    }
    if (req.url === '/interactions') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(interactionsHtml);
      return;
    }
    if (req.url === '/pixel.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PIXEL_PNG);
      return;
    }
    if (req.url === '/har-secrets') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HAR_SECRETS_HTML);
      return;
    }
    if (req.url === '/har-login') {
      req.resume();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'har_session=SECRET-SESSION; Path=/; HttpOnly',
      });
      res.end(
        '{"ok":true,"access_token":"SECRET-ACCESS","refresh_token":"SECRET-REFRESH","expires_in":3600}'
      );
      return;
    }
    if (req.url === '/cookie') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': ['fixture_session=abc; Path=/; HttpOnly', 'fixture_theme=dark; Path=/'],
      });
      res.end('cookies set');
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    if (req.url === '/missing-page' || req.url === '/spa-missing') {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(req.url === '/missing-page' ? MISSING_PAGE_HTML : SPA_MISSING_HTML);
      return;
    }
    if (req.url === '/error-page') {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Internal error</h1>');
      return;
    }
    if (req.url === '/deep' || req.url === '/deep-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/deep' ? DEEP_HTML : DEEP_FRAME_HTML);
      return;
    }
    if (req.url === '/never.js' || req.url === '/authenticate-hanging') return;
    if (req.url === '/hanging-login') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HANGING_LOGIN_HTML);
      return;
    }
    if (req.url === '/hanging' || req.url === '/dynamic-loading') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/hanging' ? HANGING_HTML : DYNAMIC_LOADING_HTML);
      return;
    }
    if (req.url === '/hanging-head') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HANGING_HEAD_HTML);
      return;
    }
    if (req.url === '/cross-frame' || req.url?.startsWith('/cross-frame-child')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/cross-frame' ? CROSS_FRAME_HTML : CROSS_FRAME_CHILD_HTML);
      return;
    }
    if (req.url === '/effects') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(EFFECTS_HTML);
      return;
    }
    if (req.url === '/layout') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(LAYOUT_HTML);
      return;
    }
    const knownLimitPage = KNOWN_LIMIT_ROUTES[req.url ?? ''] ?? INSPECT_ROUTES[req.url ?? ''];
    if (knownLimitPage !== undefined) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(knownLimitPage);
      return;
    }
    if (req.url === '/eval-frames') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(EVAL_FRAMES_HTML);
      return;
    }
    if (req.url === '/forms') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(FORMS_HTML);
      return;
    }
    if (req.url === '/attributes') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(ATTRIBUTES_HTML);
      return;
    }
    if (req.url === '/repeated-headers') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Repeated', ['max-age=63072000', 'max-age=63072000']);
      res.writeHead(200);
      res.end('{}');
      return;
    }
    if (req.url === '/frame-origins' || req.url === '/framework-listeners') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/frame-origins' ? FRAME_ORIGINS_HTML : FRAMEWORK_LISTENERS_HTML);
      return;
    }
    if (req.url === '/frames' || req.url === '/frame-child') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/frames' ? FRAMES_HTML : FRAME_CHILD_HTML);
      return;
    }
    if (req.url === '/not-found.png') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing');
      return;
    }
    if (req.url === '/downloads') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DOWNLOADS_HTML);
      return;
    }
    if (req.url === '/report-download') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': `attachment; filename="${REPORT_DOWNLOAD_NAME}"`,
      });
      res.end(REPORT_DOWNLOAD_BODY);
      return;
    }
    if (req.url === '/slow-download') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${SLOW_DOWNLOAD_NAME}"`,
        'Content-Length': String(2 * SLOW_DOWNLOAD_HALF_BYTES),
      });
      res.write(Buffer.alloc(SLOW_DOWNLOAD_HALF_BYTES, 'a'));
      heldDownloads.add(res);
      res.on('close', () => heldDownloads.delete(res));
      return;
    }
    if (req.url === '/slow-download/release') {
      heldDownloads.forEach((held) => held.end(Buffer.alloc(SLOW_DOWNLOAD_HALF_BYTES, 'b')));
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === '/api/delayed') {
      const timer = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }, DELAYED_API_MS);
      req.on('close', () => clearTimeout(timer));
      return;
    }
    if (req.url === '/api/test') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  const echo = new WebSocketServer({ server, path: '/ws' });
  echo.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    beacons,
    close: () =>
      new Promise<void>((resolve) => {
        echo.clients.forEach((socket) => socket.terminate());
        echo.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Ports tests pick from: below the ephemeral ranges (Linux 32768+, macOS 49152+) */
const TEST_PORT_RANGE = { from: 20000, to: 32000 };

/**
 * Whether a TCP port on 127.0.0.1 can be listened on now.
 *
 * @param port - Port
 * @returns True when it is free
 */
async function portIsFree(port: number): Promise<boolean> {
  const server = net.createServer();
  return new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

/**
 * Get a free TCP port on 127.0.0.1 for a test session's Chrome. Picked at
 * random below the ephemeral ranges: a port the system hands out for
 * outgoing connections (Chrome's, the fixture server's) can be taken again
 * between this check and Chrome binding it, which made starts fail with
 * "Port … is already in use" on CI.
 *
 * @returns Free port number
 */
export async function getFreePort(): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port =
      TEST_PORT_RANGE.from +
      Math.floor(Math.random() * (TEST_PORT_RANGE.to - TEST_PORT_RANGE.from));
    if (await portIsFree(port)) return port;
  }
  throw new Error('No free test port found');
}
