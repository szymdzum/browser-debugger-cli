/**
 * Fixture page for `bdg dom inspect`, served by the fixture server at
 * `/inspect`: a styled button, a flex card with children, a grid list of
 * identical items, a field with a placeholder, an element with a `::before`,
 * a hidden one, a covered one, a webfont (a data: URL copy of a system font,
 * so it loads offline), an element in an open shadow root and one in a
 * same-origin iframe, plus cascade cases (a rule overriding another, flex
 * alignment on a block, an undefined custom property), secrets (a password and a card expiry select that
 * must never be shown), faded text and a block image with no size set (sized by itself).
 * `/inspect-state` has a checkbox styled by `:checked`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Same-origin iframe content of `/inspect` */
const INSPECT_FRAME_HTML =
  '<!doctype html><button id="in-frame" style="padding:6px 12px;color:#fff;background:#222">Framed</button>';

const INSPECT_HTML = `<!doctype html><meta charset="utf-8"><title>inspect</title>
<style>
  body { margin: 16px; font-family: Arial, sans-serif; color: #111; background: #fff; }
  #buy { padding: 12px 24px; margin: 0 0 16px; border: 1px solid #0a7cff; border-radius: 8px;
    background: #0a7cff; color: #fff; font-size: 16px; line-height: 24px; font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); cursor: pointer; }
  .card { display: flex; flex-direction: column; gap: 16px; width: 280px; padding: 16px;
    border: 1px solid #ddd; border-radius: 6px; }
  .card h3 { margin: 0; font-size: 18px; }
  .card p { margin: 0; }
  #grid { display: grid; grid-template-columns: repeat(3, 100px); gap: 8px; list-style: none; padding: 0; }
  #grid li { height: 40px; background: #eee; }
  #email { padding: 10px 0; border: 0; border-bottom: 1px solid #ededed; }
  #email::placeholder { color: #6d7584; }
  #badge { position: relative; padding-left: 20px; }
  #badge::before { content: "★"; position: absolute; left: 0; color: #f5a623; }
  #ghost { display: none; }
  #under { position: relative; }
  #cover { position: absolute; left: 0; top: 0; width: 200px; height: 40px; background: rgba(0, 0, 0, 0.5); }
  @font-face { font-family: "Fixture Sans"; src: local("Arial"), local("Helvetica"), local("Liberation Sans"), local("DejaVu Sans"); }
  #webfont { font-family: "Fixture Sans", serif; }
  .tag { color: #c00; padding: 4px 8px; }
  .tag.primary { color: #06c; }
  #hero { display: block; justify-content: center; gap: 12px; }
  :root { --accent: #06c; --accent-dark: #036; }
  #themed { color: var(--brand-color); }
  #partly { border: 1px solid var(--accent); border-color: #c00; }
  .hover-only:hover { --hover-bg: #eee; }
  .hover-only { background-color: var(--hover-bg); vertical-align: baseline; }
</style>
<button id="buy">Buy now</button>
<div class="card"><h3>Card title</h3><p>Some text</p><a href="#go">Go</a></div>
<ul id="grid">${'<li class="tile"></li>'.repeat(6)}</ul>
<input id="email" placeholder="E-mail">
<p id="badge">Featured</p>
<p id="ghost">Hidden text</p>
<div id="under"><button id="behind">Behind</button><div id="cover"></div></div>
<p id="webfont">Web font text</p>
<p id="fallback" style="font-family: 'No Such Font', Georgia">Fallback text</p>
<p id="generic" style="font-family: monospace">Generic text</p>
<div id="host"></div>
<span id="tag" class="tag primary">Tag</span>
<table id="sized" width="120"><tr><td>cell</td></tr></table>
<div id="hero"><span>Hero</span></div>
<p id="themed">Themed</p>
<div id="hover-only" class="hover-only">Hover me</div>
<p id="partly">Partly overridden border</p>
<div id="cut" style="width:60px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A long text that is cut</div>
<svg width="20" height="20"><rect id="rect" width="10" height="10" fill="#c00"/></svg>
<form id="secrets"><input id="pw" type="password" value="hunter2-secret">
<select id="exp" autocomplete="cc-exp-month"><option>07</option><option selected>11</option></select></form>
<div id="faded" style="opacity:0.4"><p id="faded-text" style="color:#000">Faded text</p></div>
<div style="opacity:0.5;background:#000"><p id="on-faded" style="color:#fff;margin:0">On a faded background</p></div>
<h2 id="blended" style="mix-blend-mode:multiply">Blended</h2>
<div style="position:relative;height:40px"><p id="under-header" style="margin:0">Under the header</p>
<header style="position:absolute;inset:0;background:#fff"><svg id="logo" width="100%" height="100%"></svg></header></div>
<img id="pic" style="display:block" alt="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<iframe id="frame" src="/inspect-frame" style="width:200px;height:60px;border:0"></iframe>
<p style="background:#ddd"><a id="via-child" href="#v" style="color:#c00"><b style="color:#eaecf0">Child text</b></a></p>
<a id="own-svg" href="#o" style="color:#fff;background:#222;font-family:Georgia">Own text<svg width="8" height="8"></svg></a>
<button id="icon-only"><svg width="8" height="8"></svg></button>
<x-slotted id="slotted">Slotted</x-slotted>
<p id="moving" style="transition: color 1s ease-in; outline: 2px solid #c00">Moving</p>
<script>
  document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML =
    '<span id="shadowed" style="color:#c00;font-weight:700">In shadow</span>';
  customElements.define('x-slotted', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        '<button id="slot-button" style="background:#0284c7;color:#fff;font:500 14px Arial;border:0"><slot class="label"></slot></button>';
    }
  });
</script>`;

/** A 10x10 black SVG image */
const BLACK_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='%23000'/%3E%3C/svg%3E";

/**
 * Paint that ancestors do not explain: a masked box with a transparent
 * measuring copy of its text, gradient text, white text over an image in and
 * out of view, a canvas, and a button far below the fold.
 */
const PAINT_HTML = `<!doctype html><html><head><title>Paint</title><style>
body { margin: 0; font: 16px Arial; background: #fff; }
#masked { position: relative; width: 300px; height: 80px; background: #222; color: #fff; mask-image: linear-gradient(#000, transparent); }
#masked .measure { opacity: 0; position: absolute; color: #ff0; }
#gradient { font-size: 40px; background: linear-gradient(90deg, #f00, #00f); background-clip: text; -webkit-text-fill-color: transparent; }
.hero { position: relative; height: 200px; }
.hero img { position: absolute; inset: 0; width: 100%; height: 100%; }
.hero p { position: relative; color: #fff; margin: 0; padding: 20px; }
</style></head><body>
<div id="masked"><span class="measure">A transparent measuring copy that is much longer</span>Hi</div>
<h1 id="gradient">Gradient</h1>
<div class="hero"><img src="${BLACK_IMAGE}" alt=""><p id="over-image">White over an image in view</p></div>
<canvas width="100" height="50"></canvas>
<div style="height: 2000px"></div>
<div class="hero"><img src="${BLACK_IMAGE}" alt=""><p id="low">White over an image out of view</p></div>
<button id="far">Far button</button>
</body></html>`;

/**
 * A page that replaces built-ins bdg's scripts use, as polyfills, old
 * frameworks and anti-bot scripts do: every `querySelectorAll` returns the
 * body, and `JSON.stringify` and `Array.prototype.map` lie.
 */
const TAMPERED_HTML = `<!doctype html><html><head><title>Tampered</title></head><body>
<h1 class="target">Heading</h1>
<button id="go" onclick="this.textContent = 'Clicked'">Go</button>
<iframe srcdoc="<p class='target'>In frame</p>"></iframe>
<script>
Element.prototype.querySelectorAll = function () { return [document.body]; };
Document.prototype.querySelectorAll = function () { return [document.body]; };
Element.prototype.querySelector = function () { return document.body; };
Document.prototype.querySelector = function () { return document.body; };
JSON.stringify = function () { return '"replaced"'; };
</script>
</body></html>`;

/**
 * A page whose replaced built-ins break bdg's action scripts unless they
 * avoid them: `Element.prototype.matches` always matches (so everything
 * would look `:disabled`), `Event` is a MooTools-1.2-like wrapper that
 * builds no event, `Object.keys` lies, and, as anti-bot scripts do,
 * `dispatchEvent` throws for `#guarded-field` (a number field, which
 * `dom fill` gives its value through events; text fields get typed text,
 * whose events the page's `dispatchEvent` does not see) and
 * `getBoundingClientRect` for `#guarded`. Input and change events on `#name` are logged in `#log`.
 */
const TAMPERED_ACTIONS_HTML = `<!doctype html><html><head><title>Tampered actions</title></head><body>
<input id="name"> <input id="guarded-field" type="number">
<button type="button" id="go" onclick="this.textContent = 'Clicked'">Go</button>
<button type="button" id="guarded">Guarded</button>
<div id="log"></div>
<script>
const log = (entry) => { document.getElementById('log').textContent += entry + ';'; };
document.getElementById('name').addEventListener('input', () => log('input'));
document.getElementById('name').addEventListener('change', () => log('change'));
Element.prototype.matches = function () { return true; };
window.Event = function (event) { this.event = event; };
const dispatch = EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent = function (event) {
  if (this.id === 'guarded-field') throw new Error('anti-bot: dispatchEvent');
  return dispatch.call(this, event);
};
const rect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  if (this.id === 'guarded') throw new Error('anti-bot: getBoundingClientRect');
  return rect.call(this);
};
Object.keys = function () { return ['bogus']; };
</script>
</body></html>`;

/**
 * Text read from where the page shows it: a custom element whose shadow root
 * shows its light-DOM text through `<p>Note: <slot></slot></p>`, a
 * read-only editor whose accessible name (its aria-label, as TinyMCE's body
 * has) differs from its visible text, an editable one (whose value is its
 * text) and a button whose name is its text.
 */
const READING_TEXT_HTML = `<!doctype html><meta charset="utf-8"><title>reading text</title>
<x-note id="note">Slotted <b>note</b> text</x-note>
<div id="editor" contenteditable="false" aria-label="Rich Text Area. Press ALT-0 for help."><p>Your content goes here.</p></div>
<div id="editable" contenteditable="true" aria-label="Notes"><p>Typed notes</p></div>
<button id="save">Save</button>
<script>
  customElements.define('x-note', class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = '<p id="note-text">Note: <slot></slot></p>';
    }
  });
</script>`;

/**
 * Text web components render themselves: a card with named and default
 * slots (filled, and empty so its fallback content shows, and with a hidden
 * slotted title), a component whose shadow root has text and no slot, a
 * field whose label lives in its shadow root, an icon button named only
 * inside its shadow root, a button whose text is slotted, an open
 * `display: contents` dialog host, an image link, an input inside a
 * label, a button rendered only by its shadow root, and a button slotted
 * into a collapsed `height: 0; overflow: hidden` shadow container next to
 * the same markup without shadow DOM.
 */
const COMPONENTS_HTML = `<!doctype html><meta charset="utf-8"><title>components</title>
<style>x-card { display: block; margin: 4px; }</style>
<x-card id="filled"><span slot="title">Named Title</span>Default body</x-card>
<x-card id="empty"></x-card>
<x-card id="hidden-title"><span slot="title" hidden>Hidden Title</span><span slot="title">Shown Title</span>Body</x-card>
<x-shadow-only id="shadow-only">Light text never shown</x-shadow-only>
<x-field id="field" label="What is your name?"></x-field>
<x-icon-button id="close"></x-icon-button>
<x-button id="ok">Ok, got it</x-button>
<x-dialog id="dialog"><p>Dialog body</p></x-dialog>
<a id="logo" href="#home"><img alt="Company logo" width="40" height="20" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
<label>User <input id="user" value="alice"></label>
<x-btn id="draft"></x-btn>
<x-acc id="acc"><button id="slotted-hidden">Hidden</button></x-acc>
<div id="light-acc" style="height:0;overflow:hidden"><button id="light-hidden">Hidden</button></div>
<script>
  const define = (name, html, style) =>
    customElements.define(name, class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML = html.replace('LABEL', this.getAttribute('label') || '');
        if (style) this.style.display = style;
      }
    });
  define('x-card', '<header><strong><slot name="title">Fallback title</slot></strong></header><div><slot>Fallback body</slot></div><button>Card action</button>');
  define('x-shadow-only', '<em>Shadow only text</em>');
  define('x-field', '<label for="input"><slot name="label">LABEL</slot></label><input id="input">');
  define('x-icon-button', '<button id="icon" aria-label="Close"><svg width="12" height="12"></svg></button>');
  define('x-button', '<button class="root"><slot></slot></button>');
  define('x-dialog', '<div class="panel" style="position:fixed;right:0;bottom:0;width:240px;height:100px;background:#fff"><h2>Dialog title</h2><slot></slot></div>', 'contents');
  define('x-btn', '<button>Save draft</button>');
  define('x-acc', '<div style="height:0;overflow:hidden"><slot></slot></div>');
</script>`;

/** `/inspect-state`: a checkbox whose color comes from a `:checked` rule once clicked */
const STATE_HTML = `<!doctype html><meta charset="utf-8"><title>inspect state</title>
<style>#c { color: red; } #c:checked { color: blue; }</style>
<input type="checkbox" id="c">`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/tampered': TAMPERED_HTML,
  '/tampered-actions': TAMPERED_ACTIONS_HTML,
  '/inspect': INSPECT_HTML,
  '/inspect-frame': INSPECT_FRAME_HTML,
  '/inspect-paint': PAINT_HTML,
  '/inspect-state': STATE_HTML,
  '/reading-text': READING_TEXT_HTML,
  '/components': COMPONENTS_HTML,
};
