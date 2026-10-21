/**
 * Fixture pages for the agent eval harness (`scripts/agent-eval.mjs`), served
 * by the fixture server. Each page backs one task whose answer the harness
 * knows (`scripts/agent-eval-tasks.mjs`). The pages are static, so the answer
 * is not in them: the task URL carries `?n=<nonce>&api=<value server>`, and a
 * page asks the harness's value server for `/value?key=<task>&n=<nonce>` only
 * when the interaction the task is about happens (a click, a sign-in, a load),
 * then shows the value. The value differs per run, so the page source (read
 * with `dom get --raw` or curl) holds no answer.
 *
 * - `/eval-signin` opens `/eval-signin-popup`, whose button posts
 *   `tk-<value>` to the opener; the opener shows it.
 * - `/eval-confirm` asks `confirm()` when `Remove order` is clicked and then
 *   shows `Order A-<value> kept` (cancelled) or `Order A-<value> removed`.
 * - `/eval-buttons` has five buttons; the value is a 5-bit mask that says which
 *   break (by position: a throw, a rejected promise, a throw from a timer);
 *   the others only warn.
 * - `/eval-shadow-login` has a sign-in form in an open shadow root; the
 *   credentials `ada@example.com` / `hunter22` show `Reference R-<value>`.
 * - `/eval-net-a` links to `/eval-net-b`; each fetches one missing JSON file
 *   whose name holds a value (`/eval-net-a-<value>.json`).
 * - `/eval-download` saves `q3-report-<value>.csv` from a Blob on click.
 * - `/eval-console` logs a warning, an info line and one error with code
 *   `E-<value>` once the value arrives.
 * - `/eval-classes` has two sign-up looking links; the real one carries eight
 *   utility classes and gets a ninth, `id-<value>`, at load.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Script that defines `value(key)`: the run's value for a task, from the harness's value server */
const VALUE_SCRIPT = `const query = new URLSearchParams(location.search);
  const value = (key) => fetch(query.get('api') + '/value?key=' + key + '&n=' + query.get('n')).then((r) => r.text());`;

/** Opener that shows the token its sign-in window posts back */
const SIGNIN_HTML = `<!doctype html><title>Account</title>
<h1>Account</h1>
<button id="open">Sign in</button>
<p id="status">Not signed in</p>
<script>
  document.getElementById('open').addEventListener('click', () => {
    window.open('/eval-signin-popup' + location.search, 'signin', 'width=420,height=520');
  });
  addEventListener('message', (event) => {
    document.getElementById('status').textContent = 'Signed in. Token: ' + event.data;
  });
</script>`;

/** Sign-in window that fetches the token, posts it and closes */
const SIGNIN_POPUP_HTML = `<!doctype html><title>Sign in</title>
<h1>Authorize</h1>
<button id="allow">Allow</button>
<script>
  ${VALUE_SCRIPT}
  document.getElementById('allow').addEventListener('click', () => {
    value('popup-token').then((v) => {
      window.opener.postMessage('tk-' + v, '*');
      window.close();
    });
  });
</script>`;

/** Page that confirms before removing an order */
const CONFIRM_HTML = `<!doctype html><title>Orders</title>
<h1>Orders</h1>
<p id="status">The order is active</p>
<button id="remove">Remove order</button>
<script>
  ${VALUE_SCRIPT}
  document.getElementById('remove').addEventListener('click', () => {
    const removed = confirm('Remove this order? This cannot be undone.');
    value('cancel-confirm').then((v) => {
      document.getElementById('status').textContent = 'Order A-' + v + (removed ? ' removed' : ' kept');
    });
  });
</script>`;

/** Page with five buttons; a mask from the value server says which ones break */
const BUTTONS_HTML = `<!doctype html><title>Buttons</title>
<h1>Buttons</h1>
<button>Alpha</button>
<button>Bravo</button>
<button>Charlie</button>
<button>Delta</button>
<button>Echo</button>
<script>
  ${VALUE_SCRIPT}
  const breakers = [
    () => { throw new Error('button exploded'); },
    () => { Promise.reject(new Error('button rejected')); },
    () => { setTimeout(() => { throw new Error('button timer exploded'); }, 0); },
  ];
  value('breaking-buttons').then((mask) => {
    document.querySelectorAll('button').forEach((button, i) => {
      button.addEventListener('click', mask[i] === '1' ? breakers[i % 3] : () => console.warn('button is slow'));
    });
  });
</script>`;

/** Sign-in form inside an open shadow root */
const SHADOW_LOGIN_HTML = `<!doctype html><title>Portal</title>
<h1>Portal</h1>
<portal-login></portal-login>
<p id="result"></p>
<script>
  ${VALUE_SCRIPT}
  customElements.define('portal-login', class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<form><label>Email <input name="email" type="text"></label>' +
        '<label>Passphrase <input name="passphrase" type="password"></label>' +
        '<button type="submit">Sign in</button></form>';
      root.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        const email = root.querySelector('[name=email]').value;
        const passphrase = root.querySelector('[name=passphrase]').value;
        const result = document.getElementById('result');
        if (email !== 'ada@example.com' || passphrase !== 'hunter22') {
          result.textContent = 'Wrong credentials';
          return;
        }
        value('shadow-login').then((v) => {
          result.textContent = 'Signed in as ' + email + '. Reference R-' + v;
        });
      });
    }
  });
</script>`;

/** First page of the pair: a failing fetch of its own and a link on */
const NET_A_HTML = `<!doctype html><title>Page A</title>
<h1>Page A</h1>
<a id="next" href="/eval-net-b">Next page</a>
<script>
  ${VALUE_SCRIPT}
  document.getElementById('next').href = '/eval-net-b' + location.search;
  value('failed-request-page-two-a').then((v) => fetch('/eval-net-a-' + v + '.json')).catch(() => {});
</script>`;

/** Second page: its own failing fetch and one that works */
const NET_B_HTML = `<!doctype html><title>Page B</title>
<h1>Page B</h1>
<script>
  ${VALUE_SCRIPT}
  fetch('/api/test').catch(() => {});
  value('failed-request-page-two').then((v) => fetch('/eval-net-b-' + v + '.json')).catch(() => {});
</script>`;

/** Page whose button saves a CSV from a Blob, named from the value */
const DOWNLOAD_HTML = `<!doctype html><title>Reports</title>
<h1>Reports</h1>
<button id="get">Download report</button>
<script>
  ${VALUE_SCRIPT}
  document.getElementById('get').addEventListener('click', () => {
    value('download-name').then((v) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob(['quarter,total\\nQ3,1200\\n'], { type: 'text/csv' }));
      link.download = 'q3-report-' + v + '.csv';
      document.body.append(link);
      link.click();
      link.remove();
    });
  });
</script>`;

/** Page that logs a warning, an info line and one error with a code from the value */
const CONSOLE_HTML = `<!doctype html><title>Checkout</title>
<h1>Checkout</h1>
<script>
  ${VALUE_SCRIPT}
  console.info('checkout script ready');
  console.warn('Deprecated API used (code W-1010)');
  value('console-error-code').then((v) => console.error('Payment widget failed to load (code E-' + v + ')'));
</script>`;

/** Page with a sign-up link whose last class is added from the value, and a plain log-in link */
const CLASSES_HTML = `<!doctype html><title>Welcome</title>
<h1>Welcome</h1>
<a href="/eval-login" class="px-4 py-2">Log in</a>
<a id="register" href="/eval-register" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 focus:ring-2">Create account</a>
<script>
  ${VALUE_SCRIPT}
  value('utility-classes').then((v) => document.getElementById('register').classList.add('id-' + v));
</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/eval-signin': SIGNIN_HTML,
  '/eval-signin-popup': SIGNIN_POPUP_HTML,
  '/eval-confirm': CONFIRM_HTML,
  '/eval-buttons': BUTTONS_HTML,
  '/eval-shadow-login': SHADOW_LOGIN_HTML,
  '/eval-net-a': NET_A_HTML,
  '/eval-net-b': NET_B_HTML,
  '/eval-download': DOWNLOAD_HTML,
  '/eval-console': CONSOLE_HTML,
  '/eval-classes': CLASSES_HTML,
};
