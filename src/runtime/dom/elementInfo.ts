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
 * Page-side text of an element as a user sees it: `innerText` for a rendered
 * element (CSS-hidden parts left out, inline elements not split apart), none
 * for an element that is not rendered, `textContent` for SVG and other
 * elements without `innerText` and for `display: contents` wrappers (no box
 * of their own, but their children are shown), and the label of an
 * `<option>` (which its `<select>` renders). For large containers (more
 * than 2000 characters of text) only the start is read, from the text nodes
 * whose parent is rendered, so a preview never lays out a whole page's text.
 */
export const ELEMENT_TEXT_JS = `(el) => {
  const all = el.textContent || '';
  if (el.tagName === 'OPTION') return el.label;
  if (typeof el.innerText !== 'string') return all.slice(0, 2000);
  const rendered = (node) => !node.checkVisibility || node.checkVisibility();
  if (!rendered(el)) {
    const boxless = el.ownerDocument.defaultView.getComputedStyle(el).display === 'contents';
    return boxless ? all.slice(0, 2000) : '';
  }
  if (all.length <= 2000) return el.innerText;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let start = '';
  while (start.length < 1000 && walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!parent || rendered(parent)) start += walker.currentNode.data;
  }
  return start;
}`;

/**
 * Page-side short description of an element: tag, id and up to two classes,
 * e.g. `button#save.primary.large`.
 */
export const ELEMENT_DESCRIPTION_JS = `(node) => node.tagName.toLowerCase() +
  (node.id ? '#' + node.id : '') +
  (node.classList && node.classList.length ? '.' + Array.from(node.classList).slice(0, 2).join('.') : '')`;

/**
 * Page-side identity of an element an action hit, so the output says which
 * one it was: its short description ({@link ELEMENT_DESCRIPTION_JS}) and
 * visible text (button value for button inputs), e.g.
 * `button#add.btn "Add to cart"`. An element without visible text and
 * without an id is named by the nearest of three ancestors that has text,
 * e.g. `input.toggle in div.view "Write report"` (rows of a list share their
 * aria-label), leaving out the options of `<select>`s in it (read like
 * `innerText`: CSS-hidden text is left out of a rendered ancestor; at most
 * 500 text nodes; selects in shadow roots are not looked into), and never
 * past an editable ancestor, whose text may be typed input; otherwise its
 * aria-label, placeholder or title is used. A `<select>` is named by its
 * label, aria-label or name, else by its selected option, e.g.
 * `select.sort "Sort products"`. Texts are cut at 40 characters.
 * Contenteditable elements count as controls: what was typed into them is
 * never echoed (nor their ancestors' text).
 */
export const ELEMENT_IDENTITY_JS = `(el) => {
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const clean = (text) => (text || '').replace(/\\s+/g, ' ').trim();
  const cut = (text) => {
    const characters = Array.from(text);
    return characters.length > 40 ? characters.slice(0, 40).join('') + '…' : text;
  };
  const isControl = (node) => /^(input|select|textarea)$/.test(node.localName) || node.isContentEditable;
  const shownText = (node) => (isControl(node) ? '' : clean(typeof node.innerText === 'string' ? node.innerText : node.textContent));
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
  const visible = shownText(el) || buttonValue(el) || (el.localName === 'select' ? selectName(el) : '');
  if (visible) return describe(el) + ' "' + cut(visible) + '"';
  let ancestor = el.id || el.isContentEditable ? null : el.parentElement;
  for (let depth = 0; ancestor && depth < 3; depth++, ancestor = ancestor.parentElement) {
    if (isControl(ancestor)) break;
    const text = textOutsideSelects(ancestor);
    if (text) return describe(el) + ' in ' + describe(ancestor) + ' "' + cut(text) + '"';
  }
  const attribute = attributeText(el);
  return attribute ? describe(el) + ' "' + cut(attribute) + '"' : describe(el);
}`;

/**
 * Page-side location of an element: the iframes it is in (outermost first)
 * and the shadow root holding it, e.g. `iframe#pay > shadow root of <x-card>`;
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
  if (root.host) parts.push('shadow root of <' + describe(root.host) + '>');
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
