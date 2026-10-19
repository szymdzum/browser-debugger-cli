/**
 * Fixture page for `dom fill` into a field that puts its old value back
 * after the focus (#866), the way an old Telerik RadNumericTextBox rewrites
 * its edit value on focus, served by the fixture server:
 * `/fill-deferred-restore` has `type="text"` fields holding `0.00` whose
 * `focus` handler restores `0.00` in a `setTimeout(0)` (`#t0`), or whose
 * `focusin` handler does (`#fin`), a `<textarea>` (`#ta`) restoring in a
 * `focus` handler, and a plain field (`#plain`) that restores nothing. The
 * `input` events of the fields are noted in `window.inputLog` as
 * `id inputType data`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Text fields that restore `0.00` after the focus, and one that does not */
const FILL_DEFERRED_RESTORE_HTML = `<!doctype html><title>fill deferred restore</title>
<script>
  window.inputLog = [];
  document.addEventListener('input', (event) => {
    window.inputLog.push([event.target.id, event.inputType, event.data].join(' '));
  }, true);
</script>
<label>Timeout 0 <input id="t0" type="text" value="0.00"></label>
<label>Focusin <input id="fin" type="text" value="0.00"></label>
<label>Textarea <textarea id="ta">0.00</textarea></label>
<label>Plain <input id="plain" type="text" value="0.00"></label>
<script>
  const restore = (el) => setTimeout(() => { el.value = '0.00'; }, 0);
  const t0 = document.getElementById('t0');
  t0.addEventListener('focus', () => restore(t0));
  const ta = document.getElementById('ta');
  ta.addEventListener('focus', () => restore(ta));
  const fin = document.getElementById('fin');
  fin.addEventListener('focusin', () => restore(fin));
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-deferred-restore': FILL_DEFERRED_RESTORE_HTML,
};
