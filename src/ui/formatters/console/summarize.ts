/**
 * Smart summary view: prioritises errors and warnings with deduplication
 * and shows info/debug/other as count-only footer entries.
 */

import { MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type { ConsoleMessage } from '@/types.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import { OutputFormatter, pluralize } from '@/ui/formatting.js';
import { consoleDroppedNote, consoleMoreGroupsNote } from '@/ui/messages/consoleMessages.js';

import { renderIssuesSection } from './issues.js';
import {
  analyzeMessages,
  formatCountPrefix,
  formatSectionHeader,
  formatSourceLocation,
  newestGroups,
  type ConsoleFormatOptions,
  type ConsoleSummary,
  type DeduplicatedMessage,
} from './shared.js';

/**
 * A message's text cut like `console --list` cuts it, or whole with `--full`.
 *
 * @param message - Message
 * @param full - `--full`
 * @returns Text to print
 */
function messageText(message: ConsoleMessage, full: boolean | undefined): string {
  return capForDisplay(message.text, MAX_CONSOLE_TEXT_LENGTH, full);
}

/**
 * The errors: the newest distinct ones, with a note for the earlier ones.
 *
 * @param fmt - Output
 * @param errors - Distinct errors in order of first appearance
 * @param total - Errors logged
 * @param limit - Distinct errors listed (0 = all)
 * @param full - Print the texts whole (`--full`)
 */
function renderErrorSection(
  fmt: OutputFormatter,
  errors: DeduplicatedMessage[],
  total: number,
  limit: number | undefined,
  full: boolean | undefined
): void {
  if (errors.length === 0) return;
  const { shown, more } = newestGroups(errors, limit);

  fmt.text(formatSectionHeader('Errors', errors.length, total));
  fmt.separator('─', 30);
  if (more > 0) fmt.text(consoleMoreGroupsNote(more, 'error')).blank();

  for (const { message, count } of shown) {
    fmt.text(`${formatCountPrefix(count)}${messageText(message, full)}`);
    const source = formatSourceLocation(message.stackTrace);
    if (source) {
      fmt.text(`     → ${source}`);
    }
    fmt.blank();
  }
}

/**
 * The warnings: the newest distinct ones, with a note for the earlier ones.
 *
 * @param fmt - Output
 * @param warnings - Distinct warnings in order of first appearance
 * @param total - Warnings logged
 * @param limit - Distinct warnings listed (0 = all)
 * @param full - Print the texts whole (`--full`)
 */
function renderWarningSection(
  fmt: OutputFormatter,
  warnings: DeduplicatedMessage[],
  total: number,
  limit: number | undefined,
  full: boolean | undefined
): void {
  if (warnings.length === 0) return;
  const { shown, more } = newestGroups(warnings, limit);

  fmt.text(formatSectionHeader('Warnings', warnings.length, total));
  fmt.separator('─', 30);
  if (more > 0) fmt.text(consoleMoreGroupsNote(more, 'warning'));

  for (const { message, count } of shown) {
    fmt.text(`• ${formatCountPrefix(count)}${messageText(message, full)}`);
    const source = formatSourceLocation(message.stackTrace);
    if (source) fmt.text(`     → ${source}`);
  }
  fmt.blank();
}

function renderOtherSummary(fmt: OutputFormatter, summary: ConsoleSummary): void {
  const parts = [
    summary.info > 0 && pluralize(summary.info, 'info message'),
    summary.debug > 0 && pluralize(summary.debug, 'debug message'),
    summary.other > 0 && pluralize(summary.other, 'other message'),
  ].filter(Boolean);

  if (parts.length > 0) {
    fmt.separator('─', 30);
    fmt.text(`${parts.join(' · ')} (use --list to see)`);
  }
}

/**
 * Format console output as smart summary (default mode): the newest distinct
 * errors and warnings, the page's Chrome Issues, counts of the rest, and a
 * note when the session dropped its oldest messages.
 *
 * @param messages - Messages to summarise
 * @param options - Distinct messages listed, messages dropped, issues and `--full`
 * @returns Summary
 */
export function formatConsoleSummary(
  messages: ConsoleMessage[],
  options: Pick<
    ConsoleFormatOptions,
    'groupLimit' | 'dropped' | 'full' | 'issues' | 'issuesDropped'
  > = {}
): string {
  const fmt = new OutputFormatter();
  const { grouped, summary } = analyzeMessages(messages);

  fmt.text('Console Summary');
  fmt.separator('━', 60);
  if (options.dropped) fmt.text(consoleDroppedNote(options.dropped));
  fmt.blank();

  const { groupLimit, full } = options;
  renderErrorSection(fmt, grouped.errors, summary.errors.total, groupLimit, full);
  renderWarningSection(fmt, grouped.warnings, summary.warnings.total, groupLimit, full);

  if (grouped.errors.length === 0 && grouped.warnings.length === 0) {
    fmt.text('No errors or warnings found');
    fmt.blank();
  }

  renderIssuesSection(fmt, options.issues, options.issuesDropped, full);

  renderOtherSummary(fmt, summary);

  return fmt.build();
}
