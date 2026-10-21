/**
 * Fixture pages for the agent eval harness (`scripts/agent-eval.mjs`), served
 * by the fixture server. Each page backs one task. The task URL carries
 * `?n=<nonce>&api=<log server>`. A page generates its per-run value with
 * `crypto.getRandomValues` inside the handler of the interaction the task is
 * about (a click, a login) or, where the task is about what a page does,
 * when it loads; it shows the value and POSTs what it showed to
 * `<api>/log?key=<task>&n=<nonce>`. The log server only records and never
 * answers a value, so no page source and no GET holds the answer: getting it
 * takes running the handler. There is no global helper; the code is inlined
 * in each handler.
 *
 * - `/eval-slot` opens `/eval-slot-popup`, whose Confirm slot button generates a
 *   confirmation code, posts `cf-<value>` to the opener (which shows it) and logs it.
 * - `/eval-confirm` asks `confirm()` when `Remove order` is clicked, then shows
 *   and logs `Order A-<value> kept` (cancelled) or `... removed`.
 * - `/eval-buttons` has five buttons; at load a random plan (at least one
 *   breaker, at least one that only warns) decides which break (by position: a throw, a rejected promise, a
 *   throw from a timer) or only warns, and logs `Label=1` or `Label=0`.
 * - `/eval-shadow-login` has a sign-in form in an open shadow root; the
 *   credentials `ada@example.com` / `hunter22` show and log `R-<value>`.
 * - `/eval-net-a` links to `/eval-net-b`; each fetches a missing JSON file
 *   whose name holds a value made at load; page B logs its path.
 * - `/eval-download` saves `q3-report-<value>.csv` from a Blob on click and logs the name.
 * - `/eval-console` logs a warning, an info line and, at load, one error with
 *   code `E-<value>`, which it also reports.
 * - `/eval-classes` has two sign-up looking links; the real one carries eight
 *   utility classes and gets a ninth, `id-<value>`, at load (logged).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Code for a fresh random value of six hex characters */
const RANDOM = `[...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('')`;

/**
 * Code that reports what the page showed to the log server (inlined in a handler, never global).
 *
 * @param key - Task key
 * @param text - JavaScript expression for the shown text
 * @returns Statement
 */
function report(key: string, text: string): string {
  return `fetch(new URLSearchParams(location.search).get('api') + '/log?key=${key}&n=' + new URLSearchParams(location.search).get('n'), { method: 'POST', body: ${text}, keepalive: true }).catch(() => {});`;
}

/** Opener that shows the confirmation code its slot window posts back */
const SLOT_HTML = `<!doctype html><title>Delivery</title>
<h1>Delivery</h1>
<button id="open">Choose a delivery slot</button>
<p id="status">No slot chosen</p>
<script>
  document.getElementById('open').addEventListener('click', () => {
    window.open('/eval-slot-popup' + location.search, 'slot', 'width=420,height=520');
  });
  addEventListener('message', (event) => {
    document.getElementById('status').textContent = 'Slot booked. Confirmation code: ' + event.data;
  });
</script>`;

/** Slot window that makes the confirmation code, reports it, posts it and closes */
const SLOT_POPUP_HTML = `<!doctype html><title>Delivery slots</title>
<h1>Pick a slot</h1>
<button id="allow">Confirm slot</button>
<script>
  document.getElementById('allow').addEventListener('click', () => {
    const code = 'cf-' + ${RANDOM};
    ${report('popup-code', 'code')}
    window.opener.postMessage(code, '*');
    window.close();
  });
</script>`;

/** Page that confirms before removing an order */
const CONFIRM_HTML = `<!doctype html><title>Orders</title>
<h1>Orders</h1>
<p id="status">The order is active</p>
<button id="remove">Remove order</button>
<script>
  document.getElementById('remove').addEventListener('click', () => {
    const removed = confirm('Remove this order? This cannot be undone.');
    const text = 'Order A-' + ${RANDOM} + (removed ? ' removed' : ' kept');
    document.getElementById('status').textContent = text;
    ${report('cancel-confirm', 'text')}
  });
</script>`;

/** Page with five buttons; each decides at its first click whether it breaks */
const BUTTONS_HTML = `<!doctype html><title>Buttons</title>
<h1>Buttons</h1>
<button>Alpha</button>
<button>Bravo</button>
<button>Charlie</button>
<button>Delta</button>
<button>Echo</button>
<script>
  (() => {
  const breakers = [
    () => { throw new Error('button exploded'); },
    () => { Promise.reject(new Error('button rejected')); },
    () => { setTimeout(() => { throw new Error('button timer exploded'); }, 0); },
  ];
  const plan = [...crypto.getRandomValues(new Uint8Array(5))].map((b) => b % 2 === 1);
  const count = plan.filter(Boolean).length;
  if (count === 0 || count === plan.length) {
    const flip = crypto.getRandomValues(new Uint8Array(1))[0] % plan.length;
    plan[flip] = !plan[flip];
  }
  document.querySelectorAll('button').forEach((button, i) => {
    let logged = false;
    button.addEventListener('click', () => {
      if (!logged) {
        logged = true;
        ${report('breaking-buttons', "button.textContent + '=' + (plan[i] ? 1 : 0)")}
      }
      if (plan[i]) breakers[i % 3]();
      else console.warn('button is slow');
    });
  });
  })();
</script>`;

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
        const result = document.getElementById('result');
        if (email !== 'ada@example.com' || passphrase !== 'hunter22') {
          result.textContent = 'Wrong credentials';
          return;
        }
        const reference = 'R-' + ${RANDOM};
        result.textContent = 'Signed in as ' + email + '. Reference ' + reference;
        ${report('shadow-login', 'reference')}
      });
    }
  });
</script>`;

/** First page of the pair: a failing fetch of its own and a link on */
const NET_A_HTML = `<!doctype html><title>Page A</title>
<h1>Page A</h1>
<a id="next" href="/eval-net-b">Next page</a>
<script>
  document.getElementById('next').href = '/eval-net-b' + location.search;
  fetch('/eval-net-a-' + ${RANDOM} + '.json').catch(() => {});
</script>`;

/** Second page: its own failing fetch, named from a value made at load, and one that works */
const NET_B_HTML = `<!doctype html><title>Page B</title>
<h1>Page B</h1>
<script>
  (() => {
    fetch('/api/test').catch(() => {});
    const missing = '/eval-net-b-' + ${RANDOM} + '.json';
    fetch(missing).catch(() => {});
    ${report('failed-request-page-two', 'missing')}
  })();
</script>`;

/** Page whose button saves a CSV from a Blob, named from a value made on click */
const DOWNLOAD_HTML = `<!doctype html><title>Reports</title>
<h1>Reports</h1>
<button id="get">Download report</button>
<script>
  document.getElementById('get').addEventListener('click', () => {
    const name = 'q3-report-' + ${RANDOM} + '.csv';
    ${report('download-name', 'name')}
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['quarter,total\\nQ3,1200\\n'], { type: 'text/csv' }));
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
  });
</script>`;

/** Page that logs a warning, an info line and one error with a code made at load */
const CONSOLE_HTML = `<!doctype html><title>Checkout</title>
<h1>Checkout</h1>
<script>
  (() => {
    console.info('checkout script ready');
    console.warn('Deprecated API used (code W-1010)');
    const code = 'E-' + ${RANDOM};
    console.error('Payment widget failed to load (code ' + code + ')');
    ${report('console-error-code', 'code')}
  })();
</script>`;

/** Page with a sign-up link whose last class is made at load, and a plain log-in link */
const CLASSES_HTML = `<!doctype html><title>Welcome</title>
<h1>Welcome</h1>
<a href="/eval-login" class="px-4 py-2">Log in</a>
<a id="register" href="/eval-register" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 focus:ring-2">Create account</a>
<script>
  (() => {
    const extra = 'id-' + ${RANDOM};
    document.getElementById('register').classList.add(extra);
    ${report('utility-classes', 'extra')}
  })();
</script>`;

/** Pages by path */
export const ROUTES: FixtureRoutes = {
  '/eval-slot': SLOT_HTML,
  '/eval-slot-popup': SLOT_POPUP_HTML,
  '/eval-confirm': CONFIRM_HTML,
  '/eval-buttons': BUTTONS_HTML,
  '/eval-shadow-login': SHADOW_LOGIN_HTML,
  '/eval-net-a': NET_A_HTML,
  '/eval-net-b': NET_B_HTML,
  '/eval-download': DOWNLOAD_HTML,
  '/eval-console': CONSOLE_HTML,
  '/eval-classes': CLASSES_HTML,
};
