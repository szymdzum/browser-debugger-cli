/**
 * Fixture page for the visibility verdict `dom inspect`, `dom layout` and
 * `:visible` give from what an element paints (#609), served by the fixture
 * server: `/visibility-verdict` has an inline host whose slotted content sits
 * in a `height: 0; overflow: hidden` wrapper (`#acc`, as on `/components`), a
 * host under a `visibility: hidden` ancestor whose slotted span is
 * `visibility: visible` (`#h`), an inline span around a block child, a
 * `display: contents` wrapper, a `height: 0; overflow: hidden` box, an
 * `opacity: 0` element, a `clip-path: inset(100%)` element, a
 * `visibility: hidden` element with no visible descendant, `visibility:
 * hidden` elements whose `visibility: visible` descendant paints nothing
 * (`opacity: 0`; only hidden text inside it, with and without a sized box)
 * (and the same with paint of its own: backgrounds, transparent and shadowed
 * text, generated content, an outline, a list marker; a clipped-away box), an
 * inline host of floats with a background, and an element far below the viewport.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** One element per case, each with an id */
const VERDICT_HTML = `<!doctype html><meta charset="utf-8"><title>visibility verdict</title>
<x-acc id="acc"><button id="acc-button">Hidden</button></x-acc>
<div style="visibility:hidden"><x-h id="h"><span id="h-span" style="visibility:visible">Shown</span></x-h></div>
<span id="inline-block"><div>Block child</div></span>
<div id="contents" style="display:contents"><span>Contents child</span></div>
<div id="collapsed" style="height:0;overflow:hidden"><span>Collapsed child</span></div>
<div id="transparent" style="opacity:0">Transparent</div>
<div id="clip-path" style="clip-path:inset(100%)">Clipped away</div>
<div id="vis-hidden" style="visibility:hidden"><span>Not shown</span></div>
<div id="op0" style="visibility:hidden"><span style="visibility:visible;opacity:0">op0</span></div>
<div id="deep" style="visibility:hidden"><span style="visibility:visible"><span style="visibility:hidden">deep</span></span></div>
<div id="deep-box" style="visibility:hidden"><span style="visibility:visible;display:inline-block;width:80px;padding:4px"><span style="visibility:hidden">deep box</span></span></div>
<style>.pseudo::before { content: "+"; }</style>
<div id="bg-red" style="visibility:hidden"><span style="visibility:visible;display:inline-block;width:30px;height:10px;background:red"></span></div>
<div id="bg-clear" style="visibility:hidden"><span style="visibility:visible;display:inline-block;width:30px;height:10px;background:rgba(255,0,0,0)"></span></div>
<span id="floats-green"><div style="float:left;width:30px;height:20px;background:green"></div></span><div style="clear:both"></div>
<div id="clip-rect" style="visibility:hidden"><span style="visibility:visible;position:absolute;clip:rect(0,0,0,0);width:30px;height:20px;background:red"></span></div>
<div id="text-clear" style="visibility:hidden"><span style="visibility:visible;color:transparent">Clear text</span></div>
<div id="text-fill-clear" style="visibility:hidden"><span style="visibility:visible;-webkit-text-fill-color:transparent">Clear fill</span></div>
<div id="text-shadow" style="visibility:hidden"><span style="visibility:visible;color:transparent;text-shadow:0 0 2px red">Shadow text</span></div>
<div id="pseudo" style="visibility:hidden"><span class="pseudo" style="visibility:visible"></span></div>
<div id="outline" style="visibility:hidden"><span style="visibility:visible;display:inline-block;width:30px;height:10px;outline:2px solid red"></span></div>
<ul id="marker" style="visibility:hidden;margin:0"><li style="visibility:visible"><span style="visibility:hidden">Item</span></li></ul>
<div style="height:3000px"></div>
<div id="far">Far below</div>
<script>
  const define = (name, html) =>
    customElements.define(name, class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        this.attachShadow({ mode: 'open' }).innerHTML = html;
      }
    });
  define('x-acc', '<div style="height:0;overflow:hidden"><slot></slot></div>');
  define('x-h', '<p><slot></slot></p>');
</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/visibility-verdict': VERDICT_HTML,
};
