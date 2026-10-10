/**
 * Fixture page for the secrets `dom get --raw` masks in raw HTML, served by
 * the fixture server: `/raw-secrets` has a form (`#signup`) with an ordinary
 * field (`#user`, value "ada"), a password field (`#pass`), a password field
 * switched to text by a "show password" button (`#shown`, named
 * `new-password`), a field masked by CSS only (`#masked`,
 * `-webkit-text-security`), a card number field (`#card`,
 * `autocomplete="cc-number"`), a one-time code textarea (`#otp`) and a
 * custom element (`<x-badge>`) whose constructor counts its instances in
 * `window.badges`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** A form holding each kind of secret field `dom query` masks */
const RAW_SECRETS_HTML = `<!doctype html><title>raw secrets</title>
<form id="signup" onsubmit="event.preventDefault()">
<input id="user" name="user" value="ada">
<input id="pass" name="pass" type="password" value="TopSecret99">
<input id="shown" name="new-password" type="text" value="Shown88Secret">
<input id="masked" name="code" style="-webkit-text-security: disc" value="777111">
<input id="card" name="c" autocomplete="cc-number" value="4111111111111111">
<textarea id="otp" name="otp">905512</textarea>
<x-badge>New</x-badge>
<button>Sign up</button>
</form>
<script>
  window.badges = 0;
  customElements.define('x-badge', class extends HTMLElement {
    constructor() {
      super();
      window.badges++;
    }
  });
</script>`;

/** Raw HTML secret pages by path */
export const ROUTES: FixtureRoutes = {
  '/raw-secrets': RAW_SECRETS_HTML,
};
