/**
 * Fixture page for the `type` that `dom query` and `dom get` show (#688),
 * served by the fixture server: `/type-attribute` has, in a form, an
 * `<input>` without `type` (`#plain`), a `<button type="button">` (`#plain-button`),
 * a `<button>` without `type` (`#implicit-submit`, which submits), an
 * `<input type="EMAIL">` (`#upper`), and a `<button>` outside a form
 * (`#loose`).
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/** Elements with and without a `type` attribute */
const TYPE_ATTRIBUTE_HTML = `<!doctype html><title>type attribute</title>
<form id="form" onsubmit="return false">
  <input id="plain" name="plain">
  <input id="upper" name="upper" type="EMAIL">
  <button id="plain-button" type="button">Plain</button>
  <button id="implicit-submit">Send</button>
</form>
<button id="loose">Loose</button>`;

/** Type attribute pages by path */
export const ROUTES: FixtureRoutes = {
  '/type-attribute': TYPE_ATTRIBUTE_HTML,
};
