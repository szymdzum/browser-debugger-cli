/**
 * Fixture pages for the second late read of `dom fill` (#940), served by the
 * fixture server. Each page writes `draft-9f3ac2` into `#f` 300 ms after the
 * first `input` (the page replaces the value: the fill must exit 90).
 *
 * - `/fill-reread-control`: the page's timers run.
 * - `/fill-reread-frozen`: `setTimeout` replaced with a no-op, as fake timers do;
 *   the page writes the draft through the real one.
 * - `/fill-reread-navigates`: navigates to `/fill-reread-control` 2350 ms after the
 *   first `input`, between the late read (about 2 s) and the read 500 ms after it.
 * - `/fill-reread-busy`: runs a 2 s script 2350 ms after the first `input`, so the
 *   read 500 ms after the late read gets no answer within 1 s.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/**
 * Build a page whose `#f` is replaced by `draft-9f3ac2` after the first input.
 *
 * @param title - Page title
 * @param setup - Script run before the field is wired (gets `real`, the page's own setTimeout)
 * @param later - Script run 2350 ms after the first input, or none
 * @returns HTML of the page
 */
function rereadPage(title: string, setup = '', later = ''): string {
  return `<!doctype html><title>${title}</title>
<label>Note <input id="f"></label>
<script>
  const real = window.setTimeout.bind(window);
  ${setup}
  const f = document.getElementById('f');
  let started = false;
  f.addEventListener('input', () => {
    real(() => { f.value = 'draft-9f3ac2'; }, 300);
    if (started) return;
    started = true;
    ${later ? `real(() => { ${later} }, 2350);` : ''}
  });
</script>`;
}

/** Second-read pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-reread-control': rereadPage('fill reread control'),
  '/fill-reread-frozen': rereadPage('fill reread frozen', 'window.setTimeout = () => 0;'),
  '/fill-reread-navigates': rereadPage(
    'fill reread navigates',
    '',
    "location.href = '/fill-reread-control';"
  ),
  '/fill-reread-busy': rereadPage(
    'fill reread busy',
    '',
    'const end = performance.now() + 2000; while (performance.now() < end) {}'
  ),
};
