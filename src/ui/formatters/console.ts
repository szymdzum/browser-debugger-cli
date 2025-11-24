/**
 * Console command formatters.
 *
 * Provides formatting functions for the `bdg console` command output including
 * smart summary view with deduplication, chronological view, and JSON output.
 */

import type { ConsoleLevel, ConsoleMessage, StackFrame } from '@/types.js';
import { OutputFormatter, pluralize } from '@/ui/formatting.js';
import { truncateByLength } from '@/utils/strings.js';

// Re-export ConsoleLevel for consumers that import from this module
export type { ConsoleLevel } from '@/types.js';

/**
 * Internal console level including 'other' for classification.
 * Used internally by formatter for message grouping.
 */
type ConsoleInternalLevel = ConsoleLevel | 'other';

/**
 * Deduplicated console message with occurrence count.
 */
export interface DeduplicatedMessage {
  /** First occurrence of the message */
  message: ConsoleMessage;
  /** Number of times this message appeared */
  count: number;
}

/**
 * Summary statistics for console messages.
 */
export interface ConsoleSummary {
  /** Total number of messages */
  total: number;
  /** Error statistics */
  errors: { total: number; unique: number };
  /** Warning statistics */
  warnings: { total: number; unique: number };
  /** Info message count */
  info: number;
  /** Debug message count */
  debug: number;
  /** Other message type count */
  other: number;
}

/**
 * Options for console formatting.
 */
export interface ConsoleFormatOptions {
  /** Output as JSON */
  json?: boolean | undefined;
  /** List all messages chronologically (--list flag) */
  list?: boolean | undefined;
  /** Follow mode (live streaming) */
  follow?: boolean | undefined;
  /** Limit to last N messages */
  last?: number | undefined;
  /** Show messages from all navigations (default: current only) */
  history?: boolean | undefined;
  /** Filter by level (error, warning, info, debug) */
  level?: ConsoleLevel | undefined;
}

/**
 * JSON error/warning entry structure.
 */
interface JsonErrorEntry {
  count: number;
  level: string;
  text: string;
  source?: { url: string; line: number; column: number };
  stackTrace?: StackFrame[];
}

/**
 * JSON output structure for console command.
 */
export interface ConsoleJsonOutput {
  success: boolean;
  summary: ConsoleSummary;
  errors: JsonErrorEntry[];
  warnings: Omit<JsonErrorEntry, 'stackTrace'>[];
  messages?: ConsoleMessage[];
}

/**
 * Messages grouped by level with deduplication applied.
 */
interface GroupedMessages {
  errors: DeduplicatedMessage[];
  warnings: DeduplicatedMessage[];
  counts: Record<ConsoleInternalLevel, number>;
}

/**
 * Result from message analysis.
 */
interface AnalysisResult {
  grouped: GroupedMessages;
  summary: ConsoleSummary;
}

/**
 * Mapping from console message types to level categories.
 * Exported for use by console command filtering.
 */
export const LEVEL_MAP: Record<ConsoleMessage['type'], ConsoleInternalLevel> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  log: 'info',
  debug: 'debug',
  trace: 'debug',
  dir: 'other',
  dirxml: 'other',
  table: 'other',
  clear: 'other',
  startGroup: 'other',
  startGroupCollapsed: 'other',
  endGroup: 'other',
  assert: 'other',
  profile: 'other',
  profileEnd: 'other',
  count: 'other',
  timeEnd: 'other',
};

/**
 * Classify a console message type into a level category.
 *
 * @param type - Console message type from CDP
 * @returns Normalized level category
 */
function classifyLevel(type: ConsoleMessage['type']): ConsoleInternalLevel {
  return LEVEL_MAP[type];
}

/**
 * Format timestamp with milliseconds precision.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted time string like "12:34:56.789"
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Generate a deduplication key for a console message.
 *
 * Messages are considered duplicates if they have the same text and source location.
 *
 * @param message - Console message to generate key for
 * @returns Unique key string for deduplication
 */
function getDeduplicationKey(message: ConsoleMessage): string {
  const source = message.stackTrace?.[0];
  if (source) {
    return `${message.text}|${source.url}|${source.lineNumber}|${source.columnNumber}`;
  }
  return message.text;
}

/**
 * Deduplicate an array of messages, grouping by key and counting occurrences.
 *
 * @param messages - Messages to deduplicate
 * @returns Deduplicated messages with counts
 */
function deduplicate(messages: ConsoleMessage[]): DeduplicatedMessage[] {
  const groups = new Map<string, DeduplicatedMessage>();

  for (const message of messages) {
    const key = getDeduplicationKey(message);
    const existing = groups.get(key);

    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { message, count: 1 });
    }
  }

  return Array.from(groups.values());
}

/**
 * Group and process messages in a single pass.
 *
 * Partitions messages by level, deduplicates errors/warnings,
 * and counts all levels efficiently.
 *
 * @param messages - All console messages
 * @returns Grouped and processed message data
 */
function groupByLevel(messages: ConsoleMessage[]): GroupedMessages {
  const byLevel: Record<ConsoleInternalLevel, ConsoleMessage[]> = {
    error: [],
    warning: [],
    info: [],
    debug: [],
    other: [],
  };

  for (const msg of messages) {
    byLevel[classifyLevel(msg.type)].push(msg);
  }

  return {
    errors: deduplicate(byLevel.error),
    warnings: deduplicate(byLevel.warning),
    counts: {
      error: byLevel.error.length,
      warning: byLevel.warning.length,
      info: byLevel.info.length,
      debug: byLevel.debug.length,
      other: byLevel.other.length,
    },
  };
}

/**
 * Calculate summary statistics from grouped messages.
 *
 * @param total - Total message count
 * @param grouped - Grouped and deduplicated messages
 * @returns Summary statistics object
 */
function buildSummary(total: number, grouped: GroupedMessages): ConsoleSummary {
  const sumCounts = (items: DeduplicatedMessage[]): number =>
    items.reduce((sum, d) => sum + d.count, 0);

  return {
    total,
    errors: { total: sumCounts(grouped.errors), unique: grouped.errors.length },
    warnings: { total: sumCounts(grouped.warnings), unique: grouped.warnings.length },
    info: grouped.counts.info,
    debug: grouped.counts.debug,
    other: grouped.counts.other,
  };
}

/**
 * Analyze console messages: group, deduplicate, and summarize.
 *
 * Single entry point for message analysis used by all formatters.
 *
 * @param messages - All console messages
 * @returns Object with grouped messages and summary
 */
function analyzeMessages(messages: ConsoleMessage[]): AnalysisResult {
  const grouped = groupByLevel(messages);
  const summary = buildSummary(messages.length, grouped);
  return { grouped, summary };
}

/**
 * Extract filename from URL for display.
 *
 * @param url - Full URL or empty string
 * @param functionName - Optional function name for inline scripts
 * @returns Concise filename representation
 */
function getFilenameFromUrl(url: string | undefined, functionName?: string): string {
  if (!url || url === '') {
    return functionName ? `<${functionName}>` : '<inline>';
  }
  if (url.startsWith('eval')) {
    return '<eval>';
  }
  if (url.includes('/')) {
    return url.split('/').pop() ?? url;
  }
  return url;
}

/**
 * Format source location as "file:line:col".
 *
 * @param stackTrace - Stack trace frames
 * @returns Formatted source location string, or undefined if no source
 */
function formatSourceLocation(stackTrace?: StackFrame[]): string | undefined {
  const frame = stackTrace?.[0];
  if (!frame) return undefined;

  const filename = getFilenameFromUrl(frame.url, frame.functionName);
  const line = frame.lineNumber + 1;
  const col = frame.columnNumber + 1;

  return `${filename}:${line}:${col}`;
}

/**
 * Format count prefix for deduplicated messages.
 *
 * @param count - Occurrence count
 * @returns Formatted prefix like "[8x] " or empty string
 */
function formatCountPrefix(count: number): string {
  return count > 1 ? `[${count}x] ` : '';
}

/**
 * Format section header with unique/total counts.
 *
 * @param label - Section label (e.g., "Errors", "Warnings")
 * @param unique - Number of unique messages
 * @param total - Total occurrences
 * @returns Formatted header string
 */
function formatSectionHeader(label: string, unique: number, total: number): string {
  return unique === total ? `${label} (${total})` : `${label} (${unique} unique, ${total} total)`;
}

/**
 * Render error section to formatter.
 *
 * @param fmt - OutputFormatter instance
 * @param errors - Deduplicated error messages
 * @param total - Total error count
 */
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

/**
 * Render warning section to formatter.
 *
 * @param fmt - OutputFormatter instance
 * @param warnings - Deduplicated warning messages
 * @param total - Total warning count
 */
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

/**
 * Render other messages summary footer.
 *
 * @param fmt - OutputFormatter instance
 * @param summary - Console summary with counts
 */
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
 *
 * Prioritizes errors and warnings with deduplication and counts.
 * Shows info/debug as summary counts only.
 *
 * @param messages - All console messages
 * @returns Formatted summary string
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

/** Maximum text length before truncation in list view */
const MAX_LIST_TEXT_LENGTH = 200;

/**
 * Format console output as chronological list (--list mode).
 *
 * Shows all messages in order with timestamps and levels.
 * Includes navigation markers when page reloads are detected.
 *
 * @param messages - All console messages
 * @param options - Format options
 * @returns Formatted chronological list string
 */
export function formatConsoleChronological(
  messages: ConsoleMessage[],
  options: ConsoleFormatOptions
): string {
  const fmt = new OutputFormatter();

  let displayMessages = messages;
  if (options.last && options.last > 0) {
    displayMessages = messages.slice(-options.last);
  }

  const headerSuffix = options.history ? ' (all navigations)' : '';
  const header =
    displayMessages.length === messages.length
      ? `Console Messages (${messages.length} total)${headerSuffix}`
      : `Console Messages (last ${displayMessages.length} of ${messages.length})${headerSuffix}`;

  fmt.text(header);
  fmt.separator('━', 50);

  if (displayMessages.length === 0) {
    fmt.text('No console messages');
    return fmt.build();
  }

  const baseIndex = messages.length - displayMessages.length;
  let lastNavigationId: number | undefined;

  for (const [i, msg] of displayMessages.entries()) {
    const index = baseIndex + i;
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);

    // Show navigation marker when page reloads
    if (msg.navigationId !== undefined && msg.navigationId !== lastNavigationId) {
      if (lastNavigationId !== undefined) {
        fmt.blank();
        fmt.text(`─── Page Reload (navigation #${msg.navigationId}) ───`);
        fmt.blank();
      }
      lastNavigationId = msg.navigationId;
    }

    const truncatedText = truncateByLength(msg.text, MAX_LIST_TEXT_LENGTH);
    fmt.text(`[${index}]  ${level} ${time}  ${truncatedText}`);

    const source = formatSourceLocation(msg.stackTrace);
    if (source) {
      fmt.text(`                      → ${source}`);
    }
  }

  return fmt.build();
}

/**
 * Format console output for follow mode streaming.
 *
 * Compact format optimized for live updates.
 *
 * @param messages - Recent console messages to display
 * @returns Formatted streaming output string
 */
export function formatConsoleFollow(messages: ConsoleMessage[]): string {
  const fmt = new OutputFormatter();

  fmt.text('Streaming console... (Ctrl+C to stop)');
  fmt.separator('━', 40);

  if (messages.length === 0) {
    fmt.text('Waiting for messages...');
    return fmt.build();
  }

  for (const msg of messages) {
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);
    fmt.text(`${time} ${level} ${msg.text}`);

    const source = formatSourceLocation(msg.stackTrace);
    if (source) {
      fmt.text(`                → ${source}`);
    }
  }

  return fmt.build();
}

/**
 * Convert deduplicated message to JSON error format.
 *
 * @param dedup - Deduplicated message
 * @param includeStackTrace - Whether to include full stack trace
 * @returns JSON-serializable error object
 */
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
 *
 * Structured output with summary statistics and deduplicated errors/warnings.
 *
 * @param messages - All console messages
 * @param options - Format options
 * @returns JSON string
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

/**
 * Format console output based on options.
 *
 * Main entry point for console formatting. Routes to appropriate formatter
 * based on options (json, list, follow).
 *
 * @param messages - All console messages
 * @param options - Format options
 * @returns Formatted output string
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
