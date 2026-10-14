/**
 * Option behaviors of `bdg network` (list, details, har, headers, document).
 */

import {
  FOLLOW_BEHAVIOR,
  MASKED_URL_AUTOMATIC,
  MASKED_URL_DEFAULT,
  MASKED_URL_ENABLED,
  type BehaviorTable,
} from '@/commands/optionBehaviors/shared.js';

/** What `details network`, `network headers` and `network document` mask by default (#615) */
const MASKED_OUTPUT_DEFAULT =
  'Credentials are shown as "••••" (human and --json; field and header names and the JSON shape stay): Cookie and Set-Cookie values (cookie names and attributes such as HttpOnly; Path=/ kept), Authorization and Proxy-Authorization (the scheme kept: Bearer ••••), Authentication, X-*key/token/secret/auth headers, headers with an api-key/token/secret/jwt/session segment and headers named like a secret field (X-Password, Sid, Cookie2); user:pass@ and credential query/fragment parameters (secret field names plus code, sig, key) in the request URL, redirect URL and Location, Referer, :path, Content-Location, Refresh and Link headers; a JWT in any header; secret-named fields of urlencoded, JSON (any depth) and multipart request bodies, of JSON response bodies (access_token, id_token...), the value of password, hidden and secret-named inputs and the text of secret-named textareas in HTML response bodies (text/html, application/xhtml+xml; the rest of the HTML, inline scripts included, stays as captured) and of WebSocket messages (in plain-text messages, a token-shaped credential after Bearer or Basic of any case: a word of 6+ token characters with a digit, symbol or inner capital, so bearer abc123 is masked and Basic information is not); any JWT. The rules are those of the default HAR export (network har) and the secret field names DOM masking uses. A footer line (JSON masked: true; with --body a hint on stderr) says when something was masked';

/** What `--include-sensitive` does on the commands that mask by default */
const MASKED_OUTPUT_ENABLED =
  'Shows every value as captured; a warning (JSON warning) says the output holds credentials';

/** Hidden behaviors of masked network output */
const MASKED_OUTPUT_AUTOMATIC =
  'Matching is by name, so it over-masks harmless values under credential-looking names (tokenCount) and keeps credentials under other names. Everything not masked stays byte for byte, so the output is still good for debugging; Size, decodedBodyLength, encodedDataLength and the Content-Length header describe the captured body, not the masked one. Inline scripts of HTML bodies and network getCookies are not masked; page URLs in network list, peek, status, sessions and page info/tabs are masked by the same URL rule (their own --include-sensitive shows the tokens)';

/** Behaviors by registry key */
export const NETWORK_BEHAVIORS: BehaviorTable = {
  'list:--include-sensitive': {
    default: `${MASKED_URL_DEFAULT}. --filter matches the shown (masked) URL, so url:token=abc does not match`,
    whenEnabled: `${MASKED_URL_ENABLED}; --filter (url:) matches the raw query and fragment again; with --follow the warning is printed once on stderr`,
    automaticBehavior: MASKED_URL_AUTOMATIC,
  },
  'list:--filter': {
    default:
      'DevTools-style DSL, space = AND, ! negates. url:<text> matches a case-insensitive part of the URL as shown (scheme, host, path, query; masked values and user:pass@ are not in it, so they never match); with a * the whole URL must match the pattern, as domain: matches a host (url:*api*v2*)',
    whenEnabled:
      'An invalid filter exits 81; a word without type: (access_token) suggests url:access_token',
  },
  'har:--filter': {
    default:
      'Same DSL as network list. url:<text> matches the URL as the HAR writes it: credentials replaced by [REDACTED] unless --include-sensitive, so a redacted value never matches',
  },
  'list:--follow': {
    default: 'Lists the requests captured so far and exits',
    whenEnabled: 'Streams requests as they finish',
    automaticBehavior: FOLLOW_BEHAVIOR,
  },
  'list:--page': {
    default:
      "current for --preset errors, failed and slow (an earlier page's 404 is not the current page's); all for other presets, --filter alone and no filter",
    whenEnabled:
      'current: only requests of the page currently loaded (the latest navigation; requests of another tab before bdg page switch count as earlier pages). all: every captured request, as before',
    automaticBehavior:
      'When it leaves requests out, the list ends with "N requests from earlier pages hidden (--page all)" (JSON page: "current", hiddenEarlierPages: N; filteredCount counts the current page only). The DSL key page:current does the same inside --filter (!page:current: only earlier pages). --follow streams every page: a preset\'s default does not apply there, and --page with --follow exits 81',
    tokenImpact:
      "current makes an errors list after a navigation shorter: the old page's errors are a count, not rows",
  },
  'list:--sort': {
    default: 'Capture order (oldest first); --last n keeps the latest n',
    whenEnabled:
      'size: bytes transferred, largest first; duration: slowest first (pending requests last); start: by start time. With size or duration, --last n keeps the n largest/slowest ("--sort size --last 5" = the 5 heaviest); with start, the latest n',
    automaticBehavior:
      'Applied after --filter, --preset, --type and --page. The header says the order (5 largest of 42, or 42, slowest first); JSON sort: <key> and requests in that order. Not with --follow (exit 81)',
    tokenImpact:
      'Answers "heaviest/slowest request?" in --last n rows instead of listing everything',
  },
  'details:--body': {
    default: 'Request details with the response body cut at 20000 characters (human and --json)',
    whenEnabled:
      'Prints only the response body, whole, for piping (no newline added; control characters escaped only on a terminal); in an HTML body the values of secret form controls are •••• (inline scripts as captured) unless --include-sensitive. Binary bodies come base64-encoded (hint on stderr). --json: data { type: "network-body", requestId, body, bodyLength, base64Encoded?, mimeType? }. --body-max caps it (bodyTruncated: true; on stderr: body cut at N of M characters (--body-max 0 for all))',
    automaticBehavior:
      'A request without a body to print exits 83 and says why: not captured (binary bodies such as images and fonts are skipped unless the session started with --all; past the session body budget it was evicted), still loading, a WebSocket (messages, not a body), the response has no body (HEAD, 204, 205, 304), or none captured (redirects, failed requests). Network only (details console exits 81)',
    tokenImpact:
      'Whole body: a large HTML document is hundreds of KB. Use --body-max or pipe through head/jq',
  },
  'details:--no-body': {
    default: 'The response body is shown, cut at 20000 characters',
    whenEnabled:
      'Leaves the response body out of human and --json output (responseBody and responseBodyBase64 dropped); headers, timing, the request body and why a body was not captured stay',
    tokenImpact: 'Metadata only: a few KB at most',
  },
  'details:--body-max': {
    default:
      '20000: a longer response body is cut, human output ends it with "… N more characters (full body: bdg details network <id> --body)", --json adds bodyTruncated: true and bodyLength (the whole length)',
    whenEnabled:
      'Characters of the response body to keep (0 = all), in human and --json output and with --body. Base64 bodies are cut on a whole 4-character group. Not with --no-body (exit 81)',
    tokenImpact:
      'details network --json used to inline the whole body (614 KB for the github.com document); the 20000 default keeps it near 25 KB',
  },
  'details:--include-sensitive': {
    default: MASKED_OUTPUT_DEFAULT,
    whenEnabled: MASKED_OUTPUT_ENABLED,
    automaticBehavior: `${MASKED_OUTPUT_AUTOMATIC}. With --body the masked body is what is printed and cut (bodyLength counts the masked body); masked: true and the stderr note only when the body itself had a credential. Network only (details console exits 81)`,
  },
  'headers:--include-sensitive': {
    default: MASKED_OUTPUT_DEFAULT,
    whenEnabled: MASKED_OUTPUT_ENABLED,
    automaticBehavior: MASKED_OUTPUT_AUTOMATIC,
  },
  'document:--include-sensitive': {
    default: MASKED_OUTPUT_DEFAULT,
    whenEnabled: MASKED_OUTPUT_ENABLED,
    automaticBehavior: MASKED_OUTPUT_AUTOMATIC,
  },
  'har:--include-sensitive': {
    default:
      'The HAR is sanitized: values become "[redacted]" for Authorization, Proxy-Authorization, Authentication, Cookie and Set-Cookie headers, X-*key/token/secret/auth headers, headers with an api-key/apikey/token/secret/jwt/subscription-key/session(-id) segment and headers named like a secret field (X-Password, Sid, Cookie2) (www-authenticate, access-control-allow-credentials, signature-input and accept-signature are kept); a JWT in any other header; every cookie value; query and fragment parameters named like credentials (plus code, sig, key) in the request URL, queryString, redirectURL and Location/Referer/:path/Content-Location/Refresh/Link headers ("%5Bredacted%5D" in URLs), and the user info of those URLs (http://bob:pw@host/ written http://host/, scheme-relative //bob:pw@host/ too); and fields with a secret field name (the list DOM masking uses: password/pass/pw/token/secret/api_key/session/signature/bearer/cookie/csrf/refresh/auth/sid/pin/otp/ssn/card-number) of JSON (primitives at any depth under such a name), form-urlencoded (also sniffed when the Content-Type says otherwise, user[password] names too) and multipart request and response bodies (an access_token/refresh_token/id_token login response too) and of WebSocket messages (in plain-text ones a token-shaped credential after Bearer or Basic, any case); the value of an input that is type=password or type=hidden or whose name, id or autocomplete is a secret name, and the text of such a textarea, in HTML response bodies (text/html, application/xhtml+xml), also in truncated JSON, JSON encoded in string values (3 levels), socket.io and SockJS packets, server-sent events, NDJSON, base64 bodies with no, a generic, JSON, form or event-stream type and binary WebSocket messages that are UTF-8 text; any whole JWT (eyJ…) in a JSON string, form or URL value, multipart part or text body (only the JWT is replaced). camelCase names count as words (userPin). JSON is edited in place, not re-serialized: everything but the replaced values (64-bit numbers, formatting, duplicate keys, a BOM or )]}\' prefix) stays byte for byte. Header, cookie and parameter names, cookie attributes, headersSize, bodySize and content.size stay; log.comment and JSON sanitized: true say so',
    whenEnabled:
      'Writes every captured value (JSON sanitized: false); human output warns that the file holds credentials',
    automaticBehavior:
      'Matching is by name, so it over-redacts: harmless values under credential-looking names (tokenCount: 5, sessionLength, refreshInterval, cookieConsent) are replaced too, and credentials under other names are kept. Only JSON syntax is understood: single-quoted strings, unquoted keys, JSONP, STOMP passcode: header lines and bare values with spaces ({"token":abc def}, a non-JWT token after Bearer in text) are not (fully) redacted. A body the sanitizer fails on is replaced whole by [redacted]. Unlike Chrome DevTools, which drops these headers and empties cookies, names are kept so the HAR still shows a request was authenticated. Kept as captured: other binary (base64) bodies, binary WebSocket messages that are not UTF-8, text that is not JSON, a form or HTML (apart from JWTs), and in an HTML body everything but the secret form-control values: inline-script tokens (const token = "…") are kept, and the options of a select and a tag broken by an unclosed quote are not judged, while a control written inside a script string or comment is masked too (harmless over-masking); a WebSocket message cut at 100 KB has _truncatedFrom. HAR files are written readable by their owner only (0600). details network, network headers and network document mask the same values as •••• (their own --include-sensitive); network getCookies always shows real values',
  },
};
