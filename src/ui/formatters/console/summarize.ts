/**
 * Smart summary view: prioritises errors and warnings with deduplication
 * and shows info/debug/other as count-only footer entries.
 */

import type { ConsoleMessage } from '@/types.js';
import { OutputFormatter, pluralize } from '@/ui/formatting.js';

import {
  analyzeMessages,
  formatCountPrefix,
  formatSectionHeader,
  formatSourceLocation,
  type ConsoleSummary,
  type DeduplicatedMessage,
} from './shared.js';

function renderErrorSection(
  fmt: OutputFormatter,
  errors: DeduplicatedMessage[],
  total: number
): void {
  if (errors.length === 0) return;

  fmt.text(formatSectionHeader('Errors', errors.length, total));
  fmt.separator('─', 30);

  for (const { message, count } of errors) {
    fmt.text(`${formatCountPrefix(count)}${message.text}`);
    const source = formatSourceLocation(message.stackTrace);
    if (source) {
      fmt.text(`     → ${source}`);
    }
    fmt.blank();
  }
}

function renderWarningSection(
  fmt: OutputFormatter,
  warnings: DeduplicatedMessage[],
  total: number
): void {
  if (warnings.length === 0) return;

  fmt.text(formatSectionHeader('Warnings', warnings.length, total));
  fmt.separator('─', 30);

  for (const { message, count } of warnings) {
    fmt.text(`• ${formatCountPrefix(count)}${message.text}`);
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
 * Format console output as smart summary (default mode).
 */
export function formatConsoleSummary(messages: ConsoleMessage[]): string {
  const fmt = new OutputFormatter();
  const { grouped, summary } = analyzeMessages(messages);

  fmt.text('Console Summary');
  fmt.separator('━', 60);
  fmt.blank();

  renderErrorSection(fmt, grouped.errors, summary.errors.total);
  renderWarningSection(fmt, grouped.warnings, summary.warnings.total);

  if (grouped.errors.length === 0 && grouped.warnings.length === 0) {
    fmt.text('No errors or warnings found');
    fmt.blank();
  }

  renderOtherSummary(fmt, summary);

  return fmt.build();
}
