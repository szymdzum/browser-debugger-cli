/**
 * JSON output for console command. Includes summary statistics and
 * deduplicated errors/warnings; full message list is included only when
 * --list is set.
 */

import type { ConsoleMessage } from '@/types.js';

import {
  analyzeMessages,
  type ConsoleFormatOptions,
  type ConsoleJsonOutput,
  type DeduplicatedMessage,
  type JsonErrorEntry,
} from './shared.js';

function toJsonError(dedup: DeduplicatedMessage, includeStackTrace: boolean): JsonErrorEntry {
  const source = dedup.message.stackTrace?.[0];
  return {
    count: dedup.count,
    level: dedup.message.type,
    text: dedup.message.text,
    ...(source && {
      source: {
        url: source.url,
        line: source.lineNumber + 1,
        column: source.columnNumber + 1,
      },
    }),
    ...(includeStackTrace && dedup.message.stackTrace && { stackTrace: dedup.message.stackTrace }),
  };
}

/**
 * Format console output as JSON.
 */
export function formatConsoleJson(
  messages: ConsoleMessage[],
  options: ConsoleFormatOptions
): string {
  const { grouped, summary } = analyzeMessages(messages);

  const output: ConsoleJsonOutput = {
    success: true,
    summary,
    errors: grouped.errors.map((d) => toJsonError(d, true)),
    warnings: grouped.warnings.map((d) => toJsonError(d, false)),
  };

  if (options.list) {
    const displayMessages =
      options.last && options.last > 0 ? messages.slice(-options.last) : messages;
    output.messages = displayMessages;
  }

  return JSON.stringify(output, null, 2);
}
