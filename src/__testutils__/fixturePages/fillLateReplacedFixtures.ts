/**
 * Fixture page for `dom fill` into fields the page rewrites after the fill,
 * either replacing the input with unrelated text or formatting it (#906),
 * served by the fixture server: `/fill-late-replaced`.
 *
 * - `#note` ("Delivery note") holds `draft-<hex>`; 1200 ms after the last `input` or `change`
 *   the page writes a fresh `draft-<hex>` (it rejects the input; the fill must exit 90).
 * - `#address` turns `1 main st` into `1 Main Street, Springfield, IL 62701` 300 ms after
 *   `change` (a server-normalised address: formatting, the fill must succeed).
 * - `#station` streams a suggestion after the last `input`: `Wars` at 300 ms, `Warsaw Ce` at
 *   1000 ms, `Warsaw Central Station` at 2400 ms (still changing at the 2 s read).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields replaced, normalised or streamed after the fill */
const FILL_LATE_REPLACED_HTML = `<!doctype html><title>fill late replaced</title>
<label>Delivery note <input id="note"></label>
<label>Address <input id="address"></label>
<label>Station <input id="station"></label>
<script>
  const byId = (id) => document.getElementById(id);
  const draft = () => 'draft-' + [...crypto.getRandomValues(new Uint8Array(3))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  byId('note').value = draft();
  let noteTimer;
  const restoreDraft = () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { byId('note').value = draft(); }, 1200);
  };
  byId('note').addEventListener('input', restoreDraft);
  byId('note').addEventListener('change', restoreDraft);
  byId('address').addEventListener('change', (event) => setTimeout(() => {
    if (/^1 main st$/i.test(event.target.value)) event.target.value = '1 Main Street, Springfield, IL 62701';
  }, 300));
  let streamTimers = [];
  byId('station').addEventListener('input', () => {
    streamTimers.forEach(clearTimeout);
    streamTimers = [[300, 'Wars'], [1000, 'Warsaw Ce'], [2400, 'Warsaw Central Station']]
      .map(([ms, text]) => setTimeout(() => { byId('station').value = text; }, ms));
  });
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-late-replaced': FILL_LATE_REPLACED_HTML,
};
