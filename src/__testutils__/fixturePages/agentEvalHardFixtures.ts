/**
 * Fixture pages for the hard tasks of the agent eval harness (`scripts/agent-eval.mjs`, #888):
 * tasks where bdg's verdict on an action can be false, so a model that trusts it answers wrong.
 * The pages use the same `?n=<nonce>&api=<log server>` contract as `agentEvalFixtures.ts`.
 *
 * A page that must show what an action did makes its per-run value at load and logs it then,
 * before any action: the action itself sends no request, so bdg has no request to report for it.
 * Where the value is the answer (`click-value`, `iframe-result`) the load-time log holds only its
 * SHA-256, so `network details` on that request does not show the answer; the checker hashes the
 * agent's answer.
 *
 * - `/eval-hard-note` has a "Delivery note" field holding `draft-<A>` (logged as `fill-revert-init`).
 *   1200 ms after the last `input` or `change` event on it, the page sets `draft-<B>` and logs it
 *   as `fill-revert`; a fill reads back the typed text, but the field ends up holding B.
 * - `/eval-hard-gift` has a "Gift message" field with `Happy birthday`; the "Suggest a message"
 *   button sets its value to `msg-<hex>` (made and logged at load as `click-value`) and checks
 *   "Add a card", by property only: no DOM mutation, no request.
 * - `/eval-hard-stock` has a "Check stock" button that writes `Reference: st-<hex>` (made and
 *   logged at load as `iframe-result`) into a same-origin `srcdoc` iframe showing `No result yet`.
 * - `/eval-hard-app` shows `Reference: ref-<hex>` (made and logged at load as `app-redirect`) and a
 *   "Continue to the app" form that sends a GET to the harness's log server `/go`, which answers
 *   302 to `myapp://callback?code=cb-<hex>`. Chrome refuses that address, so the browser stays on
 *   this page (`myapp://` has no handler anywhere).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';
import { RANDOM, report } from '@/__testutils__/fixturePages/agentEvalFixtures.js';

/**
 * Code that reports only the SHA-256 (hex) of a value, so the request holds no answer. The value
 * stays in the page's closure for the click to apply.
 *
 * @param key - Task key
 * @param value - JavaScript expression for the value
 * @returns Statement
 */
function digestAndReport(key: string, value: string): string {
  return `crypto.subtle.digest('SHA-256', new TextEncoder().encode(${value})).then((buffer) => {
      const digest = [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
      ${report(key, 'digest')}
    });`;
}

/** Field the page puts a fresh value into 1200 ms after the last edit */
const NOTE_HTML = `<!doctype html><title>Checkout</title>
<h1>Checkout</h1>
<label>Delivery note <input id="note"></label>
<button>Save</button>
<script>
  (() => {
    const field = document.getElementById('note');
    const initial = 'draft-' + ${RANDOM};
    field.value = initial;
    ${report('fill-revert-init', 'initial')}
    let timer;
    const restore = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const kept = 'draft-' + ${RANDOM};
        field.value = kept;
        ${report('fill-revert', 'kept')}
      }, 1200);
    };
    field.addEventListener('input', restore);
    field.addEventListener('change', restore);
  })();
</script>`;

/** Button whose click only sets a field's value and a checkbox's checked state */
const GIFT_HTML = `<!doctype html><title>Gift</title>
<h1>Gift</h1>
<label>Gift message <input id="message" value="Happy birthday"></label>
<button id="suggest">Suggest a message</button>
<label><input type="checkbox" id="card"> Add a card</label>
<script>
  (() => {
    const suggestion = 'msg-' + ${RANDOM};
    ${digestAndReport('click-value', 'suggestion')}
    document.getElementById('suggest').addEventListener('click', () => {
      document.getElementById('message').value = suggestion;
      document.getElementById('card').checked = true;
    });
  })();
</script>`;

/** Button whose click writes its result into a same-origin iframe */
const STOCK_HTML = `<!doctype html><title>Stock</title>
<h1>Stock</h1>
<button id="check">Check stock</button>
<iframe id="panel" srcdoc="<p id='out'>No result yet</p>"></iframe>
<script>
  (() => {
    const reference = 'st-' + ${RANDOM};
    ${digestAndReport('iframe-result', 'reference')}
    document.getElementById('check').addEventListener('click', () => {
      const frame = document.getElementById('panel');
      frame.contentDocument.getElementById('out').textContent = 'Reference: ' + reference;
    });
  })();
</script>`;

/** Page whose form hands over to an app address Chrome refuses */
const APP_HTML = `<!doctype html><title>Reading app</title>
<h1>Reading app</h1>
<p>Reference: <span id="reference"></span></p>
<form id="handover" method="GET"><button>Continue to the app</button></form>
<script>
  (() => {
    const params = new URLSearchParams(location.search);
    const reference = 'ref-' + ${RANDOM};
    document.getElementById('reference').textContent = reference;
    ${report('app-redirect', 'reference')}
    const form = document.getElementById('handover');
    form.action = params.get('api') + '/go';
    const nonce = document.createElement('input');
    nonce.type = 'hidden';
    nonce.name = 'n';
    nonce.value = params.get('n');
    form.prepend(nonce);
  })();
</script>`;

export const ROUTES: FixtureRoutes = {
  '/eval-hard-note': NOTE_HTML,
  '/eval-hard-gift': GIFT_HTML,
  '/eval-hard-stock': STOCK_HTML,
  '/eval-hard-app': APP_HTML,
};
