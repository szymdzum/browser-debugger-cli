/**
 * Fixture pages for clicks on submit buttons whose form fails constraint
 * validation (#572), served by the fixture server: `/submit-blocked` has a
 * light form with a required field (`#light`: a submit button, a
 * `type=button` one and a `formnovalidate` one), a `novalidate` form, a
 * form submitted by an `<input type=submit>` outside it through its `form`
 * attribute, a chat form whose submit handler clears its required field, a
 * submit button whose click handler cancels the click, a form with two
 * invalid fields (`#pair`), one submitted by an `<input type=image>`
 * (`#pictured`), a valid GET form that
 * navigates to `/submit-blocked-done?q=ada` (routes match the whole URL),
 * and `<x-pay>`, whose closed shadow root holds a form with a required
 * field. Every form's `submit` is noted in `window.submitted` (the GET
 * form's too, before it navigates). `/submit-blocked-named` has forms whose
 * named controls shadow form members (`addEventListener`,
 * `removeEventListener`; `noValidate`, `elements`, `checkValidity`,
 * `isConnected`), each with required fields left empty.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Forms with required fields, submitted in the ways a click can submit them */
const SUBMIT_BLOCKED_HTML = `<!doctype html><title>submit blocked</title>
<script>
  window.submitted = [];
  const note = (event) => {
    if (event.target.id !== 'search') event.preventDefault();
    window.submitted.push(event.target.id);
  };
  document.addEventListener('submit', note);
</script>
<form id="light"><input name="city" required>
  <button id="light-go">Go</button>
  <button type="button" id="light-plain">Preview</button>
  <button id="light-skip" formnovalidate>Save draft</button></form>
<form id="loose" novalidate><input name="zip" required><button id="loose-go">Go</button></form>
<form id="outside"><input name="code" required></form>
<input type="submit" form="outside" id="outside-go" value="Send">
<form id="chat" onsubmit="this.msg.value = ''"><input name="msg" required><button id="chat-send">Send</button></form>
<form id="guarded"><input name="nick" required><button id="guarded-go" onclick="event.preventDefault()">Join</button></form>
<form id="search" method="get" action="/submit-blocked-done"><input name="q" required value="ada"><button id="search-go">Search</button></form>
<form id="pair"><input name="first" required><input name="mail" type="email" value="ada">
  <button id="pair-go">Go</button></form>
<form id="pictured"><input name="term" required>
  <input type="image" id="pictured-go" alt="Search" width="40" height="20"
    src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></form>
<x-pay></x-pay>
<script>
  customElements.define('x-pay', class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'closed' });
      root.innerHTML = '<form id="pay"><input name="card" required><button>Pay</button></form>';
      root.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitted.push('pay');
      });
    }
  });
</script>`;

/** Forms whose named controls shadow the form's own members */
const SUBMIT_BLOCKED_NAMED_HTML = `<!doctype html><title>named controls</title>
<script>document.addEventListener('submit', (event) => event.preventDefault());</script>
<form id="listen"><input name="addEventListener" required><input name="removeEventListener">
  <button id="listen-go">Go</button></form>
<form id="state"><input name="noValidate"><input name="elements" required><input name="checkValidity">
  <input name="isConnected"><button id="state-go">Go</button></form>`;

/** Where the GET form goes with its value */
const SUBMIT_BLOCKED_DONE_HTML = '<!doctype html><title>searched</title><h1>Results</h1>';

/** Blocked submit pages by path */
export const ROUTES: FixtureRoutes = {
  '/submit-blocked': SUBMIT_BLOCKED_HTML,
  '/submit-blocked-done?q=ada': SUBMIT_BLOCKED_DONE_HTML,
  '/submit-blocked-named': SUBMIT_BLOCKED_NAMED_HTML,
};
