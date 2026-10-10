/**
 * Fixture pages for Enter in a form field, which submits the form
 * implicitly (#591), served by the fixture server: `/implicit-submit` has
 * a form with a single required text field and no submit button (`#solo`,
 * which Enter submits), a form with two text fields and no submit button
 * (`#duo`, which Enter does not submit), a form with a required title, a
 * `<textarea>` and a submit button (`#notes`), a sign-up form with a
 * required email, a required `minlength=8` password and a required checkbox
 * (`#signup`, the issue's page), a form whose submit button is disabled
 * (`#off`, which Enter does not submit), a form with two text fields
 * whose only submit button is an `<input type=image>` (`#pics`; image
 * inputs are not in `form.elements`), and `<x-card>`, whose closed
 * shadow root holds a form with a required field labelled "Card" and a
 * submit button. Every form's `submit` is noted in `window.submitted` and
 * canceled. The other cases (a submit button outside the form, a
 * `novalidate` form, a canceled click on the default button, a valid
 * form) are on `/submit-blocked` (`submitBlockedFixtures.ts`).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Forms that Enter in a field submits, or does not */
const IMPLICIT_SUBMIT_HTML = `<!doctype html><title>implicit submit</title>
<script>
  window.submitted = [];
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    window.submitted.push(event.target.id);
  });
</script>
<form id="solo"><input name="nick" required></form>
<form id="duo"><input name="first" required><input name="last"></form>
<form id="notes"><input name="title" required><textarea name="body"></textarea>
  <button id="notes-go">Post</button></form>
<form id="signup"><input name="email" type="email" required>
  <input name="password" type="password" minlength="8" required>
  <label><input name="terms" type="checkbox" required> I agree</label>
  <button id="signup-go">Sign up</button></form>
<form id="off"><input name="pin" required><button id="off-go" disabled>Go</button></form>
<form id="pics"><input name="t1" required><input name="t2">
  <input type="image" id="pics-go" alt="Go" width="40" height="20"
    src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"></form>
<x-card></x-card>
<script>
  customElements.define('x-card', class extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'closed' });
      root.innerHTML = '<form id="card"><input name="card" aria-label="Card" required><button>Pay</button></form>';
      root.querySelector('form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitted.push('card');
      });
    }
  });
</script>`;

/** Implicit submission pages by path */
export const ROUTES: FixtureRoutes = {
  '/implicit-submit': IMPLICIT_SUBMIT_HTML,
};
