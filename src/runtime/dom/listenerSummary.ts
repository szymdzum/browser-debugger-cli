/**
 * Turning CDP event listener data into the `bdg dom listeners` report.
 *
 * Pure functions: the daemon collects the listeners of an element, its
 * ancestors, its document and window (`inspectEventListeners`), and
 * these name, place, filter and order them.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type { ElementListener, ListenerPlacement } from '@/ipc/protocol/domTypes.js';
import { truncateByLength } from '@/utils/strings.js';

/** Longest handler source preview */
const PREVIEW_MAX_LENGTH = 80;

/** Longest node description (class lists can be very long) */
const NODE_MAX_LENGTH = 60;

/** Event types a user interaction triggers (for the delegation note) */
const INTERACTION_EVENT_TYPES = new Set([
  'beforeinput',
  'blur',
  'change',
  'click',
  'contextmenu',
  'dblclick',
  'focus',
  'focusin',
  'focusout',
  'input',
  'keydown',
  'keypress',
  'keyup',
  'mousedown',
  'mouseup',
  'pointerdown',
  'pointerup',
  'submit',
  'touchend',
  'touchstart',
]);

/** An event target on the path from the element out to its window. */
export interface ChainEntry {
  /** CDP class name, e.g. `HTMLDivElement`, `HTMLDocument`, `Window` */
  className?: string | undefined;
  /** CDP description, e.g. `div#root.app` */
  description?: string | undefined;
}

/** Listeners found on one entry of the chain. */
export interface ChainListeners {
  /** Position in the chain: 0 is the element itself */
  position: number;
  entry: ChainEntry;
  listeners: Protocol.DOMDebugger.EventListener[];
}

/**
 * Where an entry of the chain sits relative to the element.
 *
 * @param entry - Chain entry
 * @param position - Position in the chain (0 = the element)
 * @returns Placement
 */
export function listenerPlacement(entry: ChainEntry, position: number): ListenerPlacement {
  if (position === 0) return 'target';
  if (entry.className === 'Window') return 'window';
  if (entry.description === '#document') return 'document';
  return 'ancestor';
}

/**
 * Short description of a chain entry, e.g. `div#root.app`.
 *
 * @param entry - Chain entry
 * @returns Description
 */
export function describeChainEntry(entry: ChainEntry): string {
  if (entry.className === 'Window') return 'window';
  if (entry.description === '#document') return 'document';
  if (entry.className === 'ShadowRoot') return '#shadow-root';
  return truncateByLength(entry.description ?? entry.className ?? '?', NODE_MAX_LENGTH);
}

/**
 * First characters of a function's source, on one line.
 *
 * @param source - Function source (the handler's CDP description)
 * @returns Preview
 */
export function handlerPreview(source: string | undefined): string {
  return truncateByLength((source ?? '').replace(/\s+/g, ' ').trim(), PREVIEW_MAX_LENGTH);
}

/**
 * Name of a function as written in its source (fallback when the page could
 * not report `Function.name`).
 *
 * @param source - Function source
 * @returns Name, or '' for anonymous and arrow functions
 */
export function functionNameFromSource(source: string | undefined): string {
  const text = (source ?? '').trim();
  const declared = /^(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(text);
  if (declared?.[1]) return declared[1];
  const method = /^(?:async\s+)?(?:get\s+|set\s+)?([\w$]+)\s*\(/.exec(text);
  return method?.[1] && method[1] !== 'function' ? method[1] : '';
}

/**
 * Build the report entry for one listener.
 *
 * @param listener - CDP listener
 * @param found - Chain entry it is attached to
 * @param name - Handler name reported by the page, if known
 * @returns Listener entry
 */
function toElementListener(
  listener: Protocol.DOMDebugger.EventListener,
  found: ChainListeners,
  name: string | undefined
): ElementListener {
  const source = listener.handler?.description;
  return {
    type: listener.type,
    on: listenerPlacement(found.entry, found.position),
    node: describeChainEntry(found.entry),
    useCapture: listener.useCapture,
    passive: listener.passive,
    once: listener.once,
    handler: {
      name: name ?? functionNameFromSource(source),
      preview: handlerPreview(source),
      scriptId: listener.scriptId,
      lineNumber: listener.lineNumber,
      columnNumber: listener.columnNumber,
    },
  };
}

/**
 * Build the listener report: filtered to `types` (if given), grouped by
 * event type (alphabetically), nearest first within a type.
 *
 * @param found - Listeners per chain entry, in chain order
 * @param names - Handler names in the order of the flattened listeners (missing = unknown)
 * @param types - Event types to keep (default: all)
 * @returns Ordered listeners
 */
export function buildListenerReport(
  found: ChainListeners[],
  names: Array<string | undefined>,
  types?: string[]
): ElementListener[] {
  const flat = found.flatMap((entry) => entry.listeners.map((listener) => ({ entry, listener })));
  const listeners = flat
    .map(({ entry, listener }, i) => ({
      position: entry.position,
      listener: toElementListener(listener, entry, names[i]),
    }))
    .filter(({ listener }) => !types?.length || types.includes(listener.type));
  return listeners
    .sort((a, b) => a.listener.type.localeCompare(b.listener.type) || a.position - b.position)
    .map(({ listener }) => listener);
}

/**
 * Interaction event types that have listeners, but none on the element
 * itself: frameworks (React, jQuery) handle these by delegation.
 *
 * @param listeners - Listener report
 * @returns Event types, in report order
 */
export function delegatedOnlyTypes(listeners: ElementListener[]): string[] {
  const types = [...new Set(listeners.map((listener) => listener.type))];
  return types.filter(
    (type) =>
      INTERACTION_EVENT_TYPES.has(type) &&
      !listeners.some((listener) => listener.type === type && listener.on === 'target')
  );
}
