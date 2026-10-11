/**
 * Fixture page for fields that are secret by their label, and for what a
 * secret field's neighbours and errors may reveal (#633, #642, #625, #643),
 * served by the fixture server: `/secret-labels` has a form (`#vault`,
 * submits are prevented; `#go` submits it) with
 *
 * - a password field with `minlength=8` (`#pw`) and an ordinary text field
 *   with `minlength=8` (`#nick`), both empty, for blocked submits;
 * - text fields that are secret by their name (`#named`, name `password`,
 *   value NAMEDSECRET1), their `aria-label` "Password" (`#aria`,
 *   ARIASECRET2), a `<label for>` "Password" (`#lf`, LABELFORSECRET3), a
 *   wrapping `<label>Password …` (`#wrapped`, WRAPPEDSECRET4), an
 *   `aria-labelledby` pointing at "Token" (`#lby`, LABELLEDBYSECRET5), a
 *   placeholder "API key" (`#ph`, PLACEHOLDERSECRET6) and an
 *   `aria-labelledby` pointing at "Security code" (`#csc`, CSC737);
 * - a "Show password" checkbox (`#show`) and an ordinary field labelled
 *   "Passport" (`#passport`, PASSPORT11), which stay readable;
 * - a card number field (`#cc`, name `cc-number`, 4111111111111111), a
 *   field whose `aria-labelledby` lists "Confirm" and the card field
 *   (`#ref`, value REFVALUE8) and one whose `aria-describedby` is the card
 *   field (`#desc`, DESCVALUE9);
 * - a select named `password` (`#sel`, options OPTSECRET6 "OPTLABEL6" and
 *   OPTOTHER7 "OPTOTHER7").
 *
 * Every submit is noted in `window.submitted`.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Fields secret by label, a secret select, and fields referring to a secret field */
const SECRET_LABELS_HTML = `<!doctype html><title>secret labels</title>
<script>
  window.submitted = [];
  document.addEventListener('submit', (event) => {
    event.preventDefault();
    window.submitted.push(event.target.id);
  });
</script>
<form id="vault">
<label for="pw">New password</label><input id="pw" name="pw" type="password" minlength="8">
<label for="nick">Nickname</label><input id="nick" name="nick" minlength="8">
<input id="named" name="password" value="NAMEDSECRET1">
<input id="aria" aria-label="Password" value="ARIASECRET2">
<label for="lf">Password</label><input id="lf" value="LABELFORSECRET3">
<label>Password <input id="wrapped" value="WRAPPEDSECRET4"></label>
<span id="tok-label">Token</span><input id="lby" aria-labelledby="tok-label" value="LABELLEDBYSECRET5">
<input id="ph" placeholder="API key" value="PLACEHOLDERSECRET6">
<span id="csc-label">Security code</span><input id="csc" aria-labelledby="csc-label" value="CSC737">
<label><input type="checkbox" id="show" name="show"> Show password</label>
<label for="passport">Passport</label><input id="passport" name="passport" value="PASSPORT11">
<input id="cc" name="cc-number" value="4111111111111111">
<span id="lbl">Confirm</span><input id="ref" aria-labelledby="lbl cc" value="REFVALUE8">
<input id="desc" aria-describedby="cc" value="DESCVALUE9">
<select id="sel" name="password"><option value="OPTSECRET6" selected>OPTLABEL6</option><option value="OPTOTHER7">OPTOTHER7</option></select>
<button id="go">Go</button>
</form>`;

/** Secret label pages by path */
export const ROUTES: FixtureRoutes = {
  '/secret-labels': SECRET_LABELS_HTML,
};
