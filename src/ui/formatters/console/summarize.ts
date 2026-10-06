/**
 * Smart summary view: prioritises errors and warnings with deduplication
 * and shows info/debug/other as count-only footer entries.
 */

import type { ConsoleMessage } from '@/types.js';
import { OutputFormatter, pluralize } from '@/ui/formatting.js';
import { consoleDroppedNote, consoleMoreGroupsNote } from '@/ui/messages/consoleMessages.js';

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
 * The errors: the newest distinct ones, with a note for the earlier ones.
 *
 * @param fmt - Output
 * @param errors - Distinct errors in order of first appearance
 * @param total - Errors logged
 * @param limit - Distinct errors listed (0 = all)
 */
function renderErrorSection(
  fmt: OutputFormatter,
  errors: DeduplicatedMessage[],
  total: number,
  limit: number | undefined
): void {
  if (errors.length === 0) return;
  const { shown, more } = newestGroups(errors, limit);

  fmt.text(formatSectionHeader('Errors', errors.length, total));
  fmt.separator('─', 30);
  if (more > 0) fmt.text(consoleMoreGroupsNote(more, 'error')).blank();

  for (const { message, count } of shown) {
    fmt.text(`${formatCountPrefix(count)}${message.text}`);
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
 */
function renderWarningSection(
  fmt: OutputFormatter,
  warnings: DeduplicatedMessage[],
  total: number,
  limit: number | undefined
): void {
  if (warnings.length === 0) return;
  const { shown, more } = newestGroups(warnings, limit);

  fmt.text(formatSectionHeader('Warnings', warnings.length, total));
  fmt.separator('─', 30);
  if (more > 0) fmt.text(consoleMoreGroupsNote(more, 'warning'));

  for (const { message, count } of shown) {
    fmt.text(`• ${formatCountPrefix(count)}${message.text}`);
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
 * errors and warnings, counts of the rest, and a note when the session
 * dropped its oldest messages.
 *
 * @param messages - Messages to summarise
 * @param options - Distinct messages listed and messages dropped
 * @returns Summary
 */
export function formatConsoleSummary(
  messages: ConsoleMessage[],
  options: Pick<ConsoleFormatOptions, 'groupLimit' | 'dropped'> = {}
): string {
  const fmt = new OutputFormatter();
  const { grouped, summary } = analyzeMessages(messages);

  fmt.text('Console Summary');
  fmt.separator('━', 60);
  if (options.dropped) fmt.text(consoleDroppedNote(options.dropped));
  fmt.blank();

  renderErrorSection(fmt, grouped.errors, summary.errors.total, options.groupLimit);
  renderWarningSection(fmt, grouped.warnings, summary.warnings.total, options.groupLimit);

  if (grouped.errors.length === 0 && grouped.warnings.length === 0) {
    fmt.text('No errors or warnings found');
    fmt.blank();
  }

  renderOtherSummary(fmt, summary);

  return fmt.build();
}
