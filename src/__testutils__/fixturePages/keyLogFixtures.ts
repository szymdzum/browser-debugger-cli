/**
 * Fixture page for the key names of `dom pressKey` (#612), served by the
 * fixture server: `/key-log` has a text field (`#field`) and logs every
 * `keydown` it gets, as `key|code|shiftKey` in a `<li>` of `#log` and as an
 * entry of `window.keyLog`, so a test reads exactly what the page saw
 * (the page also logs `keypress` text in `window.typed`).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A field and the record of the keydown events it gets */
const KEY_LOG_HTML = `<!doctype html><title>key log</title>
<input id="field" aria-label="Field">
<ol id="log"></ol>
<script>
  window.keyLog = [];
  window.typed = [];
  const field = document.getElementById('field');
  field.addEventListener('keydown', (event) => {
    const entry = [event.key, event.code, String(event.shiftKey)].join('|');
    window.keyLog.push(entry);
    const item = document.createElement('li');
    item.textContent = entry;
    document.getElementById('log').append(item);
  });
  field.addEventListener('keypress', (event) => window.typed.push(event.key));
</script>`;

/** Key log pages by path */
export const ROUTES: FixtureRoutes = {
  '/key-log': KEY_LOG_HTML,
};
