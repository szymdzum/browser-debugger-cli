/**
 * Fixture page for the secrets `network details`, `network headers` and
 * `network document` mask (#615), served by the fixture server.
 *
 * `/net-secrets` sets a cookie (`pre`), moves its own URL to one with
 * `?access_token=` (so later requests send it in `Referer`), then sends in
 * turn: a urlencoded form with a `password` field and a Bearer
 * `Authorization`, `X-API-Key` and `X-CSRF-Token` headers to `/net-form`; a JSON body
 * with a `password` and a nested `api_key` to `/net-json`; a multipart body
 * with a `password` part and an ordinary `note` part to `/net-upload`; a POST
 * to `/har-login` (a JSON response with `access_token` and `refresh_token`,
 * and a `har_session` cookie); and a JSON WebSocket message with a `token`
 * and a plain-text `Bearer` message to the echo server at `/ws`. The title
 * becomes `done` when both echoes came back. `/net-form`, `/net-json` and `/net-upload` answer `ok`.
 *
 * Every secret value ends in {@link NETWORK_SECRET_MARKER}, assembled in the
 * script so the page source holds none.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Text at the end of every secret value the page sends */
export const NETWORK_SECRET_MARKER = '-S615';

/** A page that sends credentials in headers, bodies, a cookie, Referer and a WebSocket message */
const NET_SECRETS_HTML = `<!doctype html><title>network secrets</title>
<script>
const m = (name) => name + '-S6' + '15';
document.cookie = 'pre=' + m('PRECOOKIE') + '; path=/';
history.replaceState(null, '', '/net-secrets?access_token=' + m('REF') + '&lang=en');
const upload = new FormData();
upload.append('note', 'keep-me');
upload.append('password', m('MULTI'));
fetch('/net-form', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: 'Bearer ' + m('AUTH'),
    'X-API-Key': m('KEY'),
    'X-CSRF-Token': m('CSRF'),
  },
  body: 'user=tom&password=' + m('FORM'),
})
  .then(() => fetch('/net-json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'tom', password: m('JSON'), profile: { api_key: m('NESTED'), city: 'Leeds' } }),
  }))
  .then(() => fetch('/net-upload', { method: 'POST', body: upload }))
  .then(() => fetch('/har-login', { method: 'POST', body: 'x' }))
  .then(() => {
    const socket = new WebSocket(location.origin.replace('http', 'ws') + '/ws');
    let echoes = 0;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token: m('WS'), room: 'lobby' }));
      socket.send('Bearer ' + m('WB'));
    };
    socket.onmessage = () => { if (++echoes === 2) document.title = 'done'; };
  });
</script>`;

/** Network secret pages by path */
export const ROUTES: FixtureRoutes = {
  '/net-secrets': NET_SECRETS_HTML,
  '/net-form': 'ok',
  '/net-json': 'ok',
  '/net-upload': 'ok',
};
