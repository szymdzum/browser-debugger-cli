/**
 * Fixture pages for page URLs with credentials (#623), served by the fixture
 * server. The smoke test opens {@link URL_CREDS_PATH} (a `?token=` in its
 * query; the server matches the path with its query) through a URL with
 * `user:pass@` and a `#id_token=`.
 *
 * The page has links to `/url-creds-landing` with secret-named query
 * parameters (`access_token`, `code`; `password`, `cc-number`) and with an
 * `#id_token=` fragment, a button that opens {@link URL_CREDS_POPUP_PATH} in
 * a window, a button that fetches {@link URL_CREDS_API_PATH} and opens a
 * WebSocket to `/ws?token=` (the title becomes `fetched` once both
 * answered), and a form posting to `/url-creds-landing`. The hrefs are
 * assembled in the script, so the page source holds no secret value.
 * `/url-creds-landing` and the popup are short pages; the links with a
 * query get the fixture server's default page.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Text at the end of every secret value of the pages */
export const URL_SECRET_MARKER = '-U623';

/** Path and query of the page the session starts on */
export const URL_CREDS_PATH = `/url-creds?token=QT-SESSION${URL_SECRET_MARKER}&q=plain`;

/** Path and query the fetch button requests */
export const URL_CREDS_API_PATH = `/url-creds-api?access_token=QT-FETCH${URL_SECRET_MARKER}&q=plain`;

/** Path and query of the window the popup button opens */
export const URL_CREDS_POPUP_PATH = `/url-creds-popup?token=QT-POPUP${URL_SECRET_MARKER}`;

/** The page the session starts on */
const URL_CREDS_HTML = `<!doctype html><title>url creds</title>
<a id="go-tokens" href="#">Tokens</a>
<a id="go-card" href="#">Card</a>
<a id="go-hash" href="#">Hash</a>
<button id="open-popup">Popup</button>
<button id="fetch">Fetch</button>
<form id="login" action="/url-creds-landing" method="post"><input name="user"><button>Send</button></form>
<script>
const m = (name) => name + '-U6' + '23';
document.getElementById('go-tokens').href = '/url-creds-landing?access_token=' + m('QT-ACCESS') + '&code=' + m('QT-CODE') + '&q=plain';
document.getElementById('go-card').href = '/url-creds-landing?password=' + m('QT-PASS') + '&cc-number=4111111111111111';
document.getElementById('go-hash').href = '/url-creds-landing#id_token=' + m('QT-HASH');
document.getElementById('open-popup').onclick = () => {
  window.open('/url-creds-popup?token=' + m('QT-POPUP'), 'popup', 'width=400,height=400');
};
document.getElementById('fetch').onclick = () => {
  const fetched = fetch('/url-creds-api?access_token=' + m('QT-FETCH') + '&q=plain');
  const echoed = new Promise((resolve) => {
    const socket = new WebSocket(location.origin.replace('http', 'ws') + '/ws?token=' + m('QT-WS'));
    socket.onopen = () => socket.send('hello');
    socket.onmessage = () => { socket.close(); resolve(); };
    socket.onerror = () => resolve();
  });
  Promise.all([fetched, echoed]).then(() => { document.title = 'fetched'; });
};
</script>`;

/** Where the links and the form lead */
const LANDING_HTML = `<!doctype html><title>landing</title><h1 id="landing">Landed</h1>`;

/** The window the button opens */
const POPUP_HTML = `<!doctype html><title>popup</title><h1 id="popup">Popup</h1>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  [URL_CREDS_PATH]: URL_CREDS_HTML,
  '/url-creds-landing': LANDING_HTML,
  [URL_CREDS_POPUP_PATH]: POPUP_HTML,
  [URL_CREDS_API_PATH]: '{"ok":true}',
};
