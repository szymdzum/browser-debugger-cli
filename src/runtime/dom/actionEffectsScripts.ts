/**
 * Page scripts behind the "what changed" part of DOM action results: one
 * snapshot before the action ({@link EFFECTS_START_SCRIPT}) and one read after
 * it ({@link EFFECTS_READ_SCRIPT}), plus the snapshot a hover takes of what
 * is hidden around its target ({@link REVEAL_SNAPSHOT_JS}).
 */

import { ELEMENT_DESCRIPTION_JS, ELEMENT_IDENTITY_JS } from '@/runtime/dom/elementInfo.js';

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

/** Elements a hover snapshot looks at, at most */
const MAX_REVEAL_CANDIDATES = 1500;

/** Time a hover snapshot may spend before it stops looking (ms) */
const REVEAL_BUDGET_MS = 8;

/**
 * Containers that hold a target and the results of its key presses (a form,
 * a search box, a dialog); without one, the target's grandparent is used
 */
const NEAR_CONTAINERS =
  'form, [role="form"], search, [role="search"], dialog, [role="dialog"], [role="combobox"]';

/**
 * Added elements a click or key press reports wherever they are: the page's
 * own announcements, elements with a dialog or alert/status role. Class
 * words, other popups and `aria-live` regions count near the target only,
 * so a toast or a live score ticking elsewhere is not attributed to a press.
 */
const PRESS_POPUP_ROLES = /^(dialog|alertdialog|alert|status)$/;

/** Added elements a hover reports wherever they are: popups and messages */
const POPUP_ROLES = /^(tooltip|menu|listbox|dialog|alert|alertdialog|status)$/;

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

/** Elements changing before the action a read names (`alsoChanging`), at most */
const MAX_ALSO_CHANGING = 10;

/** Longer texts are containers (a page, a form), not messages */
const MAX_MESSAGE_TEXT = 300;

/** How long a page keeps watching when no read or stop arrives (ms) */
const MAX_WATCH_MS = 30000;

/** Bursts of DOM changes a watch keeps (their times) */
const MAX_BURSTS = 20;

/** Delay of the stall watch's timer ({@link STALL_WATCH_START_SCRIPT}, ms) */
const STALL_BEAT_MS = 20;

/** How late the stall watch's timer must run to count as a stall (ms) */
const STALL_MIN_MS = 10;

/** Stalls a stall watch keeps */
const MAX_STALLS = 50;

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
const VISIBLE_TEXT_JS = `(el, skip, skipText) => {
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (text.length <= ${MAX_MESSAGE_TEXT} && walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!parent || /^(script|style|template|noscript)$/.test(parent.localName) || skip(parent)) continue;
    if (skipText && skipText(walker.currentNode)) continue;
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
 * one that was there. With `marked` (elements the page kept changing before
 * the action, as {@link MARKED_REGIONS_JS} extends them) and `churned`
 * (nodes the page put in place of others on its own, see `actionHistory.ts`),
 * a marked message gets `otherText`, its text without the churned nodes, so
 * a read can tell whether anything besides the ticking parts changed (the
 * action's own message next to a ticker, also when the ticker replaces its
 * `<span>` in the box itself); a message that only sits inside a marked
 * element (a validation message rendered into a re-rendered app root) gets
 * none.
 */
const MESSAGES_JS = `(ids, marked, churned) => {
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
  const inChurned = (text, el) => {
    if (churned.has(text)) return true;
    for (let n = text.parentElement; n && n !== el; n = n.parentElement) if (churned.has(n)) return true;
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
      const boxed = Boolean(marked) && marked.has(m.el);
      const other = boxed ? visibleText(m.el, (node) => inChrome(node, m.el), (text) => inChurned(text, m.el)) : undefined;
      return { id: id, text: m.text, element: describe(m.el), ...(boxed && { otherText: other }) };
    });
}`;

/**
 * Page-side regions changing before the action, from the elements the
 * action history marked: each of them, plus the closest message element
 * around it (itself included; a candidate of {@link MESSAGE_CANDIDATES}
 * with at most {@link MAX_MESSAGE_TEXT} characters of text), so a ticker
 * `<span>` inside a `role=status` box marks the box. The one set both the
 * watch's change count (record targets) and the message flag (`self`)
 * test, so they agree; never an element only because an ancestor is marked.
 */
export const MARKED_REGIONS_JS = `(nodes) => {
  const marked = new Set(nodes);
  for (const node of nodes) {
    const message = node.closest(${JSON.stringify(MESSAGE_CANDIDATES)});
    if (message && (message.textContent || '').length <= ${MAX_MESSAGE_TEXT}) marked.add(message);
  }
  return marked;
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
 * Page-side snapshot a hover takes right before the mouse moves (called by
 * the click script with the hovered element): the elements around it (its
 * parent and everything in it) and the tooltips, menus, listboxes, dialogs
 * and popovers anywhere on the page that are hidden, at most
 * {@link MAX_REVEAL_CANDIDATES} looked at within {@link REVEAL_BUDGET_MS}.
 * They are kept by identity in the action's watch, so its read can tell
 * which of them the hover revealed, also through CSS `:hover` rules that
 * change no DOM, and elements moving in the page can't pass for revealed
 * ones. Does nothing without a running watch (another frame). With `press`
 * (a click) it is taken only for an element with `aria-expanded` and looks
 * only at the elements it names with `aria-controls` and at its next sibling
 * element (a menu or panel after its button), so a carousel or another
 * widget around the button is not mistaken for what the click revealed; the
 * snapshot then adds the elements it un-hid to what the click showed and
 * changes nothing else about how the click is read.
 */
export const REVEAL_SNAPSHOT_JS = `(el, press) => {
  const state = window.__bdgEffects;
  if (!state || state.stopped) return;
  const toggle = el.closest('[aria-expanded]');
  if (press && !toggle) return;
  const deadline = performance.now() + ${REVEAL_BUDGET_MS};
  const shown = ${SHOWN_JS};
  const parent = el.parentElement;
  const scope = parent && !/^(body|html)$/.test(parent.localName) ? parent : el;
  const hidden = [];
  let looked = 0;
  const room = () => looked < ${MAX_REVEAL_CANDIDATES} && performance.now() <= deadline;
  const look = (candidate) => {
    looked++;
    if (!shown(candidate)) hidden.push(candidate);
  };
  if (press) {
    const root = el.getRootNode();
    const named = (toggle.getAttribute('aria-controls') || '').split(/\\s+/).filter(Boolean);
    const controlled = named.map((id) => (typeof root.getElementById === 'function' ? root.getElementById(id) : null));
    for (const candidate of controlled.concat([toggle.nextElementSibling])) if (candidate) look(candidate);
    state.reveal = { target: el, hidden: hidden, press: true };
    return;
  }
  for (const candidate of document.querySelectorAll(${JSON.stringify(REVEAL_GLOBAL_CANDIDATES)})) {
    if (!room()) break;
    look(candidate);
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
  for (let node = scope; node && room(); node = walker.nextNode()) look(node);
  state.reveal = { target: el, hidden: hidden, press: false };
}`;

/**
 * Page-side container whose added elements count as an action's result:
 * the target's form, search box, dialog or combobox, else its grandparent
 * (its parent when the grandparent is the body).
 */
const NEAR_SCOPE_JS = `(target) => {
  const container = target.closest(${JSON.stringify(NEAR_CONTAINERS)});
  if (container) return container;
  const parent = target.parentElement || target;
  const grandparent = parent.parentElement;
  return grandparent && !/^(body|html)$/.test(grandparent.localName) ? grandparent : parent;
}`;

/**
 * Page-side list of the elements an action showed: elements added during
 * the watch inside the target's container ({@link NEAR_SCOPE_JS}) or,
 * anywhere, after a hover popups and messages (tooltip, menu, listbox,
 * dialog, alert and status roles, `aria-live`, message-like classes) and
 * after a click or key press only elements with a dialog or alert/status
 * role ({@link PRESS_POPUP_ROLES}). Text in textareas,
 * selects, password inputs, elements whose `autocomplete` ends in
 * `password` or `one-time-code` and elements named like secrets is left
 * out. Also, after a hover, the
 * elements hidden before it that are shown now ({@link REVEAL_SNAPSHOT_JS}).
 * The container is searched through shadow roots. After a click on an
 * element with `aria-expanded`, the elements it un-hid among those it names
 * with `aria-controls` and its next sibling count too, and so do the
 * pre-rendered dialogs the press opened (`openedDialogs`, anywhere). Background widgets
 * elsewhere on the page do not count. A dialog with no text is listed by its
 * name: the `aria-label`, placeholder or title of the first element in it
 * (itself first) that is not a secret's. Only shown ones
 * with visible text count, the outermost of nested ones, and not those
 * whose text a removed element had (a re-render). At most
 * {@link MAX_SHOWN}, within {@link SHOWN_BUDGET_MS} counted from after the
 * page's layout is brought up to date (on a slow machine that layout alone
 * can take longer than the budget). Returns the
 * elements, how many more qualified than they list (`cut`) and whether the
 * time budget stopped the scan (`partial`: more may exist, uncounted).
 */
export const SHOWN_ELEMENTS_JS = `(state) => {
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const shown = ${SHOWN_JS};
  const visibleText = ${VISIBLE_TEXT_JS};
  const word = /\\b(${MESSAGE_WORDS.join('|')})\\b/i;
  const hover = state.reveal && !state.reveal.press;
  const target = hover ? state.reveal.target : state.keyTarget || state.pressTarget;
  const secretPart = (node) => /^(textarea|select|option)$/.test(node.localName) ||
    (node.localName === 'input' && node.type === 'password') ||
    /(password|one-time-code)$/i.test(node.getAttribute('autocomplete') || '') ||
    /pass|secret|token|otp|cvv|cvc/i.test((node.getAttribute('name') || '') + ' ' + (node.id || ''));
  const scope = target && target.isConnected ? (${NEAR_SCOPE_JS})(target) : null;
  const hoverPopup = (el) => ${POPUP_ROLES}.test(el.getAttribute('role') || '') || el.hasAttribute('popover') ||
    (el.hasAttribute('aria-live') && el.getAttribute('aria-live') !== 'off') ||
    word.test(el.getAttribute('class') || '') || word.test(el.id || '');
  const announced = (el) => ${PRESS_POPUP_ROLES}.test(el.getAttribute('role') || '');
  const popup = hover ? hoverPopup : announced;
  const within = (root, el) => {
    for (let node = el; node; node = node.parentNode || node.host) if (node === root) return true;
    return false;
  };
  const near = (el) => (scope !== null && within(scope, el)) || popup(el);
  const dialogName = (el) => {
    if (el.localName !== 'dialog' && !/^(dialog|alertdialog)$/.test(el.getAttribute('role') || '')) return '';
    const nameOf = (node) => node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || '';
    const candidates = [el].concat(Array.from(el.querySelectorAll('[aria-label], [placeholder], [title]')));
    const named = candidates.find((node) => nameOf(node) !== '' && !secretPart(node));
    const name = named ? nameOf(named) : '';
    return name.replace(/\\s+/g, ' ').trim().slice(0, ${MAX_MESSAGE_TEXT});
  };
  const contentOf = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
  const removed = new Set(state.removed.map(contentOf));
  const candidates = new Set(state.added.filter((node) => node.isConnected && near(node)));
  if (state.reveal) for (const el of state.reveal.hidden) if (el.isConnected) candidates.add(el);
  for (const el of state.openedDialogs) if (el.isConnected && el.hasAttribute('open')) candidates.add(el);
  const found = [];
  let partial = false;
  void document.documentElement.offsetHeight;
  const deadline = performance.now() + ${SHOWN_BUDGET_MS};
  for (const el of candidates) {
    if (performance.now() > deadline) { partial = true; break; }
    if (!shown(el) || removed.has(contentOf(el))) continue;
    const text = visibleText(el, secretPart) || dialogName(el);
    if (text !== '') found.push({ el: el, text: text });
  }
  const outermost = found.filter((m) => !found.some((other) => other !== m && within(other.el, m.el)));
  return {
    elements: outermost.slice(0, ${MAX_SHOWN}).map((m) => ({ text: m.text, element: describe(m.el) })),
    cut: Math.max(0, outermost.length - ${MAX_SHOWN}),
    partial: partial
  };
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
  if (state.keyTarget && !state.enterField) return 'key';
  const controls = /^(input|select|textarea|option|label|canvas|video|audio|iframe|embed|object)$/;
  for (const node of state.path) {
    if (node === state.enterField) continue;
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
  if (active && active !== state.focus && active !== state.enterField && !plain(active)) return 'focus';
  return undefined;
}`;

/**
 * Page-side signs, at a read, that the page is still working on the
 * action's result: the page time of the read, how long ago each recent
 * burst of DOM changes was (ms, newest last), and a loading indicator shown
 * since the start (described).
 */
const SETTLE_JS = `(state) => {
  const now = performance.now();
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const loader = (${LOADERS_JS})().find((el) => !state.loaders.has(el));
  return {
    at: now,
    burstAges: state.bursts.map((time) => Math.round(now - time)),
    loading: loader ? describe(loader) : null
  };
}`;

/** Controls whose own change after a press counts as its effect */
const PRESSED_CONTROLS =
  'button, input[type=button], input[type=submit], input[type=reset], [role=button]';

/**
 * Page-side label of a pressed control ({@link PRESSED_CONTROLS}): an input
 * button's value, else its rendered text, whitespace collapsed, at most
 * {@link MAX_MESSAGE_TEXT} characters. A control holds no field's value.
 */
const CONTROL_LABEL_JS = `(el) => (el.localName === 'input' ? el.value : el.innerText || el.textContent || '')
  .replace(/\\s+/g, ' ').trim().slice(0, ${MAX_MESSAGE_TEXT})`;

/**
 * Page-side outcomes of the press, for a read: the first form that fired
 * `submit` during the watch and whether the page cancelled it
 * (`defaultPrevented`, final once the event was dispatched; the form is kept
 * when noted, since a dispatch clears a target in a shadow root); the pressed
 * control's change since the press (its disabled state or label); the
 * element a key press clicked inside the key's target (Enter or Space on a
 * button); whether the key was Enter in a form's input; whether the
 * `aria-expanded` of the first press's target (or of the control it labels)
 * flipped between `true` and `false`; with `focus`, the element focus is on
 * when it is not the field that got `input` (not the body); and the number
 * of elements added or removed since the start. Empty parts are left out.
 */
const OUTCOMES_JS = `(state, focus) => {
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const outcomes = {};
  const submit = state.submits[0];
  if (submit) outcomes.submitted = { form: describe(submit.form), cancelled: submit.event.defaultPrevented };
  const control = state.control;
  if (control && control.el.isConnected) {
    const disabled = control.el.matches(':disabled');
    const text = (${CONTROL_LABEL_JS})(control.el);
    const change = {};
    if (disabled !== control.disabled) change.disabled = disabled;
    if (text !== control.text) change.text = text;
    if (Object.keys(change).length > 0) outcomes.controlChange = { element: describe(control.el), ...change };
  }
  if (state.keyClick) outcomes.activated = describe(state.keyClick);
  if (state.enterField) outcomes.enterField = true;
  const toggle = state.expandable;
  const flags = ['true', 'false'];
  if (toggle) {
    const now = toggle.el.getAttribute('aria-expanded');
    if (now !== toggle.value && flags.includes(now) && flags.includes(toggle.value)) outcomes.expanded = now === 'true';
  }
  const active = document.activeElement;
  const field = state.inputTarget;
  if (focus && field && active && active !== field && !/^(body|html)$/.test(active.localName) && !field.contains(active)) {
    outcomes.focusMoved = (${ELEMENT_IDENTITY_JS})(active);
  }
  outcomes.nodes = state.nodes;
  return outcomes;
}`;

/**
 * Snapshot before an action, left in `window.__bdgEffects`: the messages
 * and loading indicators shown, and a MutationObserver (on the document,
 * its open shadow roots and any shadow root attached while watching, which
 * also counts as a change) counting changes other than
 * {@link CHURN_ONLY_JS}, keeping the elements added and removed and the
 * times of {@link STRUCTURAL_CHANGE_JS} bursts. Capture listeners record
 * which elements the action's events reached, the first key press's target,
 * copy/cut events and the scroll position at the first press (a click
 * scrolls its target into view first). Elements the action history
 * (`window.__bdgHistory`, see `actionHistory.ts`) found the page changing on
 * its own right before are `marked` ({@link MARKED_REGIONS_JS}). A change
 * whose target is one of them (exactly, not inside it) and that only adds or
 * removes churned nodes (nodes the page put in place of others, extended to
 * what a marked element gets in place of churned nodes in the same
 * delivery), changes a churned text or changes the element's attributes
 * makes no burst and adds no nodes; such elements with structural changes
 * are kept in `alsoChanging`. Anything else a marked element gets (the
 * action's result next to a ticker) counts as usual. A `<dialog>` whose `open`
 * attribute appears during a press event's dispatch (`dispatching`: set by
 * the capture listener of each press event, cleared by a 0 ms timer that
 * each press event reschedules) and that was closed at the start (its first
 * `open` change of the watch) is kept in `openedDialogs`, for `Shown:`. The
 * watch stops itself after
 * {@link MAX_WATCH_MS}, so a snapshot that ran late (after a navigation,
 * with nobody reading it) leaves nothing behind. Evaluates to the URL and
 * the messages.
 */
export const EFFECTS_START_SCRIPT = `(() => {
  if (window.__bdgEffects) window.__bdgEffects.stop();
  const churnOnly = ${CHURN_ONLY_JS};
  const structural = ${STRUCTURAL_CHANGE_JS};
  const ids = { map: new WeakMap(), next: 1 };
  const history = window.__bdgHistory;
  const marked = (${MARKED_REGIONS_JS})(history ? history.selfUpdating(performance.now()) : []);
  const churned = history ? history.churned : new WeakSet();
  const state = {
    marked: marked, churned: churned, alsoChanging: new Set(),
    ids: ids, changes: 0, targets: new Set(), path: new Set(), focus: document.activeElement,
    pressScroll: null, copied: false, stopped: false, added: [], removed: [], bursts: [],
    keyTarget: null, loaders: new Set((${LOADERS_JS})()),
    pressTarget: null, submits: [], forms: [], control: null, keyClick: null, enterField: null,
    nodes: 0, expandable: null, inputTarget: null, openedDialogs: [], dispatching: false, dispatchTimer: 0
  };
  const dialogsSeen = new WeakSet();
  const listen = EventTarget.prototype.addEventListener;
  const unlisten = EventTarget.prototype.removeEventListener;
  const controlLabel = ${CONTROL_LABEL_JS};
  const onSubmit = (event) => {
    const form = event.target;
    if (!state.submits.some((seen) => seen.form === form)) state.submits.push({ form: form, event: event });
  };
  const notePress = (event, first) => {
    if (!state.pressTarget) state.pressTarget = first;
    const form = first.form || first.closest('form');
    if (form instanceof HTMLFormElement && !state.forms.includes(form)) {
      state.forms.push(form);
      listen.call(form, 'submit', onSubmit, true);
    }
    if (!state.expandable) {
      const labelled = first.closest('label');
      const toggle = first.closest('[aria-expanded]') ||
        (labelled && labelled.control && labelled.control.hasAttribute('aria-expanded') ? labelled.control : null);
      if (toggle) state.expandable = { el: toggle, value: toggle.getAttribute('aria-expanded') };
    }
    const control = state.control ? null : first.closest(${JSON.stringify(PRESSED_CONTROLS)});
    if (control) state.control = { el: control, disabled: control.matches(':disabled'), text: controlLabel(control) };
    if (event.type === 'keydown' && event.key === 'Enter' && first.localName === 'input' && first.form) {
      state.enterField = state.enterField || first;
    }
    if (event.type === 'click' && state.keyTarget && !state.keyClick && state.keyTarget.contains(first)) {
      state.keyClick = first;
    }
  };
  const keep = (list, nodes) => {
    for (const node of nodes) if (node.nodeType === 1 && list.length < ${MAX_TRACKED_NODES}) list.push(node);
  };
  const elementCount = (nodes) => Array.from(nodes).filter((node) => node.nodeType === 1).length;
  const replaces = (record) => record.type === 'childList' && marked.has(record.target) &&
    Array.from(record.removedNodes).some((node) => churned.has(node));
  const ticking = (record) => {
    if (!marked.has(record.target)) return false;
    if (record.type === 'attributes') return true;
    if (record.type === 'characterData') return churned.has(record.target);
    return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).every((node) => churned.has(node));
  };
  const noteDialogOpen = (record) => {
    const dialog = record.target;
    if (record.attributeName !== 'open' || dialog.localName !== 'dialog' || dialogsSeen.has(dialog)) return;
    dialogsSeen.add(dialog);
    if (record.oldValue === null && state.dispatching && state.openedDialogs.length < ${MAX_TRACKED_NODES}) {
      state.openedDialogs.push(dialog);
    }
  };
  const count = (records) => {
    let burst = false;
    const replacing = new Set(records.filter(replaces).map((record) => record.target));
    for (const record of records) {
      if (record.type === 'childList' && replacing.has(record.target)) record.addedNodes.forEach((node) => churned.add(node));
    }
    for (const record of records) {
      if (churnOnly(record, state.targets)) continue;
      state.changes++;
      if (record.type === 'attributes') noteDialogOpen(record);
      const own = ticking(record);
      if (!own) burst = burst || structural(record);
      else if (structural(record)) state.alsoChanging.add(record.target);
      if (record.type === 'childList') {
        if (!own) state.nodes += elementCount(record.addedNodes) + elementCount(record.removedNodes);
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
  const types = ['pointerdown', 'mousedown', 'click', 'keydown', 'focusin', 'submit', 'mouseover', 'input', 'change', 'copy', 'cut'];
  const pressTypes = ['pointerdown', 'mousedown', 'click', 'keydown', 'submit'];
  const record = (event) => {
    if (event.type === 'copy' || event.type === 'cut') state.copied = true;
    const path = event.composedPath().filter((node) => node.nodeType === 1);
    if (path[0]) state.targets.add(path[0]);
    if (path[0] && !state.keyTarget && event.type === 'keydown') state.keyTarget = path[0];
    if (path[0] && !state.inputTarget && event.type === 'input') state.inputTarget = path[0];
    path.forEach((node) => state.path.add(node));
    if (!state.pressScroll && pressTypes.includes(event.type)) state.pressScroll = [scrollX, scrollY];
    if (pressTypes.includes(event.type)) {
      state.dispatching = true;
      clearTimeout(state.dispatchTimer);
      state.dispatchTimer = setTimeout(() => { state.dispatching = false; }, 0);
    }
    if (event.type === 'submit') onSubmit(event);
    else if (path[0] && pressTypes.includes(event.type)) {
      try {
        notePress(event, path[0]);
      } catch (error) {
        state.pressFailed = true;
      }
    }
  };
  types.forEach((type) => window.addEventListener(type, record, true));
  state.flush = () => count(observer.takeRecords());
  state.stop = () => {
    if (state.stopped) return;
    state.stopped = true;
    clearTimeout(expiry);
    clearTimeout(state.dispatchTimer);
    observer.disconnect();
    if (Element.prototype.attachShadow === watchedAttach) Element.prototype.attachShadow = attachShadow;
    types.forEach((type) => window.removeEventListener(type, record, true));
    state.forms.forEach((form) => unlisten.call(form, 'submit', onSubmit, true));
  };
  const expiry = setTimeout(state.stop, ${MAX_WATCH_MS});
  window.__bdgEffects = state;
  return { href: location.href, messages: (${MESSAGES_JS})(ids, marked, churned) };
})()`;

/**
 * Page-side wait for one turn of the page's timers. A busy or descheduled
 * renderer (a slow machine) runs a CDP read before a timer that fell due
 * meanwhile, so a page changing every 100 ms would look like a single
 * render; Chrome runs the earliest overdue timers before a 0 ms timer posted
 * after them (a longer delay would wait for every due timer). That order is
 * Chrome's scheduler behaviour, not a web standard, verified on Chrome 154.
 */
export const DUE_TIMERS_JS = `() => new Promise((resolve) => setTimeout(resolve, 0))`;

/** Sets the {@link DUE_TIMERS_JS} timer, kept for {@link AWAIT_DUE_TIMERS_SCRIPT} */
export const START_DUE_TIMERS_SCRIPT = `globalThis.__bdgDueTimers = (${DUE_TIMERS_JS})(), true`;

/** Resolves once the timer {@link START_DUE_TIMERS_SCRIPT} set has run */
export const AWAIT_DUE_TIMERS_SCRIPT = 'globalThis.__bdgDueTimers';

/**
 * Read after an action, called with `(stop, shown, focus)`: `stop` also stops
 * watching, `shown` lists the elements the action showed
 * ({@link SHOWN_ELEMENTS_JS}), `focus` says where focus moved to away from
 * the field the page got `input` on ({@link OUTCOMES_JS}). Returns the URL, the messages shown and,
 * when the snapshot is still there (same document), the number of changes
 * counted (plus one when the page scrolled after the press), why "no
 * effect" could not be claimed ({@link UNCERTAIN_JS}) and whether the page
 * is still working ({@link SETTLE_JS}), and the marked elements with
 * structural changes during the watch (`alsoChanging`, described, at most
 * {@link MAX_ALSO_CHANGING}). `fresh` means a new document (everything
 * shown is new).
 */
export const EFFECTS_READ_SCRIPT = `((stop, shown, focus) => {
  const state = window.__bdgEffects;
  if (!state) return { href: location.href, fresh: true, messages: (${MESSAGES_JS})({ map: new WeakMap(), next: 1 }) };
  if (!state.stopped) state.flush();
  if (stop) {
    state.stop();
    delete window.__bdgEffects;
  }
  const scrolled = state.pressScroll !== null && (state.pressScroll[0] !== scrollX || state.pressScroll[1] !== scrollY);
  const listed = shown ? (${SHOWN_ELEMENTS_JS})(state) : undefined;
  return {
    href: location.href,
    fresh: false,
    changes: state.changes + (scrolled ? 1 : 0),
    uncertain: (${UNCERTAIN_JS})(state, document.activeElement),
    messages: (${MESSAGES_JS})(state.ids, state.marked, state.churned),
    alsoChanging: Array.from(state.alsoChanging).filter((el) => el.isConnected).slice(0, ${MAX_ALSO_CHANGING})
      .map(${ELEMENT_DESCRIPTION_JS}),
    settle: (${SETTLE_JS})(state),
    shown: listed && listed.elements,
    shownCut: listed && listed.cut,
    shownPartial: listed && listed.partial,
    ...(${OUTCOMES_JS})(state, focus)
  };
})`;

/**
 * Stall watch, run in bdg's world while an action's effects are watched,
 * left in `globalThis.__bdgStalls`: a timer every {@link STALL_BEAT_MS}
 * that notes when it ran over {@link STALL_MIN_MS} late, as a stall from
 * when it was due to when it ran (the last {@link MAX_STALLS}). bdg's world
 * has its own `setTimeout`, so a page that replaced it is still watched, and
 * its timers share the page's queue: a stall is time the page's own timers
 * could not run either (a long task, or a renderer that runs the page's
 * tasks late). The page cannot see it, except in the main-world fallback
 * for frame-scoped connections (no bdg world), where `__bdgStalls` is a
 * global of the page. It also counts the page's long tasks (over 50 ms of
 * script, style or layout), read by {@link LONG_TASKS_READ_SCRIPT}. It
 * stops itself after {@link MAX_WATCH_MS}.
 */
export const STALL_WATCH_START_SCRIPT = `(() => {
  if (globalThis.__bdgStalls) globalThis.__bdgStalls.stop();
  const native = String(setTimeout).includes('[native code]');
  const watch = { stalls: [], due: 0, ticked: native, stopped: false, timer: 0, longTasks: 0 };
  const observer = typeof PerformanceObserver === 'function' &&
    (PerformanceObserver.supportedEntryTypes || []).includes('longtask')
    ? new PerformanceObserver((list) => { watch.longTasks += list.getEntries().length; })
    : null;
  if (observer) observer.observe({ type: 'longtask' });
  watch.longTasksSeen = () => {
    if (!observer) return null;
    watch.longTasks += observer.takeRecords().length;
    return watch.longTasks;
  };
  const schedule = () => {
    watch.due = performance.now() + ${STALL_BEAT_MS};
    watch.timer = setTimeout(beat, ${STALL_BEAT_MS});
  };
  const beat = () => {
    const now = performance.now();
    watch.ticked = true;
    if (now - watch.due > ${STALL_MIN_MS}) {
      watch.stalls.push([watch.due, now]);
      if (watch.stalls.length > ${MAX_STALLS}) watch.stalls.shift();
    }
    schedule();
  };
  watch.stop = () => {
    watch.stopped = true;
    clearTimeout(watch.timer);
    clearTimeout(expiry);
    if (observer) observer.disconnect();
  };
  const expiry = setTimeout(watch.stop, ${MAX_WATCH_MS});
  schedule();
  globalThis.__bdgStalls = watch;
  return true;
})()`;

/**
 * Reads the stalls {@link STALL_WATCH_START_SCRIPT} noted, as page times
 * `[due, ran]`, plus the stall still going on (its timer over
 * {@link STALL_MIN_MS} overdue now) as `[due, now]`; that one only with the
 * browser's own `setTimeout` or once the timer has run at least once (in the
 * main world, where bdg's scripts run without bdg's world, a page may have
 * replaced `setTimeout` with one that never runs). Null without a watch.
 */
export const STALL_READ_SCRIPT = `(() => {
  const watch = globalThis.__bdgStalls;
  if (!watch) return null;
  const now = performance.now();
  const ongoing = watch.ticked && !watch.stopped && now - watch.due > ${STALL_MIN_MS};
  return ongoing ? watch.stalls.concat([[watch.due, now]]) : watch.stalls;
})()`;

/**
 * Reads how many long tasks the page ran since {@link STALL_WATCH_START_SCRIPT}
 * started, also those not yet delivered to its observer. Null without a
 * watch or without long-task support.
 */
export const LONG_TASKS_READ_SCRIPT = `(() => {
  const watch = globalThis.__bdgStalls;
  return watch && watch.longTasksSeen ? watch.longTasksSeen() : null;
})()`;

/** Stops the watch {@link STALL_WATCH_START_SCRIPT} left */
export const STALL_WATCH_STOP_SCRIPT =
  'if (globalThis.__bdgStalls) { globalThis.__bdgStalls.stop(); delete globalThis.__bdgStalls; }';

/** Stops the watch {@link EFFECTS_START_SCRIPT} left (when no read stopped it) */
export const EFFECTS_STOP_SCRIPT =
  'if (window.__bdgEffects) { window.__bdgEffects.stop(); delete window.__bdgEffects; }';
