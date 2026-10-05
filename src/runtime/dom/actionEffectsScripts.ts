/**
 * Page scripts behind the "what changed" part of DOM action results: one
 * snapshot before the action ({@link EFFECTS_START_SCRIPT}) and one read after
 * it ({@link EFFECTS_READ_SCRIPT}).
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

/** Messages kept per snapshot (after filtering) */
const MAX_MESSAGES = 50;

/** Time a message snapshot may spend before it stops looking (ms) */
const MESSAGES_BUDGET_MS = 5;

/** Longer texts are containers (a page, a form), not messages */
const MAX_MESSAGE_TEXT = 300;

/** How long a page keeps watching when no read or stop arrives (ms) */
const MAX_WATCH_MS = 30000;

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
  const describe = (el) => {
    const text = description(el);
    const role = el.getAttribute('role');
    return text === el.localName && role ? text + '[role="' + role + '"]' : text;
  };
  const word = /\\b(${MESSAGE_WORDS.join('|')})\\b/i;
  const named = (el) => !/^(timer|marquee|progressbar)$/.test(el.getAttribute('role') || '') &&
    (el.matches('[role="alert"], [role="status"], [aria-live]:not([aria-live="off"]), output') ||
      word.test(el.getAttribute('class') || '') || word.test(el.id || ''));
  const shown = (el) => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0 &&
    (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const inChrome = (node, el) => {
    for (let n = node; n && n !== el; n = n.parentElement) if (chrome(n)) return true;
    return false;
  };
  const textOf = (el) => {
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (text.length <= ${MAX_MESSAGE_TEXT} && walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      if (!parent || inChrome(parent, el)) continue;
      if (parent.checkVisibility && !parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      text += ' ' + walker.currentNode.data;
    }
    return text.replace(/\\s+/g, ' ').trim();
  };
  const found = [];
  for (const el of document.querySelectorAll(${JSON.stringify(MESSAGE_CANDIDATES)})) {
    if (found.length >= ${MAX_MESSAGES} || performance.now() > deadline) break;
    if (!named(el) || !shown(el)) continue;
    const text = textOf(el);
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
 * Page-side reason why "no effect" can't be claimed even without DOM
 * changes, or undefined: `clipboard` (a copy or cut happened), `no-event`
 * (no event reached the page), `control` (form controls, labels, media,
 * frames, popover/command buttons: their effect needs no DOM change),
 * `new-window` (download or `target` links), `external-link` (mailto:, tel:,
 * javascript: and other non-http links), `closed-shadow` (a custom element
 * whose inside is not observed) or `focus` (focus moved to an element that
 * may reveal content with CSS).
 */
export const UNCERTAIN_JS = `(state, active) => {
  if (state.copied) return 'clipboard';
  if (state.targets.size === 0) return 'no-event';
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
 * Snapshot before an action, left in `window.__bdgEffects`: the messages
 * shown, and a MutationObserver (on the document, its open shadow roots and
 * any shadow root attached while watching, which also counts as a change)
 * counting changes other than {@link CHURN_ONLY_JS}. Capture listeners
 * record which elements the action's events reached, copy/cut events, and
 * the scroll position at the first press (a click scrolls its target into
 * view first). The watch stops itself after {@link MAX_WATCH_MS}, so a
 * snapshot that ran late (after a navigation, with nobody reading it)
 * leaves nothing behind. Evaluates to the URL and the messages.
 */
export const EFFECTS_START_SCRIPT = `(() => {
  if (window.__bdgEffects) window.__bdgEffects.stop();
  const churnOnly = ${CHURN_ONLY_JS};
  const ids = { map: new WeakMap(), next: 1 };
  const state = { ids: ids, changes: 0, targets: new Set(), path: new Set(), focus: document.activeElement, pressScroll: null, copied: false, stopped: false };
  const count = (records) => {
    for (const record of records) if (!churnOnly(record, state.targets)) state.changes++;
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
  const types = ['pointerdown', 'mousedown', 'click', 'keydown', 'focusin', 'submit', 'mouseover', 'input', 'change', 'copy', 'cut'];
  const pressTypes = ['pointerdown', 'mousedown', 'click', 'keydown', 'submit'];
  const record = (event) => {
    if (event.type === 'copy' || event.type === 'cut') state.copied = true;
    const path = event.composedPath().filter((node) => node.nodeType === 1);
    if (path[0]) state.targets.add(path[0]);
    path.forEach((node) => state.path.add(node));
    if (!state.pressScroll && pressTypes.includes(event.type)) state.pressScroll = [scrollX, scrollY];
  };
  types.forEach((type) => window.addEventListener(type, record, true));
  state.flush = () => count(observer.takeRecords());
  state.stop = () => {
    if (state.stopped) return;
    state.stopped = true;
    clearTimeout(expiry);
    observer.disconnect();
    if (Element.prototype.attachShadow === watchedAttach) Element.prototype.attachShadow = attachShadow;
    types.forEach((type) => window.removeEventListener(type, record, true));
  };
  const expiry = setTimeout(state.stop, ${MAX_WATCH_MS});
  window.__bdgEffects = state;
  return { href: location.href, messages: (${MESSAGES_JS})(ids) };
})()`;

/**
 * Read after an action (call with `true` to also stop watching): the URL,
 * the messages shown and, when the snapshot is still there (same document),
 * the number of changes counted (plus one when the page scrolled after the
 * press) and why "no effect" could not be claimed ({@link UNCERTAIN_JS}).
 * `fresh` means a new document (everything shown is new).
 */
export const EFFECTS_READ_SCRIPT = `((stop) => {
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
    messages: (${MESSAGES_JS})(state.ids)
  };
})`;

/** Stops the watch {@link EFFECTS_START_SCRIPT} left (when no read stopped it) */
export const EFFECTS_STOP_SCRIPT =
  'if (window.__bdgEffects) { window.__bdgEffects.stop(); delete window.__bdgEffects; }';
