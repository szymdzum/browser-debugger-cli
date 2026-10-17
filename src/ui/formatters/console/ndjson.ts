/**
 * NDJSON view of `console --follow --ndjson`: one JSON object per line, a
 * `page` record wherever the stream moves to another page and a `message`
 * record per console message.
 */

import type { ConsoleMessage, PageNavigation } from '@/types.js';

/** What the stream prints */
export interface ConsoleNdjsonOptions {
  /** `--full`: message texts whole */
  full?: boolean | undefined;
  /** `--include-sensitive`: page URLs with their query and fragment tokens */
  includeSensitive?: boolean | undefined;
}

/** Turns each poll's new messages into NDJSON lines */
export interface ConsoleNdjsonStream {
  /**
   * Lines for one poll.
   *
   * @param messages - New messages, in order
   * @param navigations - Every main-frame navigation of the session
   * @param currentNavigationId - Navigation id of the page loaded now
   * @returns Lines to print, without line breaks
   */
  next(
    messages: ConsoleMessage[],
    navigations: PageNavigation[],
    currentNavigationId?: number
  ): string[];
}

/**
 * Start a console NDJSON stream.
 *
 * @param _options - `--full` and `--include-sensitive`
 * @returns The stream
 */
export function createConsoleNdjson(_options: ConsoleNdjsonOptions = {}): ConsoleNdjsonStream {
  return {
    next() {
      throw new Error('not implemented');
    },
  };
}
