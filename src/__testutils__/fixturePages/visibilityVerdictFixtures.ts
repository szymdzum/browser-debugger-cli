/**
 * Fixture page for the visibility verdict `dom inspect`, `dom layout` and
 * `:visible` give from what an element paints (#609), served by the fixture
 * server: `/visibility-verdict` has an inline host whose slotted content sits
 * in a `height: 0; overflow: hidden` wrapper (`#acc`, as on `/components`), a
 * host under a `visibility: hidden` ancestor whose slotted span is
 * `visibility: visible` (`#h`), an inline span around a block child, a
 * `display: contents` wrapper, a `height: 0; overflow: hidden` box, an
 * `opacity: 0` element, a `clip-path: inset(100%)` element, a
 * `visibility: hidden` element with no visible descendant and an element far
 * below the viewport.
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
