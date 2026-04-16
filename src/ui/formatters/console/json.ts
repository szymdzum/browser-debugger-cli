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
 * Build the rich JSON output shape (summary + deduped errors/warnings, plus
 * the full message list when --list is requested).
 *
 * Returns a plain object so callers (e.g. runCommand's JSON envelope) can
 * embed it without re-parsing a stringified payload.
 */
export function buildConsoleJsonOutput(
  messages: ConsoleMessage[],
  options: ConsoleFormatOptions
): ConsoleJsonOutput {
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

  return output;
}

/**
 * Format console output as a JSON string. Thin wrapper around
 * buildConsoleJsonOutput for callers that want a serialized payload.
 */
export function formatConsoleJson(
  messages: ConsoleMessage[],
  options: ConsoleFormatOptions
): string {
  return JSON.stringify(buildConsoleJsonOutput(messages, options), null, 2);
}
