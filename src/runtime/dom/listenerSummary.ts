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

/** Names of React's event dispatchers (development builds keep them) */
const REACT_DISPATCHER_NAMES = new Set([
  'dispatchDiscreteEvent',
  'dispatchContinuousEvent',
  'dispatchEvent',
]);

/** Label of a recognised React root container */
const REACT_ROOT = 'React root';

/** What the page reported about one listener's handler */
export interface HandlerDetails {
  /** `Function.name` of the handler */
  name?: string | undefined;
  /**
   * Identity of the function the handler calls (bound functions unwrapped to
   * their target): equal ids are the same function object
   */
  identity?: number | undefined;
  /** `Function.name` of that function */
  targetName?: string | undefined;
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

/** A React `on…` prop handler of the element or one of its ancestors */
export interface ReactPropHandler extends ResolvedHandler {
  /** Position in the chain of the element the prop is on (0 = the element) */
  position: number;
  /** Prop name, e.g. `onClickCapture` */
  prop: string;
  /** Runs in the capture phase (`on…Capture`) */
  capture: boolean;
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
  /** Identity of the handler's function (unique when unknown) */
  identity: string;
  /** Name of the handler's function, bound functions unwrapped */
  targetName?: string | undefined;
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
 * Report entries for React's `on…` props: React runs them from its root
 * container's dispatchers, for the element the prop is on.
 *
 * @param found - Listeners per chain entry (every entry of the chain)
 * @param react - React prop handlers, in chain order
 * @returns Entries, one per prop
 */
function placeReactProps(found: ChainListeners[], react: ReactPropHandler[]): PlacedListener[] {
  return react.flatMap((resolved, i) => {
    const owner = found.find((item) => item.position === resolved.position);
    if (!owner) return [];
    const listener: ElementListener = {
      type: resolved.type,
      on: listenerPlacement(owner.entry, owner.position),
      node: describeChainEntry(owner.entry),
      useCapture: resolved.capture,
      passive: false,
      once: false,
      handler: {
        name: resolved.name || functionNameFromSource(resolved.source),
        preview: handlerPreview(resolved.source),
        scriptId: resolved.scriptId,
        lineNumber: resolved.lineNumber,
        columnNumber: resolved.columnNumber,
      },
      framework: 'React',
      reactProp: resolved.prop,
    };
    return [{ position: owner.position, entry: owner.entry, listener, identity: `react-${i}` }];
  });
}

/**
 * Identity of a dispatcher: the node and the function object it calls.
 *
 * @param placed - Report entry
 * @returns Key, unique per node and function
 */
function dispatcherKey({ position, identity }: PlacedListener): string {
  return `${position}|${identity}`;
}

/**
 * The framework a node's listeners belong to: a React root container
 * (recognised by React's keys on the node, or by its dispatchers' names).
 *
 * @param nodeListeners - Listeners of one node
 * @returns Framework label, undefined when none is recognised
 */
function nodeFramework(nodeListeners: PlacedListener[]): string | undefined {
  const [first] = nodeListeners;
  if (first?.entry.framework) return first.entry.framework;
  const hasDispatcher = nodeListeners.some((item) =>
    REACT_DISPATCHER_NAMES.has(item.targetName ?? '')
  );
  return hasDispatcher ? REACT_ROOT : undefined;
}

/**
 * Summarise one node's dispatcher listeners.
 *
 * @param group - Listeners of one node (not empty)
 * @param framework - Framework recognised on the node
 * @returns Collapsed entry
 */
function summarizeNode(group: PlacedListener[], framework: string): CollapsedListeners {
  const first = group[0] as PlacedListener;
  const handlers = new Map(group.map((placed) => [dispatcherKey(placed), placed.listener.handler]));
  return {
    on: first.listener.on,
    node: first.listener.node,
    framework,
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
 * A framework root's dispatcher listeners: those of function objects that
 * each listen for several event types, when together they cover many types.
 *
 * @param nodeListeners - Listeners of one node
 * @returns The dispatchers and the framework, or undefined when the node is no framework root
 */
function frameworkDispatchers(
  nodeListeners: PlacedListener[]
): { framework: string; dispatchers: PlacedListener[] } | undefined {
  const framework = nodeFramework(nodeListeners);
  if (!framework) return undefined;
  const candidates = nodeListeners.filter((item) => !item.listener.framework);
  const dispatchers = [...groupBy(candidates, dispatcherKey).values()]
    .filter((group) => typeCount(group) >= DISPATCHER_MIN_TYPES)
    .flat();
  return typeCount(dispatchers) >= COLLAPSE_MIN_TYPES ? { framework, dispatchers } : undefined;
}

/**
 * Collapse framework roots: on a recognised React root container (not the
 * element itself), function objects that each listen for several event
 * types, and together for many, are React's dispatchers. Each root's
 * dispatchers become one summary entry; other multi-type handlers (an
 * analytics listener on `document`) are kept as they are.
 *
 * @param placed - Report entries
 * @returns Entries kept as they are, and one summary per framework root
 */
export function collapseFrameworkRoots(placed: PlacedListener[]): {
  kept: PlacedListener[];
  collapsed: CollapsedListeners[];
} {
  const ancestors = placed.filter((item) => item.position > 0);
  const roots = [...groupBy(ancestors, (item) => item.position).values()].flatMap(
    (nodeListeners) => frameworkDispatchers(nodeListeners) ?? []
  );
  const collapsedItems = new Set(roots.flatMap((root) => root.dispatchers));
  return {
    kept: placed.filter((item) => !collapsedItems.has(item)),
    collapsed: roots.map((root) => summarizeNode(root.dispatchers, root.framework)),
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
      identity: detail.identity === undefined ? `listener-${i}` : `fn-${detail.identity}`,
      targetName: detail.targetName,
    }));
  });
}

/** Sort rank of no-op handlers: after every handler that does something */
const NOOP_RANK = Number.MAX_SAFE_INTEGER;

/**
 * Sort rank of a report entry: its distance from the element, no-ops last.
 *
 * @param placed - Report entry
 * @returns Rank (lower comes first)
 */
function handlerRank({ listener, position }: PlacedListener): number {
  return listener.noop ? NOOP_RANK : position;
}

/**
 * Order report entries so the handlers that run for the element come
 * first: event types whose nearest handler (no-ops aside) is closest to the
 * element first (alphabetically on ties), and within a type, nearest first
 * with no-ops last and, on one node, framework handlers (React props, jQuery
 * handlers) before plain listeners.
 *
 * @param placed - Report entries
 * @returns Entries in report order
 */
function orderListeners(placed: PlacedListener[]): PlacedListener[] {
  const typeRank = new Map<string, number>();
  for (const item of placed) {
    const type = item.listener.type;
    typeRank.set(type, Math.min(typeRank.get(type) ?? NOOP_RANK, handlerRank(item)));
  }
  const rankOf = (item: PlacedListener): number => typeRank.get(item.listener.type) ?? NOOP_RANK;
  return [...placed].sort(
    (a, b) =>
      rankOf(a) - rankOf(b) ||
      a.listener.type.localeCompare(b.listener.type) ||
      handlerRank(a) - handlerRank(b) ||
      a.position - b.position ||
      Number(!a.listener.framework) - Number(!b.listener.framework)
  );
}

/**
 * Build the listener report: React's `on…` props added, filtered to `types`
 * (if given), framework roots collapsed (unless `all`), grouped by event
 * type with the handlers nearest the element first (see {@link orderListeners}).
 *
 * @param found - Listeners per chain entry, in chain order
 * @param details - Per flattened listener: handler name, jQuery handlers (missing = unknown)
 * @param options - Event types to keep, whether to keep every root listener
 * @param react - React prop handlers of the element and its ancestors
 * @returns Ordered listeners and collapsed framework roots
 */
export function buildListenerReport(
  found: ChainListeners[],
  details: HandlerDetails[],
  options: ReportOptions = {},
  react: ReactPropHandler[] = []
): ListenerReport {
  const { types, all } = options;
  const placed = [...placeListeners(found, details), ...placeReactProps(found, react)].filter(
    ({ listener }) => !types?.length || types.includes(listener.type)
  );
  const { kept, collapsed } = all
    ? { kept: placed, collapsed: [] }
    : collapseFrameworkRoots(placed);
  return { listeners: orderListeners(kept).map(({ listener }) => listener), collapsed };
}

/**
 * How an event type without a listener of its own on the element reaches
 * its handlers:
 * - `react`: React runs `on…` props listed in the report (from its root)
 * - `react-root`: a React root listens for it, but no `on…` prop was found
 * - `jquery`: jQuery runs delegated handlers listed in the report
 * - `delegated`: plain listeners on ancestors, document or window
 */
export type DelegationKind = 'react' | 'react-root' | 'jquery' | 'delegated';

/** Interaction event types handled the same way, for the report's notes */
export interface DelegationNote {
  kind: DelegationKind;
  /** Event types, in report order */
  types: string[];
  /** Those of `types` whose only listener on the element is a no-op (React's placeholder) */
  placeholderTypes: string[];
  /** The node handling them: the React root container or jQuery's node */
  node?: string | undefined;
}

/** Order of the notes */
const DELEGATION_KINDS: DelegationKind[] = ['react', 'react-root', 'jquery', 'delegated'];

/**
 * How one event type reaches its handlers, if not by a listener of the element.
 *
 * @param type - Event type
 * @param listeners - Listener report
 * @param collapsed - Collapsed framework roots
 * @returns Kind and handling node, undefined when the element has its own listener
 */
function delegationOf(
  type: string,
  listeners: ElementListener[],
  collapsed: CollapsedListeners[]
): { kind: DelegationKind; node?: string | undefined } | undefined {
  const ofType = listeners.filter((l) => l.type === type);
  const ownListener = ofType.some((l) => l.on === 'target' && !l.noop && l.framework !== 'React');
  if (ownListener) return undefined;
  if (ofType.some((l) => l.framework === 'React')) return { kind: 'react' };
  const root = collapsed.find((c) => c.framework === REACT_ROOT && c.types.includes(type));
  if (root) return { kind: 'react-root', node: root.node };
  const jquery = ofType.find((l) => l.framework === 'jQuery');
  if (jquery) return { kind: 'jquery', node: jquery.node };
  return { kind: 'delegated' };
}

/**
 * Notes for interaction event types the element has no listener of its own
 * for (no-ops aside), grouped by how they reach their handlers: React `on…`
 * props, a React root without props, jQuery delegation, or plain listeners
 * on ancestors, document or window.
 *
 * @param listeners - Listener report
 * @param collapsed - Collapsed framework roots
 * @returns Notes, React first; none when every type has a listener on the element
 */
export function delegationNotes(
  listeners: ElementListener[],
  collapsed: CollapsedListeners[] = []
): DelegationNote[] {
  const types = [
    ...new Set([...listeners.map((l) => l.type), ...collapsed.flatMap((c) => c.types)]),
  ].filter((type) => INTERACTION_EVENT_TYPES.has(type));
  const notes = new Map<DelegationKind, DelegationNote>();
  for (const type of types) {
    const delegation = delegationOf(type, listeners, collapsed);
    if (!delegation) continue;
    const note = notes.get(delegation.kind) ?? {
      kind: delegation.kind,
      types: [],
      placeholderTypes: [],
      node: delegation.node,
    };
    note.types.push(type);
    if (listeners.some((l) => l.type === type && l.on === 'target' && l.noop)) {
      note.placeholderTypes.push(type);
    }
    notes.set(delegation.kind, note);
  }
  return DELEGATION_KINDS.flatMap((kind) => notes.get(kind) ?? []);
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
