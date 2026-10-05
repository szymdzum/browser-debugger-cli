/**
 * Page-side descriptions of elements for DOM command output (`dom query`,
 * `dom layout`, DOM context of console messages): their text as a user sees
 * it and where they live (iframes, shadow roots).
 */

/** Length of the text preview shown for elements. */
const PREVIEW_LENGTH = 80;

/**
 * Page-side text of an element as a user sees it: `innerText` for a rendered
 * element (CSS-hidden parts left out, inline elements not split apart), none
 * for an element that is not rendered, `textContent` for SVG and other
 * elements without `innerText` and for `display: contents` wrappers (no box
 * of their own, but their children are shown). For large containers (more
 * than 2000 characters of text) only the start is read, from the text nodes
 * whose parent is rendered, so a preview never lays out a whole page's text.
 */
export const ELEMENT_TEXT_JS = `(el) => {
  const all = el.textContent || '';
  if (typeof el.innerText !== 'string') return all.slice(0, 2000);
  const rendered = (node) => !node.checkVisibility || node.checkVisibility();
  if (!rendered(el)) {
    const boxless = el.ownerDocument.defaultView.getComputedStyle(el).display === 'contents';
    return boxless ? all.slice(0, 2000) : '';
  }
  if (all.length <= 2000) return el.innerText;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let start = '';
  while (start.length < 500 && walker.nextNode()) {
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
 * @returns Collapsed text, truncated to {@link PREVIEW_LENGTH} characters
 */
export function textPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(collapsed);
  return characters.length > PREVIEW_LENGTH
    ? characters.slice(0, PREVIEW_LENGTH).join('') + '...'
    : collapsed;
}
