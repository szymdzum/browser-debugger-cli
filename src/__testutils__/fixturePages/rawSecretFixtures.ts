/**
 * Fixture page for the secrets `dom get --raw` masks in raw HTML, served by
 * the fixture server: `/raw-secrets` has a form (`#signup`) with an ordinary
 * field (`#user`, value "ada"), a password field (`#pass`), a password field
 * switched to text by a "show password" button (`#shown`, named
 * `new-password`), a field masked by CSS only (`#masked`,
 * `-webkit-text-security`), a card number field (`#card`,
 * `autocomplete="cc-number"`), a one-time code textarea (`#otp`) and a
 * custom element (`<x-badge>`) whose constructor counts its instances in
 * `window.badges`; `/raw-frames` has iframes whose `srcdoc` holds a password
 * field and an ordinary one (`#framed`), a password two `srcdoc` levels deep
 * (`#nested`) and no field (`#plain-frame`); `/raw-legacy` has an HTML 4.01
 * doctype and a comment before `<html>`, and a password field.
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

/** Secret fields in iframe `srcdoc` attributes, one level and two deep */
const RAW_FRAMES_HTML = `<!doctype html><title>raw frames</title>
<div id="framed"><iframe srcdoc="<input type=password value=FRAMESECRET><input name=note value=plain>"></iframe></div>
<div id="nested"><iframe srcdoc="<iframe srcdoc='<input type=password value=DEEPSECRET>'></iframe>"></iframe></div>
<div id="plain-frame"><iframe srcdoc="<p>hello</p>"></iframe></div>`;

/** A legacy doctype and a comment before the root element */
const RAW_LEGACY_HTML = `<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN" "http://www.w3.org/TR/html4/strict.dtd">
<!-- served by the fixture server -->
<html><head><title>raw legacy</title></head>
<body><input id="legacy-pass" type="password" value="LegacySecret"></body></html>`;

/** Raw HTML secret pages by path */
export const ROUTES: FixtureRoutes = {
  '/raw-secrets': RAW_SECRETS_HTML,
  '/raw-frames': RAW_FRAMES_HTML,
  '/raw-legacy': RAW_LEGACY_HTML,
};
