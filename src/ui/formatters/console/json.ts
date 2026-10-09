/**
 * JSON output for console command. Includes summary statistics and
 * deduplicated errors/warnings; full message list is included only when
 * --list is set.
 */

import type { ConsoleMessage } from '@/types.js';

import { lastMessages } from './chronological.js';
import {
  analyzeMessages,
  capMessageText,
  newestGroups,
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
    ...(dedup.message.index !== undefined && { index: dedup.message.index }),
    ...(source && {
      source: {
        url: source.url,
        ...(source.lineNumber >= 0 && {
          line: source.lineNumber + 1,
          column: source.columnNumber + 1,
        }),
      },
    }),
    ...(includeStackTrace && dedup.message.stackTrace && { stackTrace: dedup.message.stackTrace }),
  };
}

/**
 * Build the rich JSON output shape (summary + the newest deduped
 * errors/warnings, plus the message list when --list is requested). Texts
 * longer than 10000 characters are cut with
 * `truncatedFrom`, unless `--full`.
 *
 * Returns a plain object so callers (e.g. runCommand's JSON envelope) can
 * embed it without re-parsing a stringified payload.
 */
export function buildConsoleJsonOutput(
  messages: ConsoleMessage[],
  options: ConsoleFormatOptions
): ConsoleJsonOutput {
  const { grouped, summary } = analyzeMessages(messages);
  const errors = newestGroups(grouped.errors, options.groupLimit);
  const warnings = newestGroups(grouped.warnings, options.groupLimit);

  const output: ConsoleJsonOutput = {
    summary,
    errors: errors.shown.map((d) => capMessageText(toJsonError(d, true), options.full)),
    warnings: warnings.shown.map((d) => capMessageText(toJsonError(d, false), options.full)),
    ...(errors.more > 0 && { moreErrors: errors.more }),
    ...(warnings.more > 0 && { moreWarnings: warnings.more }),
    ...(options.dropped && { dropped: options.dropped }),
    ...(options.pageCrashedAt !== undefined && { pageCrashedAt: options.pageCrashedAt }),
    ...(options.issues && { issues: [...options.issues] }),
    ...(options.issuesDropped && { issuesDropped: options.issuesDropped }),
  };

  if (options.list) {
    output.messages = lastMessages(messages, options.last).map((message) =>
      capMessageText(message, options.full)
    );
  }

  return output;
}
