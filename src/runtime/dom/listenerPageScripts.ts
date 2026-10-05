/**
 * Page-side functions of `bdg dom listeners`: what only the page can tell
 * about an element's listeners (handler names and identities, React root
 * containers, the handlers behind jQuery's dispatcher, React's `on…` props
 * of the element and its ancestors, the element's iframe).
 *
 * Each piece is a function expression in a string, combined into
 * {@link ELEMENT_INFO_JS}; every lookup of page globals is guarded, so a
 * page with odd globals (a throwing `jQuery` getter) only loses that detail.
 */

/** Most jQuery handlers resolved per call; the rest keep jQuery's dispatcher */
export const MAX_JQUERY_HANDLERS = 50;

/** Most React prop handlers resolved per call; the rest are counted */
export const MAX_REACT_HANDLERS = 50;

/** `(element, view) => string | null`: the iframe element holding the element's document */
const FRAME_OF_JS = `(element, view) => {
  try {
    const owner = view && view.frameElement;
    return owner ? owner.tagName.toLowerCase() + (owner.id ? '#' + owner.id : '') : null;
  } catch (e) { return null; }
}`;

/** `(node) => boolean`: whether the node is a React root container */
const REACT_ROOT_JS = `(node) => {
  try {
    return !!node && node.nodeType === 1 &&
      ('_reactRootContainer' in node || Object.keys(node).some((key) => key.startsWith('__reactContainer$')));
  } catch (e) { return false; }
}`;

/** `(view) => jQuery | undefined`: the page's jQuery, when it has one */
const JQUERY_OF_JS = `(view) => {
  try {
    if (!view) return undefined;
    return [view.jQuery, view.$].find((c) => c && typeof c._data === 'function');
  } catch (e) { return undefined; }
}`;

/**
 * `(jq, element, node, type, handler) => handleObj[] | null`: the jQuery
 * handlers that run for `element` when `handler` is jQuery's dispatcher on
 * `node` (delegates only when the element, or an element between it and
 * `node`, matches their selector); null when it is not the dispatcher.
 */
const JQUERY_HANDLERS_JS = `(jq, element, node, type, handler) => {
  try {
    if (typeof handler !== 'function') return null;
    const data = jq._data(node);
    if (!data || data.handle !== handler || !data.events) return null;
    const find = jq.find;
    const matches = (el, selector) => {
      try {
        return find && typeof find.matchesSelector === 'function' ? find.matchesSelector(el, selector) : el.matches(selector);
      } catch (e) { return false; }
    };
    const delegatedTo = (selector) => {
      for (let el = element; el && el !== node; el = el.parentNode) {
        if (el.nodeType === 1 && matches(el, selector)) return true;
      }
      return false;
    };
    return Array.from(data.events[type] || []).filter((h) => !h.selector || delegatedTo(h.selector));
  } catch (e) { return null; }
}`;

/**
 * `(node) => object | null`: the props React rendered on a DOM element:
 * `__reactProps$…` (React 17-19), `__reactEventHandlers$…` (React 16), else
 * the `memoizedProps` of its fiber (`__reactFiber$…`, `__reactInternalInstance$…`).
 */
const REACT_PROPS_JS = `(node) => {
  try {
    if (!node || node.nodeType !== 1) return null;
    const keys = Object.keys(node);
    const own = (prefixes) => keys.find((key) => prefixes.some((prefix) => key.startsWith(prefix)));
    const propsKey = own(['__reactProps$', '__reactEventHandlers$']);
    if (propsKey) return node[propsKey] || null;
    const fiberKey = own(['__reactFiber$', '__reactInternalInstance$']);
    const fiber = fiberKey && node[fiberKey];
    return (fiber && fiber.memoizedProps) || null;
  } catch (e) { return null; }
}`;

/**
 * `(props) => Array<{ prop, handler, name }>`: the event handler props
 * (`onClick`, `onKeyDownCapture`) among React props; a prop whose getter
 * throws is skipped.
 */
const REACT_HANDLER_PROPS_JS = `(props) => {
  const read = (prop) => {
    try {
      const handler = props[prop];
      return typeof handler === 'function' ? { prop, handler, name: String(handler.name || '') } : null;
    } catch (e) { return null; }
  };
  try {
    return Object.keys(props).filter((prop) => /^on[A-Z]/.test(prop)).map(read).filter(Boolean);
  } catch (e) { return []; }
}`;

/**
 * `(prop) => { type, capture }`: the DOM event type and phase of a React
 * handler prop (`onClick` → click, `onDoubleClick` → dblclick,
 * `onClickCapture` → click in the capture phase).
 */
const REACT_EVENT_TYPE_JS = `(prop) => {
  const capture = prop.length > 9 && prop.endsWith('Capture');
  const name = (capture ? prop.slice(2, -7) : prop.slice(2)).toLowerCase();
  return { type: name === 'doubleclick' ? 'dblclick' : name, capture };
}`;

/**
 * Page function, called on the element with the listeners (position in the
 * chain and event type of each), then the chain's objects, then each
 * listener's handler, then the function each handler calls (a bound
 * function's target, else null).
 *
 * Returns `[info, ...jQueryHandlers, ...reactHandlers]`. `info` has the
 * iframe element holding the element's document (`frame`), a framework
 * label per chain entry (`roots`), per listener the handler's name, the
 * identity and name of the function it calls (equal identities are the same
 * function object) and, for jQuery's dispatcher, the jQuery handlers that
 * run for the element; then the React `on…` props of the element and its
 * ancestors (`react`). Their functions follow `info` in the same order.
 * After {@link MAX_JQUERY_HANDLERS}, dispatchers stay unresolved and are
 * counted in `jquerySkipped`; after {@link MAX_REACT_HANDLERS}, React props
 * are counted in `reactSkipped`.
 */
export const ELEMENT_INFO_JS = `function (listeners, ...rest) {
  const count = listeners.length;
  const nodes = rest.slice(0, rest.length - 2 * count);
  const handlers = rest.slice(nodes.length, nodes.length + count);
  const targets = rest.slice(nodes.length + count);
  const view = this.ownerDocument && this.ownerDocument.defaultView;
  const jq = (${JQUERY_OF_JS})(view);
  const ids = new Map();
  const identity = (fn) => {
    if (typeof fn !== 'function') return null;
    if (!ids.has(fn)) ids.set(fn, ids.size);
    return ids.get(fn);
  };
  const fns = [];
  let jquerySkipped = 0;
  const describeHandler = (h) => {
    fns.push(h.handler);
    return { type: h.origType || h.type, selector: h.selector || null,
      name: typeof h.handler === 'function' ? h.handler.name : '' };
  };
  const info = listeners.map((listener, i) => {
    const handler = handlers[i];
    const target = typeof targets[i] === 'function' ? targets[i] : handler;
    const entry = { name: typeof handler === 'function' ? handler.name : null, identity: identity(target),
      targetName: typeof target === 'function' ? target.name : null };
    const resolved = jq ? (${JQUERY_HANDLERS_JS})(jq, this, nodes[listener.position], listener.type, handler) : null;
    if (!resolved) return entry;
    if (fns.length + resolved.length > ${MAX_JQUERY_HANDLERS}) {
      jquerySkipped += resolved.length;
      return entry;
    }
    return { ...entry, jquery: resolved.map(describeHandler) };
  });
  const roots = nodes.map((node) => ((${REACT_ROOT_JS})(node) ? 'React root' : null));
  const react = [];
  let reactSkipped = 0;
  nodes.forEach((node, position) => {
    const props = (${REACT_PROPS_JS})(node);
    if (!props) return;
    for (const { prop, handler, name } of (${REACT_HANDLER_PROPS_JS})(props)) {
      if (react.length >= ${MAX_REACT_HANDLERS}) { reactSkipped++; continue; }
      fns.push(handler);
      react.push({ position, prop, ...(${REACT_EVENT_TYPE_JS})(prop), name });
    }
  });
  return [{ frame: (${FRAME_OF_JS})(this, view), roots, listeners: info, jquerySkipped, react, reactSkipped }, ...fns];
}`;

/** What {@link ELEMENT_INFO_JS} reports, by value */
export interface ElementInfo {
  frame: string | null;
  roots: Array<string | null>;
  listeners: Array<{
    name: string | null;
    identity: number | null;
    targetName: string | null;
    jquery?: Array<{ type: string; selector: string | null; name: string }>;
  }>;
  /** jQuery handlers left unresolved (over the limit) */
  jquerySkipped: number;
  /** React `on…` props of the chain's elements, in chain order */
  react: Array<{
    /** Position of the element in the chain (0 = the inspected element) */
    position: number;
    /** Prop name, e.g. `onClickCapture` */
    prop: string;
    /** DOM event type, e.g. `click` */
    type: string;
    capture: boolean;
    name: string;
  }>;
  /** React props left unresolved (over the limit) */
  reactSkipped: number;
}
