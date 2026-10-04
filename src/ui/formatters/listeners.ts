/**
 * Human-readable output of `bdg dom listeners`.
 */

import type { ElementListener, ListenersResult } from '@/ipc/protocol/domTypes.js';
import { delegatedOnlyTypes } from '@/runtime/dom/listenerSummary.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  NO_LISTENERS_HINT,
  delegatedListenersNote,
  listenersHeadline,
  noListenersMessage,
} from '@/ui/messages/commands.js';
import { truncateByLength } from '@/utils/strings.js';

/** Longest handler name shown (JSON has the full name) */
const NAME_MAX_LENGTH = 30;

/** Shown for handlers without a name */
const ANONYMOUS = '(anonymous)';

/** `bdg dom listeners` data (the `success` flag is implied by the envelope) */
type ListenersOutput = Omit<ListenersResult, 'success'>;

/**
 * Where a handler is defined, as DevTools shows it (1-based line and column).
 *
 * @param handler - Listener handler
 * @returns e.g. "script 42:18:6", or "native" for built-in functions
 */
export function handlerLocation(handler: ElementListener['handler']): string {
  if (!handler.scriptId || handler.scriptId === '0') return 'native';
  return `script ${handler.scriptId}:${handler.lineNumber + 1}:${handler.columnNumber + 1}`;
}

/**
 * Columns of one listener row: placement, node, handler name, location, and
 * the flags with the source preview.
 *
 * @param listener - Listener
 * @returns Row cells
 */
function listenerCells(listener: ElementListener): string[] {
  const flags = [
    listener.useCapture && 'capture',
    listener.passive && 'passive',
    listener.once && 'once',
  ].filter(Boolean);
  const preview = flags.length > 0 ? `[${flags.join(', ')}] ` : '';
  return [
    listener.on,
    listener.node,
    truncateByLength(listener.handler.name || ANONYMOUS, NAME_MAX_LENGTH),
    handlerLocation(listener.handler),
    `${preview}${listener.handler.preview}`,
  ];
}

/**
 * Lay out rows as aligned columns (the last column is not padded).
 *
 * @param rows - Row cells
 * @returns Lines
 */
function alignColumns(rows: string[][]): string[] {
  const widths = (rows[0] ?? []).map((_, column) =>
    Math.max(...rows.map((row) => (row[column] ?? '').length))
  );
  return rows.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join('  ')
  );
}

/**
 * Format `bdg dom listeners` output: listeners grouped by event type,
 * nearest first, with a note for events handled only by delegation.
 *
 * @param result - Listener report
 * @param types - Event types asked for with --type, if any
 * @returns Formatted output
 */
export function formatListeners(result: ListenersOutput, types?: string[]): string {
  const fmt = new OutputFormatter();
  if (result.listeners.length === 0) {
    fmt.text(noListenersMessage(result.element, types));
    fmt.tip(NO_LISTENERS_HINT);
  } else {
    fmt.text(listenersHeadline(result.element, result.listeners.length));
    appendListenerGroups(fmt, result.listeners);
    const delegated = delegatedOnlyTypes(result.listeners);
    if (delegated.length > 0) fmt.blank().text(delegatedListenersNote(delegated));
  }
  if (result.warning) fmt.blank().text(`⚠ Warning: ${result.warning}`);
  return fmt.build();
}

/**
 * Add one block per event type: the type, then its listeners.
 *
 * @param fmt - Output being built
 * @param listeners - Listeners, grouped by type
 */
function appendListenerGroups(fmt: OutputFormatter, listeners: ElementListener[]): void {
  const lines = alignColumns(listeners.map(listenerCells));
  listeners.forEach((listener, i) => {
    if (listener.type !== listeners[i - 1]?.type) fmt.blank().text(listener.type);
    fmt.text(`  ${lines[i] ?? ''}`);
  });
}
