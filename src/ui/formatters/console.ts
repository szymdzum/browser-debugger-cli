/**
 * Console command formatters.
 *
 * Public entry point that re-exports the per-mode formatters and provides
 * the `formatConsole` dispatcher. The per-mode implementations live in
 * `./console/`.
 */

import type { ConsoleMessage } from '@/types.js';
import { withPageCrashedNote, withTabSwitchNote } from '@/ui/messages/commands.js';

import { formatConsoleChronological } from './console/chronological.js';
import { type ConsoleFormatOptions } from './console/shared.js';
import { formatConsoleSummary } from './console/summarize.js';

export type {
  ConsoleFormatOptions,
  ConsoleJsonOutput,
  ConsoleLevel,
  ConsoleSkipped,
  ConsoleSummary,
  DeduplicatedMessage,
} from './console/shared.js';
export { LEVEL_MAP } from './console/shared.js';
export { formatConsoleChronological, lastMessages } from './console/chronological.js';
export { formatConsoleFollowLines } from './console/follow.js';
export { buildConsoleJsonOutput } from './console/json.js';
export { formatConsoleSummary } from './console/summarize.js';

/**
 * Format console output based on options. Routes to the per-mode formatter:
 * a `--level` filter lists the matching messages (the summary only shows
 * errors and warnings, so it would hide e.g. `--level info`). The text
 * starts with a warning when the page crashed, and ends with a note when
 * the session moved to a tab whose earlier messages are not recorded.
 */
export function formatConsole(messages: ConsoleMessage[], options: ConsoleFormatOptions): string {
  const body =
    options.list || options.level
      ? formatConsoleChronological(messages, options)
      : formatConsoleSummary(messages, options);
  return withPageCrashedNote(
    withTabSwitchNote(body, options.tabSwitch, 'console'),
    options.pageCrashedAt
  );
}
