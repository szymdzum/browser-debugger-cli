/**
 * Fixture page for how `<slot>` elements and other `display: contents`
 * elements (no box of their own) are measured, served by the fixture server:
 * `/slots` has a slot with nothing assigned and no fallback, slots whose only
 * assigned element is `display: none` or zero size, a slot showing element
 * fallback content, a slot passed on into another component's slot (both
 * show the text assigned to the outer one), a `display: contents` div
 * holding only text, and a slot showing text below the fold. Each slot's id
 * is its host's id plus `-slot`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Slots with and without content that has a box */
const SLOTS_HTML = `<!doctype html><meta charset="utf-8"><title>slots</title>
<x-box id="empty"></x-box>
<x-box id="none"><span style="display:none">Gone</span></x-box>
<x-box id="zero"><span style="display:inline-block;width:0;height:0"></span></x-box>
<x-fallback id="fallback"></x-fallback>
<x-outer id="nested">Nested text</x-outer>
<div id="contents-text" style="display:contents">Only text</div>
<div style="height:3000px"></div>
<x-box id="below">Below the fold</x-box>
<script>
  const define = (name, html) =>
    customElements.define(name, class extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        this.attachShadow({ mode: 'open' }).innerHTML = html.replace('ID', this.id + '-slot');
      }
    });
  define('x-box', '<p><slot id="ID"></slot></p>');
  define('x-fallback', '<p><slot id="ID"><b>Fallback element</b></slot></p>');
  define('x-outer', '<x-box id="inner"><slot id="ID"></slot></x-box>');
</script>`;

/** Slot measurement pages by path */
export const ROUTES: FixtureRoutes = {
  '/slots': SLOTS_HTML,
};
