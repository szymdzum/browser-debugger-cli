/**
 * Fixture page for the form-control values masked in HTML response bodies
 * (#634), served by the fixture server: `/html-secrets` holds one form
 * control per shape of {@link HTML_SECRET_ROWS} (secret-named, hidden and
 * password inputs with quoted, single-quoted, unquoted and entity-holding
 * values, attributes in either order and case, an input split over lines, a
 * secret textarea), the ordinary controls that stay readable (`q`,
 * `notes`, `passport`), and an inline script holding `INLINE-H634`, which
 * is kept (inline-script tokens are documented, not masked). Every value
 * ends in `-H634`. The page sends no requests.
 */

import type { FixtureRoutes } from '@/__testutils__/fixtureRoutes.js';

/**
 * One shape of HTML the sanitiser is judged on.
 */
export interface HtmlSecretRow {
  /** What the shape is */
  name: string;
  /** The HTML */
  html: string;
  /** The text written as the control's value (attribute value or textarea content) */
  secret: string;
  /** Whether the value stays as captured */
  kept?: true;
}

/** Every HTML shape of the case matrix, masked or kept */
export const HTML_SECRET_ROWS: readonly HtmlSecretRow[] = [
  {
    name: 'secret-named input',
    html: '<input name="apiKey" value="APIKEY-H634">',
    secret: 'APIKEY-H634',
  },
  {
    name: 'hidden input',
    html: '<input type="hidden" name="csrf" value="CSRF-H634">',
    secret: 'CSRF-H634',
  },
  {
    name: 'password input without a name',
    html: '<input type="password" value="PASSWORD-H634">',
    secret: 'PASSWORD-H634',
  },
  {
    name: 'ordinary input',
    html: '<input name="q" value="QUERY-H634">',
    secret: 'QUERY-H634',
    kept: true,
  },
  {
    name: 'single-quoted value',
    html: "<input name='token' value='SINGLE-H634'>",
    secret: 'SINGLE-H634',
  },
  {
    name: 'unquoted value',
    html: '<input name=secret value=UNQUOTED-H634>',
    secret: 'UNQUOTED-H634',
  },
  {
    name: 'value before name',
    html: '<input value="BEFORE-H634" name="token">',
    secret: 'BEFORE-H634',
  },
  {
    name: 'uppercase tag and attributes',
    html: '<INPUT NAME=Token VALUE="UPPER-H634">',
    secret: 'UPPER-H634',
  },
  {
    name: 'secret-named textarea',
    html: '<textarea name="secret">TEXTAREA-H634</textarea>',
    secret: 'TEXTAREA-H634',
  },
  {
    name: 'ordinary textarea',
    html: '<textarea name="notes">NOTES-H634</textarea>',
    secret: 'NOTES-H634',
    kept: true,
  },
  {
    name: 'inline script',
    html: "<script>const t = 'INLINE-H634';</script>",
    secret: 'INLINE-H634',
    kept: true,
  },
  {
    name: 'value with entities',
    html: '<input name="token" value="a &quot;ENTITY-H634&quot;">',
    secret: 'a &quot;ENTITY-H634&quot;',
  },
  {
    name: 'input split over lines',
    html: '<input\n  name="token"\n  value="SPLIT-H634"\n>',
    secret: 'SPLIT-H634',
  },
  { name: 'secret id', html: '<input id="user-password" value="ID-H634">', secret: 'ID-H634' },
  { name: 'unquoted value with a <', html: '<input name=token value=LT<H634>', secret: 'LT<H634' },
  {
    name: 'autocomplete one-time-code',
    html: '<input name="c" autocomplete="one-time-code" value="OTP-H634">',
    secret: 'OTP-H634',
  },
  {
    name: 'name that only contains a credential word',
    html: '<input name="passport" value="PASSPORT-H634">',
    secret: 'PASSPORT-H634',
    kept: true,
  },
];

/** The rows as one page */
const HTML_SECRETS_HTML = `<!doctype html><title>html secrets</title>
<form id="shapes" onsubmit="event.preventDefault()">
${HTML_SECRET_ROWS.map((row) => row.html).join('\n')}
<button>Save</button>
</form>`;

/** HTML secret pages by path */
export const ROUTES: FixtureRoutes = {
  '/html-secrets': HTML_SECRETS_HTML,
};
