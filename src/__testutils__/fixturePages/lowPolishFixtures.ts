/**
 * Fixture pages for the low-priority polish items of #644, #646, #567 and
 * #458, served by the fixture server.
 *
 * `/polish-forms` has a form with a text field and an `<input type="image">`
 * submit button (`#pictured`), a form whose two fields share an id and so
 * have one `<label for>` target (`#dupes`), and a form whose button is named
 * by `aria-labelledby` (`#named`). `/polish-net` POSTs a multipart body with
 * a file part to `/polish-upload` and fetches two missing pages, so the
 * console holds two 404 errors that differ only by URL; its title becomes
 * `done` when all three requests finished.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Forms whose buttons and labels `dom form` used to get wrong */
const POLISH_FORMS_HTML = `<!doctype html><title>polish forms</title>
<form id="pictured" onsubmit="return false">
  <label for="term">Term</label><input id="term" name="term">
  <input type="image" alt="Search now" width="20" height="20"
    src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
</form>
<form id="dupes" onsubmit="return false">
  <input id="a1" name="first"><input id="a1" name="phone">
</form>
<label for="a1">Name</label><label for="a1">Phone</label>
<form id="named" onsubmit="return false">
  <input name="q" aria-label="Query"><span id="hl">Hover me</span><button aria-labelledby="hl">btn</button>
</form>`;

/** A multipart upload with a file part and two failing fetches */
const POLISH_NET_HTML = `<!doctype html><title>polish net</title>
<script>
const upload = new FormData();
upload.append('note', 'hello');
upload.append('file', new Blob(['file body'], { type: 'text/plain' }), 'a.txt');
Promise.all([
  fetch('/polish-upload', { method: 'POST', body: upload }),
  fetch('/missing-page'),
  fetch('/spa-missing'),
]).then(() => { document.title = 'done'; });
</script>`;

export const ROUTES: FixtureRoutes = {
  '/polish-forms': POLISH_FORMS_HTML,
  '/polish-net': POLISH_NET_HTML,
};
