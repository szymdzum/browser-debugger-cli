/**
 * Fixture page for `dom fill` into fields the page rewrites synchronously,
 * while the fill runs (#901), served by the fixture server:
 * `/fill-immediate-format`.
 *
 * - `#post` ("Postcode") is upper-cased on `blur` (formatting: `sw1a 1aa` shows as `SW1A 1AA`).
 * - `#ph` ("Phone") gets a phone mask on `input` once it holds 10 digits
 *   (formatting: `5551234567` shows as `(555) 123-4567`).
 * - `#note` ("Delivery note") holds `draft-<hex>` and writes a fresh one on `change`
 *   (the page replaces the input with unrelated text: the fill must exit 90).
 * - `#city` ("City") holds `Berlin` and puts it back on `change` (a return to the old
 *   value: the fill must exit 90).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields formatted, replaced or restored synchronously */
const FILL_IMMEDIATE_FORMAT_HTML = `<!doctype html><title>fill immediate format</title>
<label>Postcode <input id="post"></label>
<label>Phone <input id="ph"></label>
<label>Delivery note <input id="note"></label>
<label>City <input id="city" value="Berlin"></label>
<script>
  const byId = (id) => document.getElementById(id);
  const draft = () => 'draft-' + [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  byId('post').addEventListener('blur', () => { byId('post').value = byId('post').value.toUpperCase(); });
  byId('ph').addEventListener('input', () => {
    const d = byId('ph').value.replace(/\\D/g, '');
    if (d.length === 10) byId('ph').value = '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  });
  byId('note').value = draft();
  byId('note').addEventListener('change', () => { byId('note').value = draft(); });
  byId('city').addEventListener('change', () => { byId('city').value = 'Berlin'; });
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-immediate-format': FILL_IMMEDIATE_FORMAT_HTML,
};
