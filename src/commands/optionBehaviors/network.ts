/**
 * Option behaviors of `bdg network` (list, details, har).
 */

import { FOLLOW_BEHAVIOR, type BehaviorTable } from '@/commands/optionBehaviors/shared.js';

/** Behaviors by registry key */
export const NETWORK_BEHAVIORS: BehaviorTable = {
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
      'Prints only the response body, whole, for piping (no newline added; control characters escaped only on a terminal). Binary bodies come base64-encoded (hint on stderr). --json: data { type: "network-body", requestId, body, bodyLength, base64Encoded?, mimeType? }. --body-max caps it (bodyTruncated: true; on stderr: body cut at N of M characters (--body-max 0 for all))',
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
  'har:--include-sensitive': {
    default:
      'The HAR is sanitized: values become "[redacted]" for Authorization, Proxy-Authorization, Authentication, Cookie and Set-Cookie headers, X-*key/token/secret/auth headers and headers with an api-key/apikey/token/secret/jwt/subscription-key/session(-id) segment (www-authenticate is kept); every cookie value; query and fragment parameters named like credentials (plus code, sig, key) in the request URL, queryString, redirectURL and Location/Referer headers ("%5Bredacted%5D" in URLs); and password/token/secret/key/session/signature/bearer/cookie/csrf/refresh/auth/sid/pin/ssn/card-number fields of JSON (primitives at any depth under such a name), form-urlencoded (also sniffed when the Content-Type says otherwise, user[password] names too) and multipart request and response bodies (an access_token/refresh_token/id_token login response too) and of WebSocket messages, also in truncated JSON, JSON encoded in string values (3 levels), socket.io and SockJS packets, server-sent events, NDJSON, base64 bodies with no, a generic, JSON, form or event-stream type and binary WebSocket messages that are UTF-8 text; any whole JWT (eyJ…) in a JSON string, form or URL value, multipart part or text body (only the JWT is replaced). camelCase names count as words (userPin). JSON is edited in place, not re-serialized: everything but the replaced values (64-bit numbers, formatting, duplicate keys, a BOM or )]}\' prefix) stays byte for byte. Header, cookie and parameter names, cookie attributes, headersSize, bodySize and content.size stay; log.comment and JSON sanitized: true say so',
    whenEnabled:
      'Writes every captured value (JSON sanitized: false); human output warns that the file holds credentials',
    automaticBehavior:
      'Matching is by name, so it over-redacts: harmless values under credential-looking names (tokenCount: 5, sessionLength, refreshInterval, cookieConsent) are replaced too, and credentials under other names are kept. Only JSON syntax is understood: single-quoted strings, unquoted keys, JSONP, STOMP passcode: header lines and bare values with spaces ({"token":abc def}, a non-JWT token after Bearer in text) are not (fully) redacted. A body the sanitizer fails on is replaced whole by [redacted]. Unlike Chrome DevTools, which drops these headers and empties cookies, names are kept so the HAR still shows a request was authenticated. Kept as captured: other binary (base64) bodies, binary WebSocket messages that are not UTF-8, and text that is not JSON or a form (apart from JWTs); a WebSocket message cut at 100 KB has _truncatedFrom. HAR files are written readable by their owner only (0600). network headers and network getCookies always show real values',
  },
};
