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

/** How every follow mode (peek, console, network list) runs and ends */
export const FOLLOW_BEHAVIOR =
  'Stops with exit 83 when the session it follows ends, 130 on Ctrl-C, 143 on SIGTERM; with --json prints one compact object per line (NDJSON). Other failures (a busy page, a timeout) are retried: reported once in text, as one error line per refresh in JSON';
