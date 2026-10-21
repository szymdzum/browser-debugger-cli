/**
 * Fixture page for `dom fill` into fields the page changes after the fill
 * (#892), served by the fixture server: `/fill-late-revert`.
 *
 * Reverts (the fill must exit 90): `#r50`, `#r300`, `#r1500` put `o` back
 * 50/300/1500 ms after `input`; the checkbox `#cb` is unchecked 100 ms
 * after `change`; the select `#sel` goes back to `a` 100 ms after `change`;
 * `#ctl` is a controlled input (state kept by the page, re-rendered a frame
 * plus 30 ms after `input`) that takes digits only; `#remount-old` is
 * replaced 200 ms after `change` by a new `<input id="remount-old">`
 * holding `o` (a remount on a new key that resets the value); `#cleared`
 * is emptied 100 ms after `input` (a search box that submits by itself).
 *
 * Formatting and noise (the fill must succeed): `#phone` is masked
 * (`(555) 123-4567`) 300 ms after the last `input`; `#upper` is upper-cased
 * 400 ms after `blur`; `#trim` is trimmed 100 ms after `change`; `#auto` is
 * completed to `London` 200 ms after `input`; `#valid` only shows a message
 * 300 ms after `input`; `#remount-keep` is replaced 200 ms after `change`
 * by a new input holding the value filled; `#plain` changes another field
 * (`#other`) 300 ms after `input`, while `#tick` ticks every 100 ms.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields that revert, reformat or stay as filled after the fill */
const FILL_LATE_REVERT_HTML = `<!doctype html><title>fill late revert</title>
<label>R50 <input id="r50" value="o"></label>
<label>R300 <input id="r300" value="o"></label>
<label>R1500 <input id="r1500" value="o"></label>
<label>Agree <input id="cb" type="checkbox"></label>
<label>Size <select id="sel"><option value="a">a</option><option value="b">b</option></select></label>
<label>Controlled <input id="ctl" value="o"></label>
<label>Search <input id="cleared"></label>
<span id="remount-old-slot"><label>Remount old <input id="remount-old" value="o"></label></span>
<label>Phone <input id="phone" type="tel"></label>
<label>Upper <input id="upper"></label>
<label>Trim <input id="trim"></label>
<label>City <input id="auto"></label>
<label>Email <input id="valid"></label><span id="valid-error"></span>
<span id="remount-keep-slot"><label>Remount keep <input id="remount-keep" value="o"></label></span>
<label>Plain <input id="plain"></label>
<label>Other <input id="other" value="x"></label>
<div id="tick">0</div>
<script>
  const byId = (id) => document.getElementById(id);
  let ticks = 0;
  setInterval(() => { byId('tick').textContent = String(++ticks); }, 100);
  for (const [id, ms] of [['r50', 50], ['r300', 300], ['r1500', 1500]]) {
    byId(id).addEventListener('input', () => setTimeout(() => { byId(id).value = 'o'; }, ms));
  }
  byId('cleared').addEventListener('input', () => setTimeout(() => { byId('cleared').value = ''; }, 100));
  byId('cb').addEventListener('change', () => setTimeout(() => { byId('cb').checked = false; }, 100));
  byId('sel').addEventListener('change', () => setTimeout(() => { byId('sel').value = 'a'; }, 100));
  let state = 'o';
  byId('ctl').addEventListener('input', (event) => {
    if (/^\\d*$/.test(event.target.value)) state = event.target.value;
    requestAnimationFrame(() => setTimeout(() => { byId('ctl').value = state; }, 30));
  });
  const remount = (id, value) => {
    byId(id).addEventListener('change', (event) => {
      const kept = value === undefined ? event.target.value : value;
      setTimeout(() => {
        byId(id + '-slot').innerHTML = '<label>Remounted <input id="' + id + '"></label>';
        byId(id).value = kept;
      }, 200);
    });
  };
  remount('remount-old', 'o');
  remount('remount-keep');
  let phoneTimer;
  byId('phone').addEventListener('input', (event) => {
    clearTimeout(phoneTimer);
    phoneTimer = setTimeout(() => {
      const d = event.target.value.replace(/\\D/g, '');
      if (d.length === 10) event.target.value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    }, 300);
  });
  byId('upper').addEventListener('blur', (event) =>
    setTimeout(() => { event.target.value = event.target.value.toUpperCase(); }, 400));
  byId('trim').addEventListener('change', (event) =>
    setTimeout(() => { event.target.value = event.target.value.trim(); }, 100));
  byId('auto').addEventListener('input', (event) => setTimeout(() => {
    if (event.target.value && 'london'.startsWith(event.target.value.toLowerCase())) event.target.value = 'London';
  }, 200));
  byId('valid').addEventListener('input', (event) => setTimeout(() => {
    byId('valid-error').textContent = event.target.value.includes('@') ? '' : 'Enter a valid email';
  }, 300));
  byId('plain').addEventListener('input', () => setTimeout(() => { byId('other').value = 'changed'; }, 300));
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-late-revert': FILL_LATE_REVERT_HTML,
};
