/**
 * Fixture pages for the "nothing observed" verdict of a click or key press
 * (#891), served by the fixture server.
 *
 * - `/verdict-props`: buttons whose handler changes a form control's property
 *   (no DOM mutation), toggling it so each click changes it: `#val` flips
 *   `input#i1.value` between a and b, `#chk` `input#cb.checked`, `#sel`
 *   `select#s1.selectedIndex`; `#frame-text` flips the text of `div#o` in the
 *   same-origin `iframe#f`, `#frame-val` the value of its `input#fi`; Enter
 *   in `input#q3` (the key handler cancels the submit) flips `#cb2.checked`;
 *   `#late` writes "Late result arrived" into `div#r` 1500 ms after the click; `#noop` has no handler and `#fb` only gets a
 *   `:focus` outline.
 * - `/verdict-frame-ticker`: a same-origin `iframe#f` whose own script
 *   replaces the text of its `div#o` every 250 ms (counting in the top
 *   window's `ticks`); `#noop` has no handler, `#frame-text` writes a result
 *   into the frame's `div#res`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Controls whose properties a click changes, a same-origin frame, a late result */
const VERDICT_PROPS_HTML = `<!doctype html><title>verdict props</title>
<style>#fb:focus { outline: 4px solid red }</style>
<p><button id="noop">Noop</button> <button id="fb">Focus only</button></p>
<p><input id="i1" value="a" aria-label="Value"> <button id="val">Set value</button></p>
<p><input type="checkbox" id="cb" aria-label="Check"> <button id="chk">Toggle</button></p>
<p><select id="s1" aria-label="Pick"><option>a</option><option>b</option></select> <button id="sel">Select b</button></p>
<iframe id="f" srcdoc="<div id=o>x</div><input id=fi value=a aria-label=Inner>"></iframe>
<p><button id="frame-text">Frame text</button> <button id="frame-val">Frame value</button></p>
<form id="search" onsubmit="return false"><input id="q3" aria-label="Query"> <input id="q4" aria-label="Other"></form>
<input type="checkbox" id="cb2" aria-label="Found">
<p><button id="late">Late</button></p><div id="r"></div>
<script>
  const byId = (id) => document.getElementById(id);
  byId('val').addEventListener('click', () => { byId('i1').value = byId('i1').value === 'a' ? 'b' : 'a'; });
  byId('chk').addEventListener('click', () => { byId('cb').checked = !byId('cb').checked; });
  byId('sel').addEventListener('click', () => { byId('s1').selectedIndex = 1 - byId('s1').selectedIndex; });
  byId('frame-text').addEventListener('click', () => {
    const o = byId('f').contentDocument.getElementById('o');
    o.textContent = o.textContent === 'x' ? 'set from outer' : 'x';
  });
  byId('frame-val').addEventListener('click', () => {
    const fi = byId('f').contentDocument.getElementById('fi');
    fi.value = fi.value === 'a' ? 'z' : 'a';
  });
  byId('q3').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); byId('cb2').checked = !byId('cb2').checked; }
  });
  byId('late').addEventListener('click', () => {
    setTimeout(() => { byId('r').textContent = 'Late result arrived'; }, 1500);
  });
</script>`;

/** A same-origin frame that updates itself every 250 ms */
const VERDICT_FRAME_TICKER_HTML = `<!doctype html><title>verdict frame ticker</title>
<p><button id="noop">Noop</button> <button id="frame-text">Frame text</button></p>
<iframe id="f" srcdoc="<div id=o>ad 0</div><div id=res></div><script>let n = 0; setInterval(() => { n++; document.getElementById('o').textContent = 'ad ' + n; parent.ticks = n; }, 250);</script>"></iframe>
<script>
  window.ticks = 0;
  document.getElementById('frame-text').addEventListener('click', () => {
    document.getElementById('f').contentDocument.getElementById('res').textContent = 'Result here';
  });
</script>`;

/** Verdict pages by path */
export const ROUTES: FixtureRoutes = {
  '/verdict-props': VERDICT_PROPS_HTML,
  '/verdict-frame-ticker': VERDICT_FRAME_TICKER_HTML,
};
