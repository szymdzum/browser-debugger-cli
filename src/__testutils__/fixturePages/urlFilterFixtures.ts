/**
 * Fixture page for the `url:` network filter (#652), served by the fixture
 * server. The smoke test opens {@link URL_FILTER_PATH} through a URL with
 * `user:pass@`; the page (fetching through `location.origin`, as `fetch`
 * refuses a URL with credentials) then fetches three URLs and sets its title to
 * `done`:
 * - `/uf-api/v2/items` with `access_token=` and a plain `q`,
 * - `/uf-api/v1/ping` with `token=abcdef`,
 * - `/uf-cdn/logo.png`.
 * None of the paths holds the word `user`. The three get the fixture
 * server's default page.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Path of the page the session starts on */
export const URL_FILTER_PATH = '/url-filter';

/** Value of the `access_token` parameter the page sends */
export const URL_FILTER_SECRET = 'QT-UF-U652';

/** The page: three fetches, then the title becomes `done` */
const URL_FILTER_HTML = `<!doctype html><title>loading</title>
<script>
const origin = location.origin;
const secret = 'QT-UF-' + 'U652';
Promise.all([
  fetch(origin + '/uf-api/v2/items?access_token=' + secret + '&q=1'),
  fetch(origin + '/uf-api/v1/ping?token=abcdef'),
  fetch(origin + '/uf-cdn/logo.png'),
]).then(() => { document.title = 'done'; });
</script>`;

/** URL filter pages by path */
export const ROUTES: FixtureRoutes = {
  [URL_FILTER_PATH]: URL_FILTER_HTML,
};
