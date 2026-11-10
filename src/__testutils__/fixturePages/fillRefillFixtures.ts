/**
 * Fixture page for re-filling a field that already shows the page's format
 * of the value (#930), served by the fixture server: `/fill-refill`
 * (`lang="en"`). Each field rewrites its value 300 ms after the last input.
 *
 * - `#phone` ("Phone") writes a 10-digit number with a trunk zero as
 *   `+33 6 12 34 56 78`.
 * - `#amount` ("Betrag") writes a number with two decimals and a decimal
 *   comma (`8` shows as `8,00`).
 * - `#date` ("Date") writes an ISO date out as `10 November 2026`.
 * - `#hours` ("Hours") holds `0.00` and puts it back after any input (a
 *   revert: a fill of `8.00` must exit 90, the first time and again).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields that format the value given 300 ms later, and one that restores its old value */
const FILL_REFILL_HTML = `<!doctype html><html lang="en"><title>fill refill</title>
<label>Phone <input id="phone"></label>
<label>Betrag <input id="amount"></label>
<label>Date <input id="date"></label>
<label>Hours <input id="hours" value="0.00"></label>
<script>
  const later = (id, format) => {
    const el = document.getElementById(id);
    let timer;
    el.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { el.value = format(el.value); }, 300);
    });
  };
  later('phone', (text) => {
    const d = text.replace(/\\D/g, '');
    if (!/^0\\d{9}$/.test(d)) return text;
    return '+33 ' + d[1] + ' ' + d.slice(2).match(/\\d\\d/g).join(' ');
  });
  later('amount', (text) => {
    const n = parseFloat(text.replace(',', '.'));
    return isNaN(n) ? text : n.toFixed(2).replace('.', ',');
  });
  later('date', (text) => {
    const m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(text);
    if (!m) return text;
    const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  });
  later('hours', () => '0.00');
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-refill': FILL_REFILL_HTML,
};
