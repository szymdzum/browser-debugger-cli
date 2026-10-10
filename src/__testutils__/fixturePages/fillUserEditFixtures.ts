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
 * `/fill-focus-steal` has fields whose page moves the focus to the visible
 * `#vis` while `dom fill` types: 30 ms after they get the focus (`#ta`, and
 * the password `#tp`), on `beforeinput`, so the typed text lands in `#vis`
 * (`#bi`, and the password `#bip`), or right after they get the focus, in a
 * microtask (`#mt`); a field whose `beforeinput` handler cancels the text
 * and moves the focus (`#cm`, so no field gets it); a field that cannot take the focus
 * (`#gone`, `display: none`); and four one-digit code fields (`#otp-1` to `#otp-4`,
 * `maxlength=1`) whose input handler moves the focus to the next one, as
 * one-time-code forms do.
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

/** Fields whose page moves the focus while they are filled */
const FILL_FOCUS_STEAL_HTML = `<!doctype html><title>fill focus steal</title>
<label>Visible <input id="vis"></label>
<label>Delayed <input id="ta"></label>
<label>Delayed password <input id="tp" type="password"></label>
<label>Moved on typing <input id="bi"></label>
<label>Moved on typing, password <input id="bip" type="password"></label>
<label>Moved at once <input id="mt"></label>
<label>Cancelled and moved <input id="cm"></label>
<input id="gone" style="display: none" aria-label="Gone">
<fieldset id="code"><legend>Code</legend>
  <input id="otp-1" maxlength="1" aria-label="Digit 1"><input id="otp-2" maxlength="1" aria-label="Digit 2">
  <input id="otp-3" maxlength="1" aria-label="Digit 3"><input id="otp-4" maxlength="1" aria-label="Digit 4">
</fieldset>
<script>
  const vis = document.getElementById('vis');
  for (const id of ['ta', 'tp']) {
    document.getElementById(id).addEventListener('focus', () => setTimeout(() => vis.focus(), 30));
  }
  for (const id of ['bi', 'bip']) {
    document.getElementById(id).addEventListener('beforeinput', () => vis.focus());
  }
  document.getElementById('cm').addEventListener('beforeinput', (event) => {
    event.preventDefault();
    vis.focus();
  });
  document.getElementById('mt').addEventListener('focus', () => queueMicrotask(() => vis.focus()));
  document.getElementById('code').addEventListener('input', (event) => {
    const next = event.target.nextElementSibling;
    if (event.target.value.length === 1 && next) next.focus();
  });
</script>`;

/** Fill pages by path */
export const ROUTES: FixtureRoutes = {
  '/fill-user-edit': FILL_USER_EDIT_HTML,
  '/fill-focus-steal': FILL_FOCUS_STEAL_HTML,
};
