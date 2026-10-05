/**
 * Page-side functions of `bdg dom listeners`: what only the page can tell
 * about an element's listeners (handler names and identities, React root
 * containers, the handlers behind jQuery's dispatcher and Preact's event
 * proxy, React's `on…` props of the element and its ancestors, the
 * element's iframe).
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
 * `(object, key) => value`: an own data property, read without running a
 * getter the page may have defined (undefined for accessors and on errors).
 */
const OWN_VALUE_JS = `(object, key) => {
  try {
    const descriptor = object ? Object.getOwnPropertyDescriptor(object, key) : undefined;
    return descriptor ? descriptor.value : undefined;
  } catch (e) { return undefined; }
}`;

/**
 * `(node, prefixes) => value`: the value of the node's own key starting with
 * one of `prefixes` (React's keys end in a random suffix).
 */
const REACT_KEY_JS = `(node, prefixes) => {
  try {
    const key = Object.keys(node).find((k) => prefixes.some((prefix) => k.startsWith(prefix)));
    return key === undefined ? undefined : (${OWN_VALUE_JS})(node, key);
  } catch (e) { return undefined; }
}`;

/** `(node) => fiber | undefined`: React's fiber of a DOM element */
const REACT_FIBER_JS = `(node) => (${REACT_KEY_JS})(node, ['__reactFiber$', '__reactInternalInstance$'])`;

/**
 * `(node) => object | null`: the props React rendered on a DOM element:
 * `__reactProps$…` (React 17-19), `__reactEventHandlers$…` (React 16), else
 * the `memoizedProps` of its fiber.
 */
const REACT_PROPS_JS = `(node) => {
  if (!node || node.nodeType !== 1) return null;
  const props = (${REACT_KEY_JS})(node, ['__reactProps$', '__reactEventHandlers$']);
  if (props && typeof props === 'object') return props;
  const memoized = (${OWN_VALUE_JS})((${REACT_FIBER_JS})(node), 'memoizedProps');
  return memoized && typeof memoized === 'object' ? memoized : null;
}`;

/** Most fibers walked up from the element (guards against cycles) */
const MAX_FIBER_STEPS = 1000;

/**
 * `(fiber) => fiber | null`: for a React root's fiber, the fiber of the
 * nearest React-rendered DOM element at or above its container (where
 * React continues for nested roots: an outer root's handlers run for
 * events in an inner one); null for other fibers and for top-level roots.
 */
const OUTER_ROOT_FIBER_JS = `(fiber) => {
  const own = ${OWN_VALUE_JS};
  const container = own(own(fiber, 'stateNode'), 'containerInfo');
  try {
    for (let node = container; node && typeof node === 'object'; node = node.parentNode) {
      const outer = (${REACT_FIBER_JS})(node);
      if (outer) return outer;
    }
  } catch (e) { return null; }
  return null;
}`;

/**
 * `(element, nodes) => Array<{ node, position }>`: the DOM elements whose
 * React props run for events on the element, nearest first. With a fiber,
 * the host components on its `.return` path (so a portal's React parents
 * count and DOM parents outside the React path don't), continued from a
 * nested root's container into the outer root; `position` is the node's
 * place in the chain, null outside it. Without one, the chain's elements.
 */
const REACT_HOSTS_JS = `(element, nodes) => {
  const own = ${OWN_VALUE_JS};
  let fiber = (${REACT_FIBER_JS})(element);
  if (!fiber) return nodes.flatMap((node, position) => (node && node.nodeType === 1 ? [{ node, position }] : []));
  const hosts = [];
  const seen = new Set();
  for (let step = 0; fiber && typeof fiber === 'object' && !seen.has(fiber) && step < ${MAX_FIBER_STEPS}; step++) {
    seen.add(fiber);
    const node = own(fiber, 'stateNode');
    if (typeof own(fiber, 'type') === 'string' && node && node.nodeType === 1) {
      const position = nodes.indexOf(node);
      hosts.push({ node, position: position === -1 ? null : position });
    }
    fiber = own(fiber, 'return') || (${OUTER_ROOT_FIBER_JS})(fiber);
  }
  return hosts;
}`;

/**
 * `(node, type, capture, handler) => function | null`: the handler Preact
 * runs from `handler` when it is Preact's event proxy on `node`. Preact
 * keeps an element's handlers in an object on the element under a mangled
 * key (`l` in Preact 10, `__e` in 11, `_listeners` in 8 and unmangled
 * builds), keyed by event type plus the capture flag (`clickfalse`; the
 * type alone in Preact 8); the key is read from the proxy's own source
 * (`this.l[e.type + useCapture]`), so it follows Preact's renames.
 */
const PREACT_HANDLER_JS = `(node, type, capture, handler) => {
  const own = ${OWN_VALUE_JS};
  try {
    if (typeof handler !== 'function' || !node || typeof node !== 'object') return null;
    const proxy = /this\\.([\\w$]+)\\[[\\w$]+\\.type(\\s*\\+)?/.exec(Function.prototype.toString.call(handler));
    const store = proxy ? own(node, proxy[1]) : undefined;
    if (!store || typeof store !== 'object') return null;
    const fn = own(store, proxy[2] ? type + capture : type);
    return typeof fn === 'function' ? fn : null;
  } catch (e) { return null; }
}`;

/** `(node) => string`: CDP-like description of an element, e.g. `div#app.card` */
const DESCRIBE_NODE_JS = `(node) => {
  try {
    const classes = Array.from(node.classList || []).map((c) => '.' + c).join('');
    return String(node.localName || 'element') + (node.id ? '#' + node.id : '') + classes;
  } catch (e) { return 'element'; }
}`;

/**
 * `(props) => Array<{ prop, handler, name }>`: the event handler props
 * (`onClick`, `onKeyDownCapture`) among React props, read without
 * running getters.
 */
const REACT_HANDLER_PROPS_JS = `(props) => {
  const own = ${OWN_VALUE_JS};
  try {
    return Object.keys(props).filter((prop) => /^on[A-Z]/.test(prop)).flatMap((prop) => {
      const handler = own(props, prop);
      if (typeof handler !== 'function') return [];
      const name = own(handler, 'name');
      return [{ prop, handler, name: typeof name === 'string' ? name : '' }];
    });
  } catch (e) { return []; }
}`;

/**
 * `(prop) => { type, capture }`: the DOM event type and phase of a React
 * handler prop: `onClick` → click, `onClickCapture` → click in the capture
 * phase, `onDoubleClick` → dblclick, `onFocus`/`onBlur` → focusin/focusout
 * (the events React listens for), `onGotPointerCapture` → gotpointercapture
 * (and `onGotPointerCaptureCapture` its capture phase).
 */
const REACT_EVENT_TYPE_JS = `(prop) => {
  const base = prop.slice(2);
  const capture = base.endsWith('Capture') && !/^(?:Got|Lost)PointerCapture$/.test(base);
  const name = (capture ? base.slice(0, -7) : base).toLowerCase();
  const types = { doubleclick: 'dblclick', focus: 'focusin', blur: 'focusout' };
  return { type: types[name] || name, capture };
}`;

/**
 * Event types React does not bubble to parents (their bubble-phase props on
 * ancestors never run for the element): enter/leave, scroll (React 17+),
 * and the events React listens for on the element itself (media, load, …).
 */
const REACT_NON_BUBBLING_TYPES = [
  'mouseenter',
  'mouseleave',
  'pointerenter',
  'pointerleave',
  'scroll',
  'scrollend',
  'load',
  'error',
  'abort',
  'cancel',
  'close',
  'invalid',
  'toggle',
  'canplay',
  'canplaythrough',
  'durationchange',
  'emptied',
  'encrypted',
  'ended',
  'loadeddata',
  'loadedmetadata',
  'loadstart',
  'pause',
  'play',
  'playing',
  'progress',
  'ratechange',
  'seeked',
  'seeking',
  'stalled',
  'suspend',
  'timeupdate',
  'volumechange',
  'waiting',
];

/**
 * `(element, nodes, wanted, fns) => { react, reactSkipped }`: the React
 * `on…` props that run for events on the element (its own, and bubbling or
 * capture ones of its React parents), limited to the `wanted` types (all
 * when null); their functions are pushed to `fns`.
 */
const REACT_HANDLERS_JS = `(element, nodes, wanted, fns) => {
  const nonBubbling = new Set(${JSON.stringify(REACT_NON_BUBBLING_TYPES)});
  const react = [];
  let reactSkipped = 0;
  (${REACT_HOSTS_JS})(element, nodes).forEach(({ node, position }, depth) => {
    const props = (${REACT_PROPS_JS})(node);
    if (!props) return;
    for (const { prop, handler, name } of (${REACT_HANDLER_PROPS_JS})(props)) {
      const { type, capture } = (${REACT_EVENT_TYPE_JS})(prop);
      if ((wanted && !wanted.has(type)) || (depth > 0 && !capture && nonBubbling.has(type))) continue;
      if (react.length >= ${MAX_REACT_HANDLERS}) { reactSkipped++; continue; }
      fns.push(handler);
      react.push({ position, ...(position === null && { node: (${DESCRIBE_NODE_JS})(node) }), prop, type, capture, name });
    }
  });
  return { react, reactSkipped };
}`;

/**
 * Page function, called on the element with the listeners (position in the
 * chain, event type and capture flag of each), the requested event types (null for all;
 * React props are filtered before the limit), then the chain's objects, then each
 * listener's handler, then the function each handler calls (a bound
 * function's target, else null).
 *
 * Returns `[info, ...jQueryAndPreactHandlers, ...reactHandlers]`. `info` has the
 * iframe element holding the element's document (`frame`), a framework
 * label per chain entry (`roots`), per listener the handler's name, the
 * identity and name of the function it calls (equal identities are the same
 * function object) and, for jQuery's dispatcher, the jQuery handlers that
 * run for the element, for Preact's event proxy the handler Preact runs
 * (`preact`); then the React `on…` props that run for the
 * element's events (`react`, see {@link REACT_HANDLERS_JS}). Their functions follow `info` in the same order.
 * After {@link MAX_JQUERY_HANDLERS}, dispatchers stay unresolved and are
 * counted in `jquerySkipped`; after {@link MAX_REACT_HANDLERS}, React props
 * are counted in `reactSkipped`.
 */
export const ELEMENT_INFO_JS = `function (listeners, types, ...rest) {
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
    if (!resolved) {
      const preact = (${PREACT_HANDLER_JS})(nodes[listener.position], listener.type, listener.capture, handler);
      if (!preact) return entry;
      fns.push(preact);
      const preactName = (${OWN_VALUE_JS})(preact, 'name');
      return { ...entry, preact: { name: typeof preactName === 'string' ? preactName : '' } };
    }
    if (fns.length + resolved.length > ${MAX_JQUERY_HANDLERS}) {
      jquerySkipped += resolved.length;
      return entry;
    }
    return { ...entry, jquery: resolved.map(describeHandler) };
  });
  const roots = nodes.map((node) => ((${REACT_ROOT_JS})(node) ? 'React root' : null));
  const wanted = types && types.length > 0 ? new Set(types) : null;
  const { react, reactSkipped } = (${REACT_HANDLERS_JS})(this, nodes, wanted, fns);
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
    /** The handler Preact runs from this listener (set when it is Preact's event proxy) */
    preact?: { name: string };
  }>;
  /** jQuery handlers left unresolved (over the limit) */
  jquerySkipped: number;
  /** React `on…` props that run for the element's events, nearest first */
  react: Array<{
    /** Position of the element the prop is on in the chain (0 = the inspected element); null outside it (a portal's React parent) */
    position: number | null;
    /** Description of that element when it is outside the chain */
    node?: string;
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
