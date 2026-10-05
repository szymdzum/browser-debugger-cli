/**
 * Turning CDP event listener data into the `bdg dom listeners` report.
 *
 * Pure functions: the daemon collects the listeners of an element, its
 * ancestors, its document and window (`inspectEventListeners`), and
 * these name, place, filter and order them.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import type {
  CollapsedListeners,
  ElementListener,
  ListenerPlacement,
} from '@/ipc/protocol/domTypes.js';
import { truncateByLength } from '@/utils/strings.js';
import { findSimilar } from '@/utils/suggestions.js';

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
  /** Framework recognised on the node, e.g. `React root` */
  framework?: string | undefined;
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

/** Distinct event types one function must handle on a node to count as a dispatcher */
const DISPATCHER_MIN_TYPES = 3;

/** Distinct event types a node's dispatchers must handle together to be collapsed */
const COLLAPSE_MIN_TYPES = 8;

/** What the page reported about one listener's handler */
export interface HandlerDetails {
  /** `Function.name` of the handler */
  name?: string | undefined;
  /** Handlers jQuery runs from this listener (set when it is jQuery's dispatcher) */
  jquery?: ResolvedHandler[] | undefined;
}

/** A handler registered through a framework, found behind its dispatcher */
export interface ResolvedHandler {
  /** Event type it was registered for */
  type: string;
  /** Delegate selector, for delegated handlers */
  selector?: string | undefined;
  /** `Function.name` */
  name: string;
  /** Function source */
  source?: string | undefined;
  scriptId: string;
  lineNumber: number;
  columnNumber: number;
}

/** What to keep in the report */
export interface ReportOptions {
  /** Event types to keep (default: all) */
  types?: string[] | undefined;
  /** Keep every framework root listener instead of a summary per node */
  all?: boolean | undefined;
}

/** The `bdg dom listeners` report */
export interface ListenerReport {
  listeners: ElementListener[];
  collapsed: CollapsedListeners[];
}

/** A report entry with its position in the chain */
export interface PlacedListener {
  position: number;
  entry: ChainEntry;
  listener: ElementListener;
}

/**
 * Whether a function source is an empty function (`function u0(){}`,
 * `() => {}`): React sets one as `onclick` on clickable elements.
 *
 * @param source - Function source
 * @returns True for a handler that does nothing
 */
export function isNoopSource(source: string | undefined): boolean {
  const text = (source ?? '').replace(/\s+/g, '');
  return /^(?:function[\w$]*\(\)|\(\)=>)\{\}$/.test(text);
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
    ...(isNoopSource(source) && { noop: true as const }),
  };
}

/**
 * Report entries for a jQuery dispatcher: one per jQuery handler that runs
 * for the element, with the dispatcher's flags.
 *
 * @param dispatcher - Entry built for jQuery's own listener
 * @param handlers - Handlers behind it
 * @returns Entries naming the real handlers
 */
function jqueryListeners(
  dispatcher: ElementListener,
  handlers: ResolvedHandler[]
): ElementListener[] {
  return handlers.map((resolved) => ({
    ...dispatcher,
    handler: {
      name: resolved.name || functionNameFromSource(resolved.source),
      preview: handlerPreview(resolved.source),
      scriptId: resolved.scriptId,
      lineNumber: resolved.lineNumber,
      columnNumber: resolved.columnNumber,
    },
    framework: 'jQuery' as const,
    ...(resolved.selector && { delegateSelector: resolved.selector }),
  }));
}

/**
 * Identity of a dispatcher function: name and source location.
 *
 * @param placed - Report entry
 * @returns Key, unique per node and function
 */
function dispatcherKey({ position, listener: { handler } }: PlacedListener): string {
  return `${position}|${handler.name}|${handler.scriptId}:${handler.lineNumber}:${handler.columnNumber}`;
}

/**
 * Summarise one node's dispatcher listeners.
 *
 * @param group - Listeners of one node (not empty)
 * @returns Collapsed entry
 */
function summarizeNode(group: PlacedListener[]): CollapsedListeners {
  const first = group[0] as PlacedListener;
  const handlers = new Map(group.map((placed) => [dispatcherKey(placed), placed.listener.handler]));
  return {
    on: first.listener.on,
    node: first.listener.node,
    ...(first.entry.framework && { framework: first.entry.framework }),
    types: [...new Set(group.map(({ listener }) => listener.type))].sort(),
    count: group.length,
    capture: group.some(({ listener }) => listener.useCapture),
    bubble: group.some(({ listener }) => !listener.useCapture),
    handlers: [...handlers.values()],
  };
}

/**
 * Group items by a key, keeping their order.
 *
 * @param items - Items
 * @param keyOf - Key of an item
 * @returns Groups by key
 */
function groupBy<T, K>(items: T[], keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return groups;
}

/**
 * Distinct event types of listeners.
 *
 * @param items - Report entries
 * @returns Number of types
 */
function typeCount(items: PlacedListener[]): number {
  return new Set(items.map(({ listener }) => listener.type)).size;
}

/**
 * A node's dispatcher listeners: those of functions that each listen for
 * several event types, when together they cover many types.
 *
 * @param nodeListeners - Listeners of one node
 * @returns Its dispatcher listeners (none when it is no framework root)
 */
function dispatcherListeners(nodeListeners: PlacedListener[]): PlacedListener[] {
  const candidates = nodeListeners.filter((item) => !item.listener.framework);
  const dispatchers = [...groupBy(candidates, dispatcherKey).values()]
    .filter((group) => typeCount(group) >= DISPATCHER_MIN_TYPES)
    .flat();
  return typeCount(dispatchers) >= COLLAPSE_MIN_TYPES ? dispatchers : [];
}

/**
 * Collapse framework roots: on a node other than the element, functions
 * that each listen for several event types, and together for many (React's
 * dispatchers on its root container), are framework dispatchers. Each
 * node's dispatchers become one summary entry.
 *
 * @param placed - Report entries
 * @returns Entries kept as they are, and one summary per node with dispatchers
 */
export function collapseFrameworkRoots(placed: PlacedListener[]): {
  kept: PlacedListener[];
  collapsed: CollapsedListeners[];
} {
  const ancestors = placed.filter((item) => item.position > 0);
  const groups = [...groupBy(ancestors, (item) => item.position).values()]
    .map(dispatcherListeners)
    .filter((group) => group.length > 0);
  const collapsedItems = new Set(groups.flat());
  return {
    kept: placed.filter((item) => !collapsedItems.has(item)),
    collapsed: groups.map(summarizeNode),
  };
}

/**
 * Report entries of every listener, jQuery dispatchers replaced by the
 * handlers they run for the element.
 *
 * @param found - Listeners per chain entry, in chain order
 * @param details - Per flattened listener: handler name, jQuery handlers
 * @returns Entries in chain order
 */
function placeListeners(found: ChainListeners[], details: HandlerDetails[]): PlacedListener[] {
  const flat = found.flatMap((entry) => entry.listeners.map((listener) => ({ entry, listener })));
  return flat.flatMap(({ entry, listener }, i) => {
    const detail = details[i] ?? {};
    const built = toElementListener(listener, entry, detail.name);
    const listeners = detail.jquery ? jqueryListeners(built, detail.jquery) : [built];
    return listeners.map((item) => ({
      position: entry.position,
      entry: entry.entry,
      listener: item,
    }));
  });
}

/**
 * Build the listener report: filtered to `types` (if given), framework
 * roots collapsed (unless `all`), grouped by event type (alphabetically),
 * nearest first within a type.
 *
 * @param found - Listeners per chain entry, in chain order
 * @param details - Per flattened listener: handler name, jQuery handlers (missing = unknown)
 * @param options - Event types to keep, whether to keep every root listener
 * @returns Ordered listeners and collapsed framework roots
 */
export function buildListenerReport(
  found: ChainListeners[],
  details: HandlerDetails[],
  options: ReportOptions = {}
): ListenerReport {
  const { types, all } = options;
  const placed = placeListeners(found, details).filter(
    ({ listener }) => !types?.length || types.includes(listener.type)
  );
  const { kept, collapsed } = all
    ? { kept: placed, collapsed: [] }
    : collapseFrameworkRoots(placed);
  const listeners = kept
    .sort((a, b) => a.listener.type.localeCompare(b.listener.type) || a.position - b.position)
    .map(({ listener }) => listener);
  return { listeners, collapsed };
}

/**
 * Interaction event types that have listeners, but none (that does
 * anything) on the element itself: frameworks (React, jQuery) handle these
 * by delegation.
 *
 * @param listeners - Listener report
 * @param collapsed - Collapsed framework roots
 * @returns Event types, in report order
 */
export function delegatedOnlyTypes(
  listeners: ElementListener[],
  collapsed: CollapsedListeners[] = []
): string[] {
  const delegated = listeners.filter((listener) => listener.on !== 'target');
  const types = [
    ...new Set([
      ...delegated.map((listener) => listener.type),
      ...collapsed.flatMap((c) => c.types),
    ]),
  ];
  return types.filter(
    (type) =>
      INTERACTION_EVENT_TYPES.has(type) &&
      !listeners.some((l) => l.type === type && l.on === 'target' && !l.noop)
  );
}

/**
 * Event types with listeners that a `--type` value probably meant, for an
 * empty result: `Click` → `click`, `onclick` → `click`.
 *
 * @param requested - Types asked for
 * @param available - Types that have listeners
 * @returns Suggestions (none when nothing is close)
 */
export function suggestEventTypes(requested: string[], available: string[]): string[] {
  const suggestions = requested.flatMap((type) => {
    const plain = type.toLowerCase().replace(/^on(?=.)/, '');
    if (available.includes(plain)) return [plain];
    return findSimilar(type, available, { maxDistance: 2, maxSuggestions: 1 });
  });
  return [...new Set(suggestions)].filter((type) => !requested.includes(type));
}
