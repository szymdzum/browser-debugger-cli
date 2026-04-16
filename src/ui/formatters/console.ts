/**
 * Console command formatters.
 *
 * Public entry point that re-exports the per-mode formatters and provides
 * the `formatConsole` dispatcher. The per-mode implementations live in
 * `./console/`.
 */

import type { ConsoleMessage } from '@/types.js';

import { formatConsoleChronological } from './console/chronological.js';
import { formatConsoleJson } from './console/json.js';
import { type ConsoleFormatOptions } from './console/shared.js';
import { formatConsoleSummary } from './console/summarize.js';

export type {
  ConsoleFormatOptions,
  ConsoleJsonOutput,
  ConsoleLevel,
  ConsoleSummary,
  DeduplicatedMessage,
} from './console/shared.js';
export { LEVEL_MAP } from './console/shared.js';
export { formatConsoleChronological } from './console/chronological.js';
export { formatConsoleFollow } from './console/follow.js';
export { buildConsoleJsonOutput, formatConsoleJson } from './console/json.js';
export { formatConsoleSummary } from './console/summarize.js';

/**
 * Format console output based on options. Routes to the per-mode formatter.
 */
export function formatConsole(messages: ConsoleMessage[], options: ConsoleFormatOptions): string {
  if (options.json) {
    return formatConsoleJson(messages, options);
  }

  if (options.list) {
    return formatConsoleChronological(messages, options);
  }

  return formatConsoleSummary(messages);
}
