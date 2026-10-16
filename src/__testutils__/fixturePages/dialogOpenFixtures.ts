/**
 * Fixture pages for pre-rendered `<dialog>` elements an action opens (#786),
 * served by the fixture server.
 *
 * - `/dialog-open`: buttons that open a dialog already in the DOM, each with
 *   its own text: `#modal` (`showModal()`), `#attr` (`setAttribute('open')`),
 *   `#shadow` (`showModal()` on a dialog in the open shadow root of `x-host`),
 *   `#fade` (`open` on a dialog that fades in from opacity 0) and `#key`
 *   (opens on click, for `pressKey` Enter). `#secret` opens a dialog holding
 *   only a password field.
 * - `/dialog-quiet`: effects that must not report a dialog. `#tick-dialog` is
 *   closed and reopened by an interval (`window.dialogTicks` counts the
 *   reopenings), `#already` is open from the start, `#close` closes
 *   `#already`, `#noop` does nothing, `#pop` shows a `popover`, `#sum` is a
 *   `<details>` summary.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Buttons that open pre-rendered dialogs */
const DIALOG_OPEN_HTML = `<!doctype html><title>dialog open</title>
<style>#fade-dialog { opacity: 0; transition: opacity 0.2s; } #fade-dialog[open] { opacity: 1; }</style>
<main>
<button id="modal">Open modal</button>
<button id="attr">Open attr</button>
<button id="shadow">Open shadow</button>
<button id="fade">Open fade</button>
<button id="key">Open key</button>
<button id="secret">Open secret</button>
<x-host></x-host>
</main>
<dialog id="modal-dialog"><p>Modal opened</p></dialog>
<dialog id="attr-dialog"><p>Attribute opened</p></dialog>
<dialog id="fade-dialog"><p>Fade opened</p></dialog>
<dialog id="key-dialog"><p>Key opened</p></dialog>
<dialog id="secret-dialog"><input type="password" aria-label="Password" value="hunter2"></dialog>
<script>
  const host = document.querySelector('x-host');
  host.attachShadow({ mode: 'open' }).innerHTML = '<dialog id="shadow-dialog"><p>Shadow opened</p></dialog>';
  const byId = (id) => document.getElementById(id);
  byId('modal').addEventListener('click', () => byId('modal-dialog').showModal());
  byId('attr').addEventListener('click', () => byId('attr-dialog').setAttribute('open', ''));
  byId('shadow').addEventListener('click', () => host.shadowRoot.getElementById('shadow-dialog').showModal());
  byId('fade').addEventListener('click', () => byId('fade-dialog').setAttribute('open', ''));
  byId('key').addEventListener('click', () => byId('key-dialog').showModal());
  byId('secret').addEventListener('click', () => byId('secret-dialog').showModal());
</script>`;

/** Effects that open no dialog, with a dialog the page keeps reopening */
const DIALOG_QUIET_HTML = `<!doctype html><title>dialog quiet</title>
<main>
<button id="noop">Nothing</button>
<button id="close">Close</button>
<button id="pop" popovertarget="pop-box">Popover</button>
<details><summary id="sum">Details</summary><p>More text</p></details>
</main>
<div id="pop-box" popover>Popover text</div>
<dialog id="already" open><p>Already open</p></dialog>
<dialog id="tick-dialog"><p>Ticking dialog</p></dialog>
<script>
  window.dialogTicks = 0;
  const tick = document.getElementById('tick-dialog');
  setInterval(() => {
    tick.removeAttribute('open');
    tick.setAttribute('open', '');
    window.dialogTicks++;
  }, 20);
  document.getElementById('close').addEventListener('click', () => document.getElementById('already').close());
</script>`;

export const ROUTES: FixtureRoutes = {
  '/dialog-open': DIALOG_OPEN_HTML,
  '/dialog-quiet': DIALOG_QUIET_HTML,
};
