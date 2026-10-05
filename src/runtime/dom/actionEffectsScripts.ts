/**
 * Page scripts behind the "what changed" part of DOM action results: one
 * snapshot before the action ({@link EFFECTS_START_SCRIPT}) and one read after
 * it ({@link EFFECTS_READ_SCRIPT}), plus the snapshot a hover takes of what
 * is shown around its target ({@link REVEAL_SNAPSHOT_JS}).
 */

import { ELEMENT_DESCRIPTION_JS } from '@/runtime/dom/elementInfo.js';

/** Class or id words that mark an element as a message (flash, toast, field error) */
const MESSAGE_WORDS = [
  'flash',
  'alert',
  'error',
  'toast',
  'notice',
  'message',
  'invalid',
  'feedback',
];

/** Elements that show messages by role, plus a cheap prefilter for the class and id words */
const MESSAGE_CANDIDATES = [
  '[role="alert"]',
  '[role="status"]',
  '[aria-live]',
  'output',
  ...MESSAGE_WORDS.flatMap((word) => [`[class*="${word}" i]`, `[id*="${word}" i]`]),
].join(', ');

/** Class or id words that mark an element as a loading indicator */
const LOADER_WORDS = ['loading', 'loader', 'spinner'];

/** Loading indicators by state or role, plus a cheap prefilter for the class and id words */
const LOADER_CANDIDATES = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  ...['load', 'spinner'].flatMap((word) => [`[class*="${word}" i]`, `[id*="${word}" i]`]),
].join(', ');

/** Elements anywhere on the page a hover may show (tooltips, menus, popovers) */
const REVEAL_GLOBAL_CANDIDATES =
  '[role="tooltip"], [role="menu"], [role="listbox"], [role="dialog"], [popover]';

/** Elements of the hovered area whose visibility a hover snapshot keeps */
const MAX_REVEAL_CANDIDATES = 1500;

/** Messages kept per snapshot (after filtering) */
const MAX_MESSAGES = 50;

/** Time a message snapshot may spend before it stops looking (ms) */
const MESSAGES_BUDGET_MS = 5;

/** Time the list of shown elements may spend before it stops looking (ms) */
const SHOWN_BUDGET_MS = 10;

/** Shown elements a read returns at most */
const MAX_SHOWN = 10;

/** Added and removed elements a watch keeps */
const MAX_TRACKED_NODES = 200;

/** Longer texts are containers (a page, a form), not messages */
const MAX_MESSAGE_TEXT = 300;

/** How long a page keeps watching when no read or stop arrives (ms) */
const MAX_WATCH_MS = 30000;

/** Bursts of DOM changes a watch keeps (their times) */
const MAX_BURSTS = 20;

/** Shortest and longest timer an action's handlers start that counts as pending work (ms) */
const MIN_TIMER_MS = 50;
const MAX_TIMER_MS = 10000;

/**
 * Page-side test whether an element is shown: rendered, not aria-hidden,
 * not `visibility: hidden` and not fully transparent.
 */
const SHOWN_JS = `(el) => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0 &&
  (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }))`;

/**
 * Page-side visible text of an element, whitespace collapsed: text in
 * hidden elements, scripts and styles left out, and parts for which `skip`
 * says so. Stops a little over {@link MAX_MESSAGE_TEXT} characters.
 */
const VISIBLE_TEXT_JS = `(el, skip) => {
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (text.length <= ${MAX_MESSAGE_TEXT} && walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!parent || /^(script|style|template|noscript)$/.test(parent.localName) || skip(parent)) continue;
    if (parent.checkVisibility && !parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    text += ' ' + walker.currentNode.data;
  }
  return text.replace(/\\s+/g, ' ').trim();
}`;

/**
 * Page-side test whether an element is part of a message's chrome rather
 * than its text: aria-hidden parts, buttons, and elements whose class or
 * aria-label names a close/dismiss control (`close`, `btn-close`, `close_x`;
 * not `closeable`, `enclosed` or `disclosure`).
 */
export const MESSAGE_CHROME_JS = `(node) => {
  const closer = /(^|[-_\\s])(close|dismiss)($|[-_\\s])/i;
  return node.getAttribute('aria-hidden') === 'true' ||
    /^(button|script|style|template)$/.test(node.localName) ||
    node.getAttribute('role') === 'button' ||
    closer.test(node.getAttribute('class') || '') ||
    closer.test(node.getAttribute('aria-label') || '');
}`;

/**
 * Page-side list of the messages a page shows: visible elements with an
 * alert/status role, `aria-live`, `<output>`, or a class or id word from
 * {@link MESSAGE_WORDS} (timers, marquees and progress bars left out), with
 * their text (parts matching {@link MESSAGE_CHROME_JS}, such as the "×"
 * close link, left out). Elements are filtered first, then the first
 * {@link MAX_MESSAGES} kept, and the whole pass stops after
 * {@link MESSAGES_BUDGET_MS}. Only the innermost of nested messages is kept,
 * described by tag, id and classes (or its role when it has neither,
 * `h3[role="alert"]`). Each element gets a number from `ids` that stays the
 * same within the document, so a later snapshot can tell a new element from
 * one that was there.
 */
const MESSAGES_JS = `(ids) => {
  const deadline = performance.now() + ${MESSAGES_BUDGET_MS};
  const description = ${ELEMENT_DESCRIPTION_JS};
  const chrome = ${MESSAGE_CHROME_JS};
  const shown = ${SHOWN_JS};
  const visibleText = ${VISIBLE_TEXT_JS};
  const describe = (el) => {
    const text = description(el);
    const role = el.getAttribute('role');
    return text === el.localName && role ? text + '[role="' + role + '"]' : text;
  };
  const word = /\\b(${MESSAGE_WORDS.join('|')})\\b/i;
  const named = (el) => !/^(timer|marquee|progressbar)$/.test(el.getAttribute('role') || '') &&
    (el.matches('[role="alert"], [role="status"], [aria-live]:not([aria-live="off"]), output') ||
      word.test(el.getAttribute('class') || '') || word.test(el.id || ''));
  const inChrome = (node, el) => {
    for (let n = node; n && n !== el; n = n.parentElement) if (chrome(n)) return true;
    return false;
  };
  const found = [];
  for (const el of document.querySelectorAll(${JSON.stringify(MESSAGE_CANDIDATES)})) {
    if (found.length >= ${MAX_MESSAGES} || performance.now() > deadline) break;
    if (!named(el) || !shown(el)) continue;
    const text = visibleText(el, (node) => inChrome(node, el));
    if (text !== '' && text.length <= ${MAX_MESSAGE_TEXT}) found.push({ el: el, text: text });
  }
  return found
    .filter((m) => !found.some((other) => other !== m && m.el.contains(other.el)))
    .map((m) => {
      let id = ids.map.get(m.el);
      if (id === undefined) {
        id = ids.next++;
        ids.map.set(m.el, id);
      }
      return { id: id, text: m.text, element: describe(m.el) };
    });
}`;

/**
 * Page-side list of the loading indicators shown: elements with
 * `aria-busy="true"`, a progressbar role, or a class or id word from
 * {@link LOADER_WORDS} (`is-loading`, `spinner`; not `lazyloading`).
 */
const LOADERS_JS = `() => {
  const shown = ${SHOWN_JS};
  const word = /\\b(${LOADER_WORDS.join('|')})\\b/i;
  const loader = (el) => el.getAttribute('aria-busy') === 'true' || el.getAttribute('role') === 'progressbar' ||
    word.test(el.getAttribute('class') || '') || word.test(el.id || '');
  return Array.from(document.querySelectorAll(${JSON.stringify(LOADER_CANDIDATES)})).filter((el) => loader(el) && shown(el));
}`;

/**
 * Page-side list of the elements a hover may show: the area around the
 * hovered element (its parent and everything in it, at most
 * {@link MAX_REVEAL_CANDIDATES} elements) and tooltips, menus, listboxes,
 * dialogs and popovers anywhere on the page.
 */
const REVEAL_CANDIDATES_JS = `(scope) => {
  const list = [scope];
  for (const el of scope.querySelectorAll('*')) {
    if (list.length >= ${MAX_REVEAL_CANDIDATES}) break;
    list.push(el);
  }
  return list.concat(Array.from(document.querySelectorAll(${JSON.stringify(REVEAL_GLOBAL_CANDIDATES)})));
}`;

/**
 * Page-side snapshot a hover takes right before the mouse moves (called by
 * the click script with the hovered element): which elements around it
 * ({@link REVEAL_CANDIDATES_JS}) are shown, kept in the action's watch so its
 * read can tell what the hover revealed, also through CSS `:hover` rules
 * that change no DOM. Does nothing without a running watch (another frame).
 */
export const REVEAL_SNAPSHOT_JS = `(el) => {
  const state = window.__bdgEffects;
  if (!state || state.stopped) return;
  const shown = ${SHOWN_JS};
  const parent = el.parentElement;
  const scope = parent && !/^(body|html)$/.test(parent.localName) ? parent : el;
  const visible = new Set();
  for (const candidate of (${REVEAL_CANDIDATES_JS})(scope)) if (shown(candidate)) visible.add(candidate);
  state.reveal = { scope: scope, visible: visible };
}`;

/**
 * Page-side list of the elements an action showed: elements added during
 * the watch and, after a hover, elements around it that were not shown
 * before ({@link REVEAL_SNAPSHOT_JS}). Only shown ones with visible text
 * count, the outermost of nested ones, and not those whose text a removed
 * element had (a re-render). At most {@link MAX_SHOWN}, within
 * {@link SHOWN_BUDGET_MS}.
 */
export const SHOWN_ELEMENTS_JS = `(state) => {
  const deadline = performance.now() + ${SHOWN_BUDGET_MS};
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const shown = ${SHOWN_JS};
  const visibleText = ${VISIBLE_TEXT_JS};
  const contentOf = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
  const removed = new Set(state.removed.map(contentOf));
  const candidates = new Set(state.added.filter((node) => node.isConnected));
  if (state.reveal && state.reveal.scope.isConnected) {
    for (const el of (${REVEAL_CANDIDATES_JS})(state.reveal.scope)) if (!state.reveal.visible.has(el)) candidates.add(el);
  }
  const found = [];
  for (const el of candidates) {
    if (performance.now() > deadline) break;
    if (!shown(el) || removed.has(contentOf(el))) continue;
    const text = visibleText(el, () => false);
    if (text !== '') found.push({ el: el, text: text });
  }
  return found
    .filter((m) => !found.some((other) => other !== m && other.el.contains(m.el)))
    .slice(0, ${MAX_SHOWN})
    .map((m) => ({ text: m.text, element: describe(m.el) }));
}`;

/**
 * Page-side test whether a mutation is only focus/hover churn: a class
 * change on an element the action's events hit (`targets`) that only adds
 * or removes classes containing "focus" or "hover".
 */
export const CHURN_ONLY_JS = `(record, targets) => {
  if (record.type !== 'attributes' || record.attributeName !== 'class' || !targets.has(record.target)) return false;
  const tokens = (text) => new Set((text || '').split(/\\s+/).filter(Boolean));
  const before = tokens(record.oldValue);
  const after = tokens(record.target.getAttribute('class'));
  const changed = [...before].filter((c) => !after.has(c)).concat([...after].filter((c) => !before.has(c)));
  return changed.every((c) => /focus|hover/i.test(c));
}`;

/**
 * Page-side test whether a mutation changes the page's structure or state
 * rather than only animating it: elements added or removed, or an attribute
 * other than `style` changed. Text-only changes (clocks, counters) and style
 * changes (script-driven animations) do not count.
 */
export const STRUCTURAL_CHANGE_JS = `(record) => {
  if (record.type === 'attributes') return record.attributeName !== 'style';
  if (record.type !== 'childList') return false;
  const element = (node) => node.nodeType === 1;
  return Array.from(record.addedNodes).some(element) || Array.from(record.removedNodes).some(element);
}`;

/**
 * Page-side reason why "no effect" can't be claimed even without DOM
 * changes, or undefined: `clipboard` (a copy or cut happened), `no-event`
 * (no event reached the page), `timer` (a timer the action's handlers
 * started has not fired yet), `control` (form controls, labels, media,
 * frames, popover/command buttons: their effect needs no DOM change),
 * `new-window` (download or `target` links), `external-link` (mailto:, tel:,
 * javascript: and other non-http links), `closed-shadow` (a custom element
 * whose inside is not observed) or `focus` (focus moved to an element that
 * may reveal content with CSS).
 */
export const UNCERTAIN_JS = `(state, active) => {
  if (state.copied) return 'clipboard';
  if (state.targets.size === 0) return 'no-event';
  if (state.timers && state.timers.size > 0) return 'timer';
  const controls = /^(input|select|textarea|option|label|canvas|video|audio|iframe|embed|object)$/;
  for (const node of state.path) {
    if (controls.test(node.localName) || node.isContentEditable) return 'control';
    if (node.hasAttribute('popovertarget') || node.hasAttribute('commandfor')) return 'control';
    if (node.localName === 'a' && node.hasAttribute('href')) {
      if (node.hasAttribute('download') || (node.target && node.target !== '_self')) return 'new-window';
      if (!/^https?:$/.test(node.protocol)) return 'external-link';
    }
  }
  for (const node of state.targets) if (node.localName.includes('-') && !node.shadowRoot) return 'closed-shadow';
  const plain = (node) => /^(body|button|summary)$/.test(node.localName) ||
    (node.localName === 'a' && node.hasAttribute('href')) ||
    (node.localName === 'input' && /^(button|submit|reset)$/i.test(node.type || ''));
  if (active && active !== state.focus && !plain(active)) return 'focus';
  return undefined;
}`;

/**
 * Page-side signs, at a read, that the page is still working on the
 * action's result: how long ago each recent burst of DOM changes was (ms,
 * newest last), timers the action's handlers started that have not fired,
 * and a loading indicator shown since the start (described).
 */
const SETTLE_JS = `(state) => {
  const now = performance.now();
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const loader = (${LOADERS_JS})().find((el) => !state.loaders.has(el));
  return {
    burstAges: state.bursts.map((time) => Math.round(now - time)),
    timers: state.timers.size,
    loading: loader ? describe(loader) : null
  };
}`;

/**
 * Page-side hook of `setTimeout`/`clearTimeout` that records timers the
 * action's event handlers start (while one of its events is being
 * dispatched, `state.dispatching`), of {@link MIN_TIMER_MS} to
 * {@link MAX_TIMER_MS}, in `state.timers` until they fire or are cleared.
 * Leaves `state.later`, the page's own `setTimeout`, for the watch's timers.
 * Evaluates to a function restoring the originals (when still installed).
 */
export const TIMER_HOOK_JS = `(state) => {
  const realSet = window.setTimeout;
  const realClear = window.clearTimeout;
  const watchedSet = function (callback, ms) {
    const wait = Number(ms) || 0;
    if (!state.dispatching || state.stopped || typeof callback !== 'function' || wait < ${MIN_TIMER_MS} || wait > ${MAX_TIMER_MS}) {
      return realSet.apply(this, arguments);
    }
    const args = Array.from(arguments);
    let id;
    args[0] = function () {
      state.timers.delete(id);
      return callback.apply(this, arguments);
    };
    id = realSet.apply(this, args);
    state.timers.set(id, wait);
    return id;
  };
  const watchedClear = function (id) {
    state.timers.delete(id);
    return realClear.apply(this, arguments);
  };
  window.setTimeout = watchedSet;
  window.clearTimeout = watchedClear;
  state.later = (callback, ms) => realSet.call(window, callback, ms);
  return () => {
    if (window.setTimeout === watchedSet) window.setTimeout = realSet;
    if (window.clearTimeout === watchedClear) window.clearTimeout = realClear;
  };
}`;

/**
 * Snapshot before an action, left in `window.__bdgEffects`: the messages
 * and loading indicators shown, and a MutationObserver (on the document,
 * its open shadow roots and any shadow root attached while watching, which
 * also counts as a change) counting changes other than
 * {@link CHURN_ONLY_JS}, keeping the elements added and removed and the
 * times of {@link STRUCTURAL_CHANGE_JS} bursts. Capture listeners record
 * which elements the action's events reached, copy/cut events, the scroll
 * position at the first press (a click scrolls its target into view first)
 * and, until the end of each event's task, that an event is being
 * dispatched ({@link TIMER_HOOK_JS}). The watch stops itself after
 * {@link MAX_WATCH_MS}, so a snapshot that ran late (after a navigation,
 * with nobody reading it) leaves nothing behind. Evaluates to the URL and
 * the messages.
 */
export const EFFECTS_START_SCRIPT = `(() => {
  if (window.__bdgEffects) window.__bdgEffects.stop();
  const churnOnly = ${CHURN_ONLY_JS};
  const structural = ${STRUCTURAL_CHANGE_JS};
  const ids = { map: new WeakMap(), next: 1 };
  const state = {
    ids: ids, changes: 0, targets: new Set(), path: new Set(), focus: document.activeElement,
    pressScroll: null, copied: false, stopped: false, added: [], removed: [], bursts: [],
    timers: new Map(), dispatching: false, loaders: new Set((${LOADERS_JS})())
  };
  const keep = (list, nodes) => {
    for (const node of nodes) if (node.nodeType === 1 && list.length < ${MAX_TRACKED_NODES}) list.push(node);
  };
  const count = (records) => {
    let burst = false;
    for (const record of records) {
      if (churnOnly(record, state.targets)) continue;
      state.changes++;
      burst = burst || structural(record);
      if (record.type === 'childList') {
        keep(state.added, record.addedNodes);
        keep(state.removed, record.removedNodes);
      }
    }
    if (!burst) return;
    state.bursts.push(performance.now());
    if (state.bursts.length > ${MAX_BURSTS}) state.bursts.shift();
  };
  const observer = new MutationObserver(count);
  const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true };
  const observe = (root) => {
    observer.observe(root, options);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) observe(el.shadowRoot);
  };
  observe(document);
  const attachShadow = Element.prototype.attachShadow;
  const watchedAttach = function (init) {
    const root = attachShadow.call(this, init);
    state.changes++;
    observer.observe(root, options);
    return root;
  };
  Element.prototype.attachShadow = watchedAttach;
  const restoreTimers = (${TIMER_HOOK_JS})(state);
  const types = ['pointerdown', 'mousedown', 'click', 'keydown', 'focusin', 'submit', 'mouseover', 'input', 'change', 'copy', 'cut'];
  const pressTypes = ['pointerdown', 'mousedown', 'click', 'keydown', 'submit'];
  const dispatchTypes = types.concat(['pointerup', 'mouseup', 'dblclick', 'contextmenu', 'keypress', 'keyup', 'pointerover']);
  const record = (event) => {
    if (event.type === 'copy' || event.type === 'cut') state.copied = true;
    const path = event.composedPath().filter((node) => node.nodeType === 1);
    if (path[0]) state.targets.add(path[0]);
    path.forEach((node) => state.path.add(node));
    if (!state.pressScroll && pressTypes.includes(event.type)) state.pressScroll = [scrollX, scrollY];
  };
  const dispatching = () => {
    if (state.dispatching) return;
    state.dispatching = true;
    state.later(() => { state.dispatching = false; }, 0);
  };
  types.forEach((type) => window.addEventListener(type, record, true));
  dispatchTypes.forEach((type) => window.addEventListener(type, dispatching, true));
  state.flush = () => count(observer.takeRecords());
  state.stop = () => {
    if (state.stopped) return;
    state.stopped = true;
    clearTimeout(expiry);
    observer.disconnect();
    restoreTimers();
    if (Element.prototype.attachShadow === watchedAttach) Element.prototype.attachShadow = attachShadow;
    types.forEach((type) => window.removeEventListener(type, record, true));
    dispatchTypes.forEach((type) => window.removeEventListener(type, dispatching, true));
  };
  const expiry = state.later(state.stop, ${MAX_WATCH_MS});
  window.__bdgEffects = state;
  return { href: location.href, messages: (${MESSAGES_JS})(ids) };
})()`;

/**
 * Read after an action, called with `(stop, shown)`: `stop` also stops
 * watching, `shown` lists the elements the action showed
 * ({@link SHOWN_ELEMENTS_JS}). Returns the URL, the messages shown and,
 * when the snapshot is still there (same document), the number of changes
 * counted (plus one when the page scrolled after the press), why "no
 * effect" could not be claimed ({@link UNCERTAIN_JS}) and whether the page
 * is still working ({@link SETTLE_JS}). `fresh` means a new document
 * (everything shown is new).
 */
export const EFFECTS_READ_SCRIPT = `((stop, shown) => {
  const state = window.__bdgEffects;
  if (!state) return { href: location.href, fresh: true, messages: (${MESSAGES_JS})({ map: new WeakMap(), next: 1 }) };
  if (!state.stopped) state.flush();
  if (stop) {
    state.stop();
    delete window.__bdgEffects;
  }
  const scrolled = state.pressScroll !== null && (state.pressScroll[0] !== scrollX || state.pressScroll[1] !== scrollY);
  return {
    href: location.href,
    fresh: false,
    changes: state.changes + (scrolled ? 1 : 0),
    uncertain: (${UNCERTAIN_JS})(state, document.activeElement),
    messages: (${MESSAGES_JS})(state.ids),
    settle: (${SETTLE_JS})(state),
    shown: shown ? (${SHOWN_ELEMENTS_JS})(state) : undefined
  };
})`;

/** Stops the watch {@link EFFECTS_START_SCRIPT} left (when no read stopped it) */
export const EFFECTS_STOP_SCRIPT =
  'if (window.__bdgEffects) { window.__bdgEffects.stop(); delete window.__bdgEffects; }';
