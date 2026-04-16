/**
 * Shared types, constants, and helpers used by every console formatter.
 */

import type { ConsoleLevel, ConsoleMessage, StackFrame } from '@/types.js';

export type { ConsoleLevel } from '@/types.js';

/**
 * Internal console level including 'other' for classification.
 */
export type ConsoleInternalLevel = ConsoleLevel | 'other';

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
export interface JsonErrorEntry {
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
export interface GroupedMessages {
  errors: DeduplicatedMessage[];
  warnings: DeduplicatedMessage[];
  counts: Record<ConsoleInternalLevel, number>;
}

/**
 * Result from message analysis.
 */
export interface AnalysisResult {
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

function classifyLevel(type: ConsoleMessage['type']): ConsoleInternalLevel {
  return LEVEL_MAP[type];
}

/**
 * Format timestamp with milliseconds precision.
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
}

function getDeduplicationKey(message: ConsoleMessage): string {
  const source = message.stackTrace?.[0];
  if (source) {
    return `${message.text}|${source.url}|${source.lineNumber}|${source.columnNumber}`;
  }
  return message.text;
}

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
 */
export function analyzeMessages(messages: ConsoleMessage[]): AnalysisResult {
  const grouped = groupByLevel(messages);
  const summary = buildSummary(messages.length, grouped);
  return { grouped, summary };
}

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
 */
export function formatSourceLocation(stackTrace?: StackFrame[]): string | undefined {
  const frame = stackTrace?.[0];
  if (!frame) return undefined;

  const filename = getFilenameFromUrl(frame.url, frame.functionName);
  const line = frame.lineNumber + 1;
  const col = frame.columnNumber + 1;

  return `${filename}:${line}:${col}`;
}

/**
 * Format count prefix for deduplicated messages.
 */
export function formatCountPrefix(count: number): string {
  return count > 1 ? `[${count}x] ` : '';
}

/**
 * Format section header with unique/total counts.
 */
export function formatSectionHeader(label: string, unique: number, total: number): string {
  return unique === total ? `${label} (${total})` : `${label} (${unique} unique, ${total} total)`;
}
