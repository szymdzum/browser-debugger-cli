/**
 * Page scripts behind the "what changed" part of DOM action results: one
 * snapshot before the action ({@link EFFECTS_START_SCRIPT}) and one read
 * after it ({@link EFFECTS_READ_SCRIPT}).
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

/** Candidates examined per snapshot (keeps big pages cheap) */
const MAX_CANDIDATES = 300;

/** Longer texts are containers (a page, a form), not messages */
const MAX_MESSAGE_TEXT = 300;

/**
 * Page-side list of the messages a page shows: visible elements with an
 * alert/status role, `aria-live`, `<output>`, or a class or id word from
 * {@link MESSAGE_WORDS}, with their text (aria-hidden parts, buttons and
 * close links such as the "×" left out). Only the innermost of nested
 * messages is kept, described by tag, id and classes (or its role when it
 * has neither, `h3[role="alert"]`). Each element gets a number from `ids` that stays the
 * same within the document, so a later snapshot can tell a new element from
 * one that was there.
 */
const MESSAGES_JS = `(ids) => {
  const description = ${ELEMENT_DESCRIPTION_JS};
  const describe = (el) => {
    const text = description(el);
    const role = el.getAttribute('role');
    return text === el.localName && role ? text + '[role="' + role + '"]' : text;
  };
  const word = /\\b(${MESSAGE_WORDS.join('|')})\\b/i;
  const exclude = '[aria-hidden="true"], button, [role="button"], [class*="close" i], [aria-label*="close" i], [aria-label*="dismiss" i], script, style, template';
  const named = (el) => el.matches('[role="alert"], [role="status"], [aria-live]:not([aria-live="off"]), output') ||
    word.test(el.getAttribute('class') || '') || word.test(el.id || '');
  const shown = (el) => !el.closest('[aria-hidden="true"]') && el.getClientRects().length > 0 &&
    (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
  const textOf = (el) => {
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (text.length <= ${MAX_MESSAGE_TEXT} && walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      const skipped = parent && parent !== el ? parent.closest(exclude) : null;
      if (skipped && skipped !== el && el.contains(skipped)) continue;
      if (parent && parent.checkVisibility && !parent.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      text += ' ' + walker.currentNode.data;
    }
    return text.replace(/\\s+/g, ' ').trim();
  };
  const found = Array.from(document.querySelectorAll(${JSON.stringify(MESSAGE_CANDIDATES)}))
    .slice(0, ${MAX_CANDIDATES})
    .filter((el) => named(el) && shown(el))
    .map((el) => ({ el: el, text: textOf(el) }))
    .filter((m) => m.text !== '' && m.text.length <= ${MAX_MESSAGE_TEXT});
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
 * Snapshot before an action, left in `window.__bdgEffects`: the messages
 * shown, and a MutationObserver (on the document and its open shadow roots)
 * counting changes. Class changes on the element the action hit that only
 * add or remove focus/hover classes don't count. Capture listeners record
 * which elements the action's events reached (for deciding whether "no
 * effect" can be claimed) and the scroll position at the first press, since
 * a click scrolls its target into view first. Evaluates to the URL and the
 * messages.
 */
export const EFFECTS_START_SCRIPT = `(() => {
  if (window.__bdgEffects) window.__bdgEffects.stop();
  const ids = { map: new WeakMap(), next: 1 };
  const state = { ids: ids, changes: 0, targets: new Set(), path: new Set(), focus: document.activeElement, pressScroll: null };
  const tokens = (text) => new Set((text || '').split(/\\s+/).filter(Boolean));
  const churnOnly = (record) => {
    if (record.type !== 'attributes' || record.attributeName !== 'class' || !state.targets.has(record.target)) return false;
    const before = tokens(record.oldValue);
    const after = tokens(record.target.getAttribute('class'));
    const changed = [...before].filter((c) => !after.has(c)).concat([...after].filter((c) => !before.has(c)));
    return changed.every((c) => /focus|hover/i.test(c));
  };
  const count = (records) => {
    for (const record of records) if (!churnOnly(record)) state.changes++;
  };
  const observer = new MutationObserver(count);
  const options = { subtree: true, childList: true, characterData: true, attributes: true, attributeOldValue: true };
  const observe = (root) => {
    observer.observe(root, options);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) observe(el.shadowRoot);
  };
  observe(document);
  const types = ['pointerdown', 'mousedown', 'click', 'keydown', 'focusin', 'submit', 'mouseover', 'input', 'change'];
  const pressTypes = ['pointerdown', 'mousedown', 'click', 'keydown', 'submit'];
  const record = (event) => {
    const path = event.composedPath().filter((node) => node.nodeType === 1);
    if (path[0]) state.targets.add(path[0]);
    path.forEach((node) => state.path.add(node));
    if (!state.pressScroll && pressTypes.includes(event.type)) state.pressScroll = [scrollX, scrollY];
  };
  types.forEach((type) => window.addEventListener(type, record, true));
  state.flush = () => count(observer.takeRecords());
  state.stop = () => {
    observer.disconnect();
    types.forEach((type) => window.removeEventListener(type, record, true));
  };
  window.__bdgEffects = state;
  return { href: location.href, messages: (${MESSAGES_JS})(ids) };
})()`;

/**
 * Read after an action (call with `true` to also stop watching): the URL,
 * the messages shown and, when the snapshot is still there (same document),
 * the number of changes counted (plus one when the page scrolled after the
 * press) and why "no effect" could not be claimed even without changes:
 * `no-event` (no event reached the page), `control` (form controls, media,
 * frames, links to other windows, popover buttons: their effect needs no DOM
 * change), `closed-shadow` (a custom element whose inside is not observed)
 * or `focus` (focus moved to an element that may reveal content with CSS).
 * `fresh` means a new document (everything shown is new).
 */
export const EFFECTS_READ_SCRIPT = `((stop) => {
  const state = window.__bdgEffects;
  if (!state) return { href: location.href, fresh: true, messages: (${MESSAGES_JS})({ map: new WeakMap(), next: 1 }) };
  state.flush();
  if (stop) {
    state.stop();
    delete window.__bdgEffects;
  }
  const scrolled = state.pressScroll !== null && (state.pressScroll[0] !== scrollX || state.pressScroll[1] !== scrollY);
  const special = 'input, select, textarea, option, label, [contenteditable]:not([contenteditable="false"]), canvas, video, audio, iframe, embed, object, a[download], a[target]:not([target="_self"]), [popovertarget], [commandfor]';
  const uncertain = () => {
    if (state.targets.size === 0) return 'no-event';
    for (const node of state.path) if (node.matches(special)) return 'control';
    for (const node of state.targets) if (node.localName.includes('-') && !node.shadowRoot) return 'closed-shadow';
    const active = document.activeElement;
    const plain = 'body, button, a[href], input[type="button"], input[type="submit"], input[type="reset"], summary';
    if (active && active !== state.focus && !active.matches(plain)) return 'focus';
    return undefined;
  };
  return {
    href: location.href,
    fresh: false,
    changes: state.changes + (scrolled ? 1 : 0),
    uncertain: uncertain(),
    messages: (${MESSAGES_JS})(state.ids)
  };
})`;

/** Stops the watch {@link EFFECTS_START_SCRIPT} left (when the read did not) */
export const EFFECTS_STOP_SCRIPT =
  'if (window.__bdgEffects) { window.__bdgEffects.stop(); delete window.__bdgEffects; }';
