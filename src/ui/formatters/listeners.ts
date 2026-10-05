/**
 * Human-readable output of `bdg dom listeners`.
 */

import type {
  CollapsedListeners,
  ElementListener,
  ListenersResult,
} from '@/ipc/protocol/domTypes.js';
import { delegationNotes } from '@/runtime/dom/listenerSummary.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  COLLAPSED_LISTENERS_HEADING,
  NO_LISTENERS_HINT,
  collapsedListenersSummary,
  delegationNote,
  eventTypeSuggestion,
  jqueryHandlersSkippedNote,
  listenersHeadline,
  noListenersMessage,
  reactHandlersSkippedNote,
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
    listener.reactProp ? `React ${listener.reactProp}` : listener.framework,
    listener.delegateSelector && `delegate ${listener.delegateSelector}`,
    listener.noop && 'no-op',
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

/** Dispatcher names listed per collapsed framework root */
const COLLAPSED_HANDLERS_SHOWN = 3;

/**
 * Format `bdg dom listeners` output: listeners grouped by event type, the
 * handlers nearest the element first, then one line per framework root,
 * with notes for events the element has no listener of its own for.
 *
 * @param result - Listener report
 * @param types - Event types asked for with --type, if any
 * @returns Formatted output
 */
export function formatListeners(result: ListenersOutput, types?: string[]): string {
  const fmt = new OutputFormatter();
  const collapsed = result.collapsed ?? [];
  if (result.listeners.length === 0 && collapsed.length === 0) {
    fmt.text(noListenersMessage(result.element, types));
    if (result.typeSuggestions?.length) fmt.text(eventTypeSuggestion(result.typeSuggestions));
    fmt.tip(NO_LISTENERS_HINT);
  } else {
    const count = collapsed.reduce((sum, root) => sum + root.count, result.listeners.length);
    fmt.text(listenersHeadline(result.element, count, result));
    appendListenerGroups(fmt, result.listeners);
    appendCollapsed(fmt, collapsed);
    appendDelegationNotes(fmt, result.listeners, collapsed);
  }
  if (result.jqueryHandlersSkipped) {
    fmt.blank().text(jqueryHandlersSkippedNote(result.jqueryHandlersSkipped));
  }
  if (result.reactHandlersSkipped) {
    fmt.blank().text(reactHandlersSkippedNote(result.reactHandlersSkipped));
  }
  if (result.warning) fmt.blank().text(`⚠ Warning: ${result.warning}`);
  return fmt.build();
}

/**
 * Add a note per way events reach their handlers without a listener on the
 * element itself (React props, React root, jQuery, plain delegation).
 *
 * @param fmt - Output being built
 * @param listeners - Listeners
 * @param collapsed - Collapsed roots
 */
function appendDelegationNotes(
  fmt: OutputFormatter,
  listeners: ElementListener[],
  collapsed: CollapsedListeners[]
): void {
  const notes = delegationNotes(listeners, collapsed).flatMap((note) => delegationNote(note) ?? []);
  if (notes.length > 0) fmt.blank();
  notes.forEach((note) => fmt.text(note));
}

/**
 * Add the collapsed framework roots, one line per node.
 *
 * @param fmt - Output being built
 * @param collapsed - Collapsed roots
 */
function appendCollapsed(fmt: OutputFormatter, collapsed: CollapsedListeners[]): void {
  if (collapsed.length === 0) return;
  fmt.blank().text(COLLAPSED_LISTENERS_HEADING);
  const rows = collapsed.map((root) => {
    const names = root.handlers.map((handler) =>
      truncateByLength(handler.name || ANONYMOUS, NAME_MAX_LENGTH)
    );
    const shown = [...new Set(names)].slice(0, COLLAPSED_HANDLERS_SHOWN);
    return [root.on, root.node, collapsedListenersSummary({ ...root, handlers: shown })];
  });
  alignColumns(rows).forEach((line) => fmt.text(`  ${line}`));
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
