/**
 * Types and texts shared by the option behavior tables.
 */

import type { OptionBehavior } from '@/commands/helpJson.js';

/**
 * Registry key format: last command name, colon, long flag (the short flag
 * when there is no long one), e.g. "screenshot:--no-resize", "bdg:--headless"
 */
export type BehaviorKey = string;

/** One area's behaviors by registry key */
export type BehaviorTable = Readonly<Record<BehaviorKey, OptionBehavior>>;

/** What `status`, `sessions`, `page info`, `page tabs`, `network list` and `peek` mask in page URLs (#623) */
export const MASKED_URL_DEFAULT =
  'Page URLs are shown without user:pass@ (removed whole) and with credential query and fragment parameters (secret field names plus code, sig, key: token, access_token, id_token, code, password, cc-number...) as "••••", human and --json (the url fields keep their names). Other parameters and the rest of the URL stay byte for byte';

/** What `--include-sensitive` does on the commands that mask page URLs */
export const MASKED_URL_ENABLED =
  'Shows the query and fragment parameters as captured, with a warning (JSON warning) that the output holds credentials; user:pass@ stays removed (bdg details network <id> --include-sensitive has the full request)';

/** Hidden behaviors of masked page URLs */
export const MASKED_URL_AUTOMATIC =
  'Matching is by parameter name, so it over-masks harmless values under credential-looking names and keeps credentials under other names. The start output, page navigate, action results (navigation, triggered requests, opened tabs), dom form action, the a11y root url and daemon.log are always masked: no flag shows them. dom frames and the frame field of frame-scoped results, pendingRequests of a page still loading, console message sources and the user info of a URL nested in a query value or wrapped by a blob: URL are masked too';

/** How every follow mode (peek, console, network list) runs and ends */
export const FOLLOW_BEHAVIOR =
  'Stops with exit 83 when the session it follows ends, 130 on Ctrl-C, 143 on SIGTERM; with --json prints one compact object per line (NDJSON). Other failures (a busy page, a timeout) are retried: reported once in text, as one error line per refresh in JSON';
