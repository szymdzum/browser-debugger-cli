/**
 * Fixture pages for the agent eval harness (`scripts/agent-eval.mjs`), served
 * by the fixture server. Each page backs one task whose answer the harness
 * knows (`scripts/agent-eval-tasks.mjs`); the values below are the truth, so
 * change them only together with that file.
 *
 * - `/eval-signin` opens `/eval-signin-popup`, which posts the token
 *   `tk-7f3a91` to the opener; the opener shows it.
 * - `/eval-confirm` asks `confirm()` before it removes an order and shows
 *   `Order A-4471 kept` when the question is cancelled.
 * - `/eval-buttons` has five buttons; Bravo throws, Delta rejects a promise
 *   and Echo throws from a timer, while Alpha and Charlie only work or warn.
 * - `/eval-shadow-login` has a sign-in form in an open shadow root; the
 *   credentials `ada@example.com` / `hunter22` show `Reference R-58213`.
 * - `/eval-net-a` links to `/eval-net-b`; each fetches one missing JSON file
 *   of its own.
 * - `/eval-download` saves `q3-report-8841.csv` from a Blob.
 * - `/eval-console` logs a warning, an info line and one error with a code.
 * - `/eval-classes` has two sign-up looking links; the real one carries nine
 *   utility classes.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Opener that shows the token its sign-in window posts back */
const SIGNIN_HTML = `<!doctype html><title>Account</title>
<h1>Account</h1>
<button id="open" onclick="window.open('/eval-signin-popup', 'signin', 'width=420,height=520')">Sign in</button>
<p id="status">Not signed in</p>
<script>
  addEventListener('message', (event) => {
    document.getElementById('status').textContent = 'Signed in. Token: ' + event.data;
  });
</script>`;

/** Sign-in window that posts the token and closes */
const SIGNIN_POPUP_HTML = `<!doctype html><title>Sign in</title>
<h1>Authorize</h1>
<button id="allow" onclick="window.opener.postMessage('tk-7f3a91', '*'); window.close()">Allow</button>`;

/** Page that confirms before removing an order */
const CONFIRM_HTML = `<!doctype html><title>Orders</title>
<h1>Orders</h1>
<p id="status">Order A-4471 is active</p>
<button id="remove" onclick="document.getElementById('status').textContent = confirm('Remove order A-4471? This cannot be undone.') ? 'Order A-4471 removed' : 'Order A-4471 kept'">Remove order</button>`;

/** Page with five buttons, three of which break */
const BUTTONS_HTML = `<!doctype html><title>Buttons</title>
<h1>Buttons</h1>
<button onclick="document.title = 'alpha clicked'">Alpha</button>
<button onclick="throw new Error('bravo exploded')">Bravo</button>
<button onclick="console.warn('charlie is slow')">Charlie</button>
<button onclick="Promise.reject(new Error('delta rejected'))">Delta</button>
<button onclick="setTimeout(() => { throw new Error('echo exploded'); }, 0)">Echo</button>`;

/** Sign-in form inside an open shadow root */
const SHADOW_LOGIN_HTML = `<!doctype html><title>Portal</title>
<h1>Portal</h1>
<portal-login></portal-login>
<p id="result"></p>
<script>
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
        document.getElementById('result').textContent =
          email === 'ada@example.com' && passphrase === 'hunter22'
            ? 'Signed in as ' + email + '. Reference R-58213'
            : 'Wrong credentials';
      });
    }
  });
</script>`;

/** First page of the pair: a failing fetch of its own and a link on */
const NET_A_HTML = `<!doctype html><title>Page A</title>
<h1>Page A</h1>
<a href="/eval-net-b">Next page</a>
<script>fetch('/eval-net-a-missing.json').catch(() => {});</script>`;

/** Second page: its own failing fetch and one that works */
const NET_B_HTML = `<!doctype html><title>Page B</title>
<h1>Page B</h1>
<script>
  fetch('/api/test').catch(() => {});
  fetch('/eval-net-b-missing.json').catch(() => {});
</script>`;

/** Page whose button saves a CSV from a Blob */
const DOWNLOAD_HTML = `<!doctype html><title>Reports</title>
<h1>Reports</h1>
<button id="get" onclick="
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(['quarter,total\\nQ3,1200\\n'], { type: 'text/csv' }));
  link.download = 'q3-report-8841.csv';
  document.body.append(link);
  link.click();
  link.remove();
">Download report</button>`;

/** Page that logs a warning, an info line and one error with a code */
const CONSOLE_HTML = `<!doctype html><title>Checkout</title>
<h1>Checkout</h1>
<script>
  console.info('checkout script ready');
  console.warn('Deprecated API used (code W-1010)');
  console.error('Payment widget failed to load (code E-5521)');
</script>`;

/** Page with a nine-class sign-up link and a plain log-in link */
const CLASSES_HTML = `<!doctype html><title>Welcome</title>
<h1>Welcome</h1>
<a href="/eval-login" class="px-4 py-2">Log in</a>
<a href="/eval-register" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 focus:ring-2 md:px-6">Create account</a>`;

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
