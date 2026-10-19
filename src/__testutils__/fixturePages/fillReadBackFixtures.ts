/**
 * Fixture page for the read-back of `dom fill` (#867), served by the fixture
 * server: `/fill-read-back` has fields that keep, reformat or change the
 * value filled. `type="number"` fields: `#num` keeps it, `#num-clamp` sets
 * `24` on input. `type="text"` fields reformatting on blur: `#money` as
 * `$8.00` (`$1,234.50`; text it cannot read is emptied), `#pct` as `5.20%`,
 * `#clamp` raises a number below 24 to `24.00`, `#eu` writes a decimal
 * comma (`8,00`). `#plain` keeps what it gets, and the password `#pin`
 * empties itself on blur.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields that keep, reformat or change the value filled */
const FILL_READ_BACK_HTML = `<!doctype html><title>fill read-back</title>
<form onsubmit="return false">
  <label>Number <input id="num" type="number"></label>
  <label>Clamped number <input id="num-clamp" type="number"></label>
  <label>Amount <input id="money" type="text"></label>
  <label>Rate <input id="pct" type="text"></label>
  <label>Hours <input id="clamp" type="text"></label>
  <label>Betrag <input id="eu" type="text"></label>
  <label>Note <input id="plain" type="text"></label>
  <label>PIN <input id="pin" type="password"></label>
</form>
<script>
  const onBlur = (id, format) => {
    const el = document.getElementById(id);
    el.addEventListener('blur', () => { el.value = format(el.value); });
  };
  const amount = (text) => {
    const n = parseFloat(text);
    if (isNaN(n)) return '';
    return '$' + n.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');
  };
  onBlur('money', amount);
  onBlur('pct', (text) => parseFloat(text).toFixed(2) + '%');
  onBlur('clamp', (text) => Math.max(24, parseFloat(text)).toFixed(2));
  onBlur('eu', (text) => parseFloat(text).toFixed(2).replace('.', ','));
  onBlur('pin', () => '');
  const clamp = document.getElementById('num-clamp');
  clamp.addEventListener('input', () => { clamp.value = '24'; });
</script>`;

/** Read-back pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-read-back': FILL_READ_BACK_HTML,
};
