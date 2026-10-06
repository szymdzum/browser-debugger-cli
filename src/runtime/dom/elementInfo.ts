/**
 * Page-side descriptions of elements for DOM command output (`dom query`,
 * `dom layout`, DOM context of console messages): their text as a user sees
 * it and where they live (iframes, shadow roots).
 */

/** Length of the text preview shown for elements. */
const PREVIEW_LENGTH = 80;

/** Length of the text `dom get` shows for an element. */
export const ELEMENT_TEXT_LENGTH = 500;

/**
 * Page-side removal of decorations from an element's text: close buttons
 * (`.close`, `aria-label="Close"` or `"Dismiss"`, a button or link showing
 * just `×`) and `aria-hidden` icons (text without letters or digits), so a
 * flash message does not end in "×". `aria-hidden` text with words is kept:
 * it is often the visible twin of a screen-reader text. Each decoration's
 * text is removed once, from the end.
 */
export const WITHOUT_DECORATIONS_JS = `(el, text) => {
  if (!text || typeof el.querySelectorAll !== 'function') return text;
  const glyph = /^\\s*[×✕✖✗⨯]\\s*$/;
  const textOf = (node) => (typeof node.innerText === 'string' ? node.innerText : node.textContent || '').trim();
  const closer = '.close, [aria-label="close" i], [aria-label="dismiss" i]';
  const rendered = (node) => !node.checkVisibility || node.checkVisibility();
  const found = Array.from(el.querySelectorAll(closer + ', [aria-hidden="true"]'))
    .filter((node) => rendered(node) && (node.matches(closer) || !/[\\p{L}\\p{N}]/u.test(textOf(node))));
  if (/[×✕✖✗⨯]/.test(text)) {
    found.push(...Array.from(el.querySelectorAll('button, a, [role="button"]')).filter((node) => glyph.test(node.textContent || '')));
  }
  const unique = Array.from(new Set(found));
  const outermost = unique.filter((node) => !unique.some((other) => other !== node && other.contains(node)));
  let result = text;
  for (const node of outermost) {
    const part = textOf(node);
    const at = part ? result.lastIndexOf(part) : -1;
    if (at >= 0) result = result.slice(0, at) + result.slice(at + part.length);
  }
  return result;
}`;

/**
 * Page-side text of an element that shows content through `<slot>`s (or of
 * a slot itself), which `innerText` leaves out: each slot is replaced by
 * what it shows, its assigned nodes flattened through nested slots (or its
 * fallback content when nothing is assigned). Elements without slots are
 * read with `innerText`; those that are not rendered are left out, and
 * those that are not inline are set apart by line breaks. The text is cut
 * at `limit` characters, and an element whose text alone passes the limit
 * is read from its text nodes (`textContent`) instead of `innerText`, which
 * would lay out all of it.
 */
export const SLOTTED_TEXT_JS = `(el, limit) => {
  let text = '';
  const read = (node) => {
    if (text.length >= limit) return;
    if (node.nodeType === 3) text += node.data;
    if (node.nodeType !== 1) return;
    if (node.localName === 'slot') {
      node.assignedNodes({ flatten: true }).forEach(read);
      return;
    }
    const display = node.ownerDocument.defaultView.getComputedStyle(node).display;
    if (node.checkVisibility && !node.checkVisibility() && display !== 'contents') return;
    const apart = display.startsWith('inline') || display === 'contents' ? '' : '\\n';
    text += apart;
    if (node.querySelector('slot')) Array.from(node.childNodes).forEach(read);
    else if ((node.textContent || '').length > limit - text.length) text += (node.textContent || '').slice(0, limit - text.length);
    else text += typeof node.innerText === 'string' ? node.innerText : node.textContent || '';
    text += apart;
  };
  if (el.localName === 'slot') read(el);
  else Array.from(el.childNodes).forEach(read);
  return text.slice(0, limit);
}`;

/**
 * Page-side text of an element as a user sees it: `innerText` for a rendered
 * element (CSS-hidden parts left out, inline elements not split apart), none
 * for an element that is not rendered, `textContent` for SVG and other
 * elements without `innerText` and for `display: contents` wrappers (no box
 * of their own, but their children are shown), and the label of an
 * `<option>` (which its `<select>` renders). An element in a shadow root
 * that shows light-DOM content through a `<slot>` (and a slot itself) is
 * read with that content ({@link SLOTTED_TEXT_JS}). For large containers
 * (more than 2000 characters of text) only the start is read, from the text
 * nodes whose parent is rendered, so a preview never lays out a whole page's
 * text, unless `full` is set. Decorations are left out
 * ({@link WITHOUT_DECORATIONS_JS}).
 */
export const ELEMENT_TEXT_JS = `(el, full) => {
  const withoutDecorations = ${WITHOUT_DECORATIONS_JS};
  const slottedText = ${SLOTTED_TEXT_JS};
  const all = el.textContent || '';
  if (el.tagName === 'OPTION') return el.label;
  if (typeof el.innerText !== 'string') return full ? all : all.slice(0, 2000);
  const rendered = (node) => !node.checkVisibility || node.checkVisibility();
  const shown = rendered(el);
  const boxless = !shown && el.ownerDocument.defaultView.getComputedStyle(el).display === 'contents';
  if (!shown && !boxless) return '';
  if (el.localName === 'slot' || el.querySelector('slot')) {
    return withoutDecorations(el, slottedText(el, full ? Infinity : 2000));
  }
  if (boxless) return withoutDecorations(el, full ? all : all.slice(0, 2000));
  if (full || all.length <= 2000) return withoutDecorations(el, el.innerText);
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let start = '';
  while (start.length < 1000 && walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!parent || rendered(parent)) start += walker.currentNode.data;
  }
  return withoutDecorations(el, start);
}`;

/** Shown instead of a secret field value (the same for every length) */
export const MASKED_VALUE = '••••';

/**
 * Page-side check whether a form control holds a secret whose value must
 * never leave the page: a password field (live type or type attribute), a
 * field shown masked by CSS (`-webkit-text-security` other than `none`),
 * one whose `autocomplete` names a password, a payment card (`cc-*`) or a
 * one-time code, or a field named like a password, one-time code or card code
 * (`password`, `passwd`, `pwd`, `passcode`, `otp`, `cvv`, `cvc`), which
 * covers a password field switched to text by a "show password" button.
 */
export const SENSITIVE_FIELD_JS = `(el) => {
  const autocomplete = el.getAttribute('autocomplete') || '';
  if (/(^|\\s)(cc-[a-z-]+|one-time-code|current-password|new-password)(\\s|$)/i.test(autocomplete)) return true;
  if (el.type === 'password' || /^password$/i.test(el.getAttribute('type') || '')) return true;
  const names = [el.getAttribute('name'), el.id, autocomplete].join(' ');
  if (/passw|passwd|pwd|passcode|(^|[^a-z])otp([^a-z]|$)|cvv|cvc/i.test(names)) return true;
  try {
    const security = el.ownerDocument.defaultView.getComputedStyle(el).getPropertyValue('-webkit-text-security');
    return Boolean(security) && security !== 'none';
  } catch (e) {
    return false;
  }
}`;

/**
 * Page-side live state of a form control, which its attributes do not show:
 * the type and current value of an `<input>` (for checkboxes and radios
 * `checked` and their `value` attribute, not the default "on"), the value of
 * a `<textarea>`, the labels of a `<select>`'s selected options and the type
 * of a `<button>` in a form (`submit` when it has none; outside a form only
 * a type attribute is shown). Empty for other elements.
 *
 * Secrets never leave the page: a hidden input's value is left out, and the
 * value (or selected option) of a sensitive field ({@link SENSITIVE_FIELD_JS})
 * is replaced by {@link MASKED_VALUE}, whatever its length, with
 * `sensitive: true`.
 */
export const ELEMENT_STATE_JS = `(el) => {
  const isSensitive = ${SENSITIVE_FIELD_JS};
  const mask = (value) => (value ? '${MASKED_VALUE}' : '');
  const guarded = (state) => {
    if (!isSensitive(el)) return state;
    const result = { ...state, sensitive: true };
    if ('value' in result) result.value = mask(result.value);
    if ('selected' in result) result.selected = mask(result.selected);
    return result;
  };
  switch (el.localName) {
    case 'input':
      if (el.type === 'hidden') return { type: 'hidden' };
      return guarded(
        /^(checkbox|radio)$/.test(el.type)
          ? { type: el.type, checked: el.checked, value: el.getAttribute('value') || '' }
          : { type: el.type, value: el.value }
      );
    case 'textarea':
      return guarded({ value: el.value });
    case 'select':
      return guarded({ selected: Array.from(el.selectedOptions || [], (option) => option.label).join(', ') });
    case 'button':
      return el.form ? { type: el.type } : {};
    default:
      return {};
  }
}`;

/**
 * Page-side short description of an element: tag, id and up to two classes,
 * e.g. `button#save.primary.large`.
 */
export const ELEMENT_DESCRIPTION_JS = `(node) => node.tagName.toLowerCase() +
  (node.id ? '#' + node.id : '') +
  (node.classList && node.classList.length ? '.' + Array.from(node.classList).slice(0, 2).join('.') : '')`;

/**
 * Page-side position of an element among its parent's children with the
 * same short description ({@link ELEMENT_DESCRIPTION_JS}), e.g. `(2nd of 3)`;
 * empty when it is the only one.
 */
export const SIBLING_POSITION_JS = `(el) => {
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const parent = el.parentElement;
  if (!parent) return '';
  const own = describe(el);
  const same = Array.from(parent.children).filter((child) => describe(child) === own);
  if (same.length < 2) return '';
  const n = same.indexOf(el) + 1;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
  return '(' + n + suffix + ' of ' + same.length + ')';
}`;

/**
 * Page-side identity of an element an action hit, so the output says which
 * one it was, as one string: its short description
 * ({@link ELEMENT_DESCRIPTION_JS}) and visible text (button value for button
 * inputs, decorations left out), e.g. `button#add.btn "Add to cart"`. A
 * `<select>` is named by its label, aria-label or name, else by its selected
 * option, e.g. `select.sort "Sort products"`. An element without visible
 * text is described by itself first: by its position among same-looking
 * siblings ({@link SIBLING_POSITION_JS}), e.g. `div.figure (2nd of 3)`, with
 * its aria-label, placeholder or title when it has one. Only an element
 * without an id that is the only one of its kind is named by the nearest of
 * three ancestors that has text, e.g.
 * `input.toggle in div.view "Write report"` (rows of a list share their
 * aria-label), leaving out the options
 * of `<select>`s in it (read like `innerText`: CSS-hidden text is left out of
 * a rendered ancestor; at most 500 text nodes; selects in shadow roots are
 * not looked into), and never past an editable ancestor, whose text may be
 * typed input; otherwise its aria-label, placeholder or title is used. Texts
 * are cut at 40 characters. Contenteditable elements count as controls: what
 * was typed into them is never echoed (nor their ancestors' text).
 */
export const ELEMENT_IDENTITY_JS = `(el) => {
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const siblingPosition = ${SIBLING_POSITION_JS};
  const withoutDecorations = ${WITHOUT_DECORATIONS_JS};
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();
  const cut = (text) => {
    const characters = Array.from(text);
    return characters.length > 40 ? characters.slice(0, 40).join('') + '…' : text;
  };
  const isControl = (node) => /^(input|select|textarea)$/.test(node.localName) || node.isContentEditable;
  const shownText = (node) =>
    isControl(node) ? '' : clean(withoutDecorations(node, typeof node.innerText === 'string' ? node.innerText : node.textContent));
  const buttonValue = (node) => (node.localName === 'input' && /^(submit|button|reset)$/i.test(node.type) ? clean(node.value) : '');
  const attributeText = (node) =>
    clean(node.getAttribute('aria-label')) || clean(node.getAttribute('placeholder')) || clean(node.getAttribute('title'));
  const selectName = (node) =>
    clean(node.labels && node.labels[0] && node.labels[0].innerText) ||
    clean(node.getAttribute('aria-label')) ||
    clean(node.getAttribute('name')) ||
    clean(node.selectedOptions && node.selectedOptions[0] && node.selectedOptions[0].label);
  const shown = (node, options) => !node.checkVisibility || node.checkVisibility(options);
  const textOutsideSelects = (node) => {
    if (!node.querySelector('select')) return shownText(node);
    const hiddenLeftOut = shown(node);
    const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = '';
    for (let visited = 0; visited < 500 && text.length < 200 && walker.nextNode(); visited++) {
      const parent = walker.currentNode.parentElement;
      if (!parent || parent.closest('select, textarea')) continue;
      if (!hiddenLeftOut || shown(parent, { visibilityProperty: true })) text += ' ' + walker.currentNode.data;
    }
    return clean(text);
  };
  const quoted = (text) => (text ? ' "' + cut(text) + '"' : '');
  const visible = shownText(el) || buttonValue(el) || (el.localName === 'select' ? selectName(el) : '');
  if (visible) return describe(el) + quoted(visible);
  const attribute = attributeText(el);
  const position = siblingPosition(el);
  if (position) return describe(el) + ' ' + position + quoted(attribute);
  let ancestor = el.id || el.isContentEditable ? null : el.parentElement;
  for (let depth = 0; ancestor && depth < 3; depth++, ancestor = ancestor.parentElement) {
    if (isControl(ancestor)) break;
    const text = textOutsideSelects(ancestor);
    if (text) return describe(el) + ' in ' + describe(ancestor) + quoted(text);
  }
  return describe(el) + quoted(attribute);
}`;

/**
 * Page-side location of an element: the iframes it is in (outermost first)
 * and the shadow root holding it, with the host's first class and light-DOM
 * text, e.g. `iframe#pay > shadow root of <sl-button.primary "Save">`;
 * empty for the main document.
 */
export const ELEMENT_CONTEXT_JS = `(el) => {
  const describe = (node) => node.tagName.toLowerCase() + (node.id ? '#' + node.id : '');
  const parts = [];
  for (let doc = el.ownerDocument; doc && doc.defaultView && doc.defaultView.frameElement; ) {
    const frame = doc.defaultView.frameElement;
    parts.unshift(describe(frame));
    doc = frame.ownerDocument;
  }
  const root = el.getRootNode();
  if (root.host) {
    const host = root.host;
    const label = describe(host) + (!host.id && host.classList.length ? '.' + host.classList[0] : '');
    const text = (host.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 30);
    parts.push('shadow root of <' + label + (text ? ' "' + text + '"' : '') + '>');
  }
  return parts.join(' > ');
}`;

/**
 * Short text preview of an element's text: whitespace collapsed, cut on a
 * whole character (an emoji is never split, which would make JSON invalid).
 *
 * @param text - Element text as the page renders it
 * @param length - Characters kept
 * @returns Collapsed text, truncated to `length` characters (followed by `...`)
 */
export function textPreview(text: string, length = PREVIEW_LENGTH): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(collapsed);
  return characters.length > length ? characters.slice(0, length).join('') + '...' : collapsed;
}
