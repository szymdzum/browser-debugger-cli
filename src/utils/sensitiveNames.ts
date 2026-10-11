/**
 * Names of fields that hold secrets: the one rule DOM masking (page side,
 * `SENSITIVE_FIELD_JS`, on a field's name, id, autocomplete and label text)
 * and HAR sanitising (Node side, field, parameter and cookie names) share,
 * so the two cannot drift apart (#622).
 *
 * A name matches when, case-insensitively and with camelCase split into
 * words (`apiKey` → `api_Key`), it contains one of {@link SENSITIVE_NAME_TERMS}.
 * Short or common words only count as whole words (between non-letters or
 * at the ends), so `pass`, `pw`, `pin`, `auth` and `csc` match `user_pass`,
 * `pw1`, `userPin` and `X-Auth` but not `passport`, `compass`, `opinion`
 * or `author`. A bare `key` or `code` does not count (`keyword`, `zipcode`,
 * a search key); `api_key`, `private_key`, `access_key`, `auth_code` and
 * `security code` do. Two-word terms take `-`, `_` or a space between the
 * words (`cc-number`, `card number`, `API key`), as label text has spaces.
 */

/**
 * Regular expression source matching any of a few words as a whole word
 * (between non-letters, or at the start or end of the name).
 *
 * @param words - Alternatives, e.g. `pass|pw`
 * @returns Regular expression source
 */
function wholeWord(words: string): string {
  return `(^|[^a-z])(${words})([^a-z]|$)`;
}

/**
 * Regular expression sources (case-insensitive) of secret names, one per
 * kind: passwords and one-time codes, card data and identity numbers,
 * keys and tokens, session and request credentials.
 */
export const SENSITIVE_NAME_TERMS: readonly string[] = [
  'passw|pwd|passcode|passphrase',
  wholeWord('pass|pw|otp|totp|pin|ssn|auth|sid|csc'),
  'cvv|cvc|security[-_ ]?code|card[-_ ]?verification',
  'card[-_ ]?(num(ber)?|no)([^a-z]|$)',
  '(^|[^a-z])cc[-_ ]?(num(ber)?|no)([^a-z]|$)|credit[-_ ]?card',
  'token|secret(?!ar)|credential|jwt|bearer|oauth',
  '(api|private|access)[-_ ]?key',
  'authoriz|auth[-_ ]?code|code[-_ ]?verifier',
  'session|cookie|csrf|xsrf|refresh|signature',
];

/** {@link SENSITIVE_NAME_TERMS} as one regular expression, for names with camelCase split */
const SENSITIVE_NAME = new RegExp(SENSITIVE_NAME_TERMS.join('|'), 'i');

/**
 * Whether a field, form, body or query parameter name looks like it holds a
 * secret (see the module comment).
 *
 * @param name - Name as written
 * @returns True for password, one-time code, card, key, token, secret,
 *   session and other credential names
 */
export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name.replace(/([a-z])([A-Z])/g, '$1_$2'));
}

/**
 * Page-side `(name) => boolean`: {@link isSensitiveName}, for scripts that
 * run in the page. The constant rule is compiled into the script as a
 * regular expression literal; no page or user data is.
 */
export const SENSITIVE_NAME_JS = `(name) => ${String(SENSITIVE_NAME)}.test(String(name).replace(/([a-z])([A-Z])/g, '$1_$2'))`;
