/**
 * Fixture pages for `dom fill` entering a value as a user edit, so the
 * browser applies `minlength` (#592), and for the masked echo of secret
 * fields, served by the fixture server: `/fill-user-edit` has a sign-up
 * form (`#signup`) with a `minlength=4` nickname (`#nick`), a required
 * `minlength=8` password (`#mlp`, the issue's page), a `minlength=10`
 * textarea (`#bio`), a `maxlength=4` code (`#code`) and a submit button
 * (`#go`); a form of fields `dom query` masks without being passwords
 * (`#secrets`: a one-time code by autocomplete `#otp`, a CSS-masked field
 * `#dots`, a field named `cvv`, a field named `pin` whose input handler
 * drops everything but digits, `#digits`) next to an ordinary one
 * (`#city`); and
 * `<x-alias>`, whose open shadow root holds a form with a required
 * `minlength=5` field (`#alias`) and a submit button. Every form's `submit`
 * is noted in `window.submitted` and canceled; the `beforeinput` and
 * `input` events of the fields are noted in `window.inputLog` as
 * `id type inputType data trusted|untrusted` (capture, on the document,
 * reading the event path, so fields in the shadow root are named too).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Forms whose fields have length limits, and secret fields that are not passwords */
const FILL_USER_EDIT_HTML = `<!doctype html><title>fill user edit</title>
<script>
  window.submitted = [];
  window.inputLog = [];
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    window.submitted.push(event.composedPath()[0].id);
  }, true);
  for (const type of ['beforeinput', 'input']) {
    document.addEventListener(type, (event) => {
      const field = event.composedPath()[0];
      window.inputLog.push([field.id, event.type, event.inputType, event.data, event.isTrusted ? 'trusted' : 'untrusted'].join(' '));
    }, true);
  }
</script>
<form id="signup">
  <label>Nickname <input id="nick" name="nick" minlength="4"></label>
  <label>Password <input id="mlp" name="password" type="password" minlength="8" required></label>
  <label>Bio <textarea id="bio" name="bio" minlength="10"></textarea></label>
  <label>Code <input id="code" name="code" maxlength="4"></label>
  <button id="go">Sign up</button>
</form>
<form id="secrets">
  <label>One-time code <input id="otp" name="token" autocomplete="one-time-code"></label>
  <label>Hint <input id="dots" name="hint" style="-webkit-text-security: disc"></label>
  <label>CVV <input id="cvv" name="cvv"></label>
  <label>PIN <input id="digits" name="pin" oninput="this.value = this.value.replace(/[^0-9]/g, '')"></label>
  <label>City <input id="city" name="city"></label>
</form>
<x-alias></x-alias>
<script>
  customElements.define('x-alias', class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<form id="aliases"><label>Alias <input id="alias" name="alias" minlength="5" required></label>' +
        '<button id="alias-go">Save</button></form>';
      root.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitted.push('aliases');
      });
    }
  });
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-user-edit': FILL_USER_EDIT_HTML,
};
