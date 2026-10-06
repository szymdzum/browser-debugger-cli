/**
 * Page-side part of `bdg dom inspect`: one call on the element reads what
 * computed styles do not say. Its text as a user sees it (`innerText`, form
 * values, secrets masked), where it sits in its parent (distances to the
 * parent's content edges and to its neighbouring siblings), the
 * backgrounds behind it (for the contrast of its text), the computed (not
 * resolved) width and height (`auto` vs a length, for hug/fill/fixed) and
 * the child tree, all in one walk: children are never styled one CDP call at
 * a time.
 *
 * Children are those of the flat tree: an open shadow root's children
 * instead of the light DOM, slots replaced by what is assigned to them, and
 * `display: contents` wrappers by their children.
 */

import {
  ELEMENT_CONTEXT_JS,
  ELEMENT_DESCRIPTION_JS,
  MASKED_VALUE,
  SENSITIVE_FIELD_JS,
} from '@/runtime/dom/elementInfo.js';

/** Elements walked for the child tree at most (the rest are counted) */
export const TREE_NODE_CAP = 400;

/** A child as the page-side walk reports it */
export interface RawTreeNode {
  /** `tag#id` or `tag.firstClass` */
  label: string;
  /** Position of the border box relative to the parent's */
  x: number;
  y: number;
  w: number;
  h: number;
  display: string;
  /** Text of an element without block-level children */
  text?: string;
  children?: RawTreeNode[];
  /** Rendered element children (at the depth limit) */
  childCount?: number;
  /** Element children that are not rendered */
  hidden?: number;
}

/** A background behind the element (the element's own first) */
export interface RawBackground {
  /** Computed `background-color` */
  color: string;
  /** Has a background image or gradient */
  image: boolean;
}

/** What {@link INSPECT_PAGE_JS} returns */
export interface RawInspect {
  tag: string;
  id: string;
  classes: string[];
  context: string;
  /** Text (innerText) or form value, whitespace collapsed (at most 200 characters) */
  content: string;
  /** Placeholder of an empty text field */
  placeholder?: string;
  /** Computed color of its `::placeholder` */
  placeholderColor?: string;
  /** Font style and weight of the placeholder (they decide whether it is large text) */
  placeholderFont?: { style: string; weight: string };
  /**
   * Has text to describe: a text field or select, its own text where most
   * of its text is, or only inline content with text
   */
  textual: boolean;
  formControl: boolean;
  /**
   * Label of the descendant that draws most of the text (`abbr`,
   * `slot.button__label`) when it is not the element itself; its styles are
   * the text's
   */
  textHolder?: string;
  /** Its text (the element, or the descendant that draws it) has a box and is not `visibility: hidden` */
  rendered: boolean;
  /** Visible text is drawn in it (or it is a text field or select) */
  hasText: boolean;
  /** Replaced element (img, svg and its shapes, video, canvas, iframe, embed, object, form controls): sized by its content */
  replaced?: boolean;
  /** An SVG element (SVG properties are not noise for it) */
  svg?: boolean;
  /** Computed (not resolved) width and height: `auto`, `200px`, `50%`, … */
  typed: { width: string; height: string };
  /** Short description of the parent that lays it out */
  parent?: string;
  /** Distances from that parent's content box edges */
  inParent?: { left: number; top: number; right: number; bottom: number };
  /** Gaps to the previous and next rendered in-flow siblings, by the side they are on */
  siblings?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Content size when it overflows the box */
  scroll?: { w: number; h: number; clientW: number; clientH: number };
  /** Backgrounds from the element up to the root */
  backgrounds: RawBackground[];
  /** The page canvas behind everything is dark (color-scheme) */
  canvasDark: boolean;
  /** Opacity of the element times that of its ancestors */
  opacity?: number;
  tree?: RawTreeNode[];
  hiddenChildren: number;
  /** Children the walk did not reach ({@link TREE_NODE_CAP}) */
  treeSkipped: number;
  /**
   * `--props` values from `getComputedStyle` (shorthands and custom
   * properties too); a shorthand whose sides differ (no single value) is
   * given per side, e.g. `top 1px solid … / right 0px none …`
   */
  props?: Record<string, string>;
  /** `--props` names the browser does not know as CSS properties */
  unknownProps?: string[];
  /** The `--why` property is not a CSS property */
  unknownWhy?: boolean;
  /** Longhands of the `--why` property when it is a shorthand (as the browser expands it) */
  whyLonghands?: string[];
  /** Computed value of the `--why` shorthand (`getComputedStyle` writes it as one value) */
  whyComputed?: string;
  /** Properties of running CSS transitions, and names of running animations */
  animating: string[];
}

/**
 * Page-side flat-tree helpers: the element's computed style, its flat-tree
 * parent, the parent that lays it out (skipping `display: contents`), its
 * element children in the flat tree and whether an element is rendered.
 */
const FLAT_TREE_JS = `(view) => {
  const style = (n, pseudo) => view.getComputedStyle(n, pseudo);
  const skipped = /^(script|style|template|link|meta|noscript|title|head|base)$/;
  const flatParent = (n) => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const layoutParent = (n) => {
    let p = flatParent(n);
    while (p && style(p).display === 'contents') p = flatParent(p);
    return p;
  };
  const children = (n) => {
    const out = [];
    const add = (c) => {
      if (skipped.test(c.localName)) return;
      if (c.localName === 'slot') {
        const assigned = c.assignedElements({ flatten: true });
        (assigned.length ? assigned : Array.from(c.children)).forEach(add);
      } else if (style(c).display === 'contents') {
        Array.from((c.shadowRoot || c).children).forEach(add);
      } else {
        out.push(c);
      }
    };
    Array.from((n.shadowRoot || n).children).forEach(add);
    return out;
  };
  const rendered = (n) => n.getClientRects().length > 0 &&
    (!n.checkVisibility || n.checkVisibility({ visibilityProperty: true }));
  const container = (n) => children(n).some((c) => rendered(c) && !/^inline/.test(style(c).display));
  const label = (n) => n.localName + (n.id ? '#' + n.id : n.classList && n.classList.length ? '.' + n.classList[0] : '');
  return { style, skipped, flatParent, layoutParent, children, rendered, container, label };
}`;

/**
 * Page-side holder of an element's text: the element whose styles draw most
 * of the visible text in its flat tree (characters, whitespace aside), and
 * the element whose child text nodes those are (for the rendered font).
 * Text slotted into a shadow root is drawn with the slot's styles, and text
 * of an element with a shadow root that is not slotted is not drawn. Null
 * when there is no visible text.
 */
const TEXT_HOLDER_JS = `(el, tree) => {
  const counts = new Map();
  const parents = new Map();
  let budget = 2000;
  const shown = (n) => tree.style(n).display === 'contents' || tree.rendered(n);
  const nodesOf = (n) => {
    if (n.localName !== 'slot') return Array.from((n.shadowRoot || n).childNodes);
    const assigned = n.assignedNodes({ flatten: true });
    return assigned.length ? assigned : Array.from(n.childNodes);
  };
  const visit = (n) => {
    if (budget-- <= 0) return;
    for (const c of nodesOf(n)) {
      if (budget <= 0) return;
      if (c.nodeType === 3) {
        const length = c.data.replace(/\\s+/g, '').length;
        if (length === 0) continue;
        counts.set(n, (counts.get(n) || 0) + length);
        if (!parents.has(n)) parents.set(n, c.parentElement || n);
      } else if (c.nodeType === 1 && !tree.skipped.test(c.localName) && shown(c)) {
        visit(c);
      }
    }
  };
  visit(el);
  let best = null;
  for (const [holder, length] of counts) if (!best || length > counts.get(best)) best = holder;
  return best && { style: best, font: parents.get(best) };
}`;

/**
 * Page-side: whether a form control draws text of its own (a text field,
 * a select, a button-like input); checkboxes, radios, ranges and color
 * inputs do not. Buttons are not covered: their text is their content.
 */
const TEXT_CONTROL_JS = `(el) => {
  if (el.localName === 'textarea' || el.localName === 'select') return true;
  return el.localName === 'input' && !/^(checkbox|radio|range|color|hidden|image)$/.test(el.type);
}`;

/**
 * Page-side text of an element: a form control's value or a select's chosen
 * options (masked for secrets, {@link SENSITIVE_FIELD_JS}), else its
 * `innerText` (`textContent` for SVG), masked when CSS hides it as a secret
 * (`-webkit-text-security`), whitespace collapsed. A container holding a
 * select or textarea gets its visible text without theirs, so a form's text
 * never carries a chosen option or typed text.
 */
const TEXT_JS = `(el) => {
  const isSensitive = ${SENSITIVE_FIELD_JS};
  const clean = (text) => String(text || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
  if (el.localName === 'input' && el.type === 'hidden') return '';
  if (el.localName === 'input' || el.localName === 'textarea') {
    return el.value && isSensitive(el) ? '${MASKED_VALUE}' : clean(el.value);
  }
  if (el.localName === 'select') {
    const chosen = clean(Array.from(el.selectedOptions || [], (o) => o.label).join(', '));
    return chosen && isSensitive(el) ? '${MASKED_VALUE}' : chosen;
  }
  const outsideControls = () => {
    const parts = [];
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && parts.length < 400; n = walker.nextNode()) {
      const holder = n.parentElement;
      if (!holder || holder.closest('select, textarea, script, style, template, noscript')) continue;
      if (holder.checkVisibility && !holder.checkVisibility({ visibilityProperty: true })) continue;
      parts.push(n.data);
    }
    return parts.join(' ');
  };
  const holdsControls = Boolean(el.querySelector && el.querySelector('select, textarea'));
  const raw = holdsControls ? outsideControls() : typeof el.innerText === 'string' ? el.innerText : el.textContent;
  const text = clean(raw);
  const view = el.ownerDocument.defaultView;
  const security = view ? view.getComputedStyle(el).getPropertyValue('-webkit-text-security') : '';
  return text && security && security !== 'none' ? '${MASKED_VALUE}' : text;
}`;

/**
 * Page-side position of the element in its layout parent: distances from
 * the parent's content box edges and gaps to the previous and next rendered
 * in-flow siblings (not absolutely positioned or fixed), named by the side
 * the sibling is on. Not for fixed elements, whose box is not placed by
 * the parent.
 */
const PLACEMENT_JS = `(el, tree) => {
  const parent = tree.layoutParent(el);
  if (!parent || tree.style(el).position === 'fixed' || !tree.rendered(el)) return {};
  const r = el.getBoundingClientRect();
  const p = parent.getBoundingClientRect();
  const ps = tree.style(parent);
  const edge = (side) => parseFloat(ps['border-' + side + '-width']) + parseFloat(ps['padding-' + side]);
  const inParent = {
    left: r.left - (p.left + edge('left')),
    top: r.top - (p.top + edge('top')),
    right: (p.right - edge('right')) - r.right,
    bottom: (p.bottom - edge('bottom')) - r.bottom
  };
  const inFlow = (n) => n !== el && tree.rendered(n) && !/^(absolute|fixed)$/.test(tree.style(n).position);
  const siblings = tree.children(parent);
  const at = siblings.indexOf(el);
  const before = siblings.slice(0, Math.max(at, 0)).reverse().find(inFlow);
  const after = at < 0 ? undefined : siblings.slice(at + 1).find(inFlow);
  const gaps = {};
  for (const sibling of [before, after]) {
    if (!sibling) continue;
    const s = sibling.getBoundingClientRect();
    if (s.bottom <= r.top + 0.5) gaps.top = r.top - s.bottom;
    else if (s.top >= r.bottom - 0.5) gaps.bottom = s.top - r.bottom;
    else if (s.right <= r.left + 0.5) gaps.left = r.left - s.right;
    else if (s.left >= r.right - 0.5) gaps.right = s.left - r.right;
  }
  return { inParent: inParent, siblings: gaps };
}`;

/**
 * Page-side backgrounds behind the element (its own first, then its flat-tree
 * ancestors up to the root), the product of its and their opacity, and
 * whether the page canvas is dark: the root's
 * `color-scheme` (or the `color-scheme` meta tag) allows dark and either
 * only dark or the page prefers dark.
 */
const BACKGROUNDS_JS = `(el, tree, view) => {
  const backgrounds = [];
  let opacity = 1;
  for (let n = el; n && backgrounds.length < 60; n = tree.flatParent(n)) {
    const s = tree.style(n);
    backgrounds.push({ color: s.backgroundColor, image: s.backgroundImage !== 'none' });
    opacity *= Number(s.opacity) || 0;
  }
  const doc = el.ownerDocument;
  const meta = doc.querySelector('meta[name="color-scheme"]');
  const rootScheme = tree.style(doc.documentElement).colorScheme;
  const scheme = rootScheme && rootScheme !== 'normal' ? rootScheme : (meta && meta.content) || '';
  const prefersDark = view.matchMedia('(prefers-color-scheme: dark)').matches;
  const canvasDark = /dark/.test(scheme) && (!/light/.test(scheme) || prefersDark);
  return { backgrounds: backgrounds, canvasDark: canvasDark, opacity: opacity };
}`;

/**
 * Page-side child tree to `depth` levels: per element its label, size,
 * display, position relative to its parent's border box (like Figma's x/y
 * in a frame), text (only for elements without block-level children), and its
 * rendered children (or their count at the depth limit) with a count of the
 * hidden ones. Stops after {@link TREE_NODE_CAP} elements and counts the
 * children it did not reach.
 */
const TREE_JS = `(el, tree, textOf, depth) => {
  let budget = ${TREE_NODE_CAP};
  let skipped = 0;
  const walk = (kids, level, origin) => {
    const shown = kids.filter(tree.rendered);
    const nodes = [];
    for (const k of shown) {
      if (budget <= 0) { skipped++; continue; }
      budget--;
      nodes.push(nodeOf(k, level, origin));
    }
    return { nodes: nodes, hidden: kids.length - shown.length };
  };
  const nodeOf = (n, level, origin) => {
    const r = n.getBoundingClientRect();
    const node = { label: tree.label(n), x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height, display: tree.style(n).display };
    const kids = tree.children(n);
    if (!tree.container(n)) node.text = textOf(n).slice(0, 60);
    if (level >= depth) {
      node.childCount = kids.filter(tree.rendered).length;
      return node;
    }
    const sub = walk(kids, level + 1, r);
    node.children = sub.nodes;
    node.hidden = sub.hidden;
    return node;
  };
  if (depth <= 0) return { hiddenChildren: 0, treeSkipped: 0 };
  const top = walk(tree.children(el), 1, el.getBoundingClientRect());
  return { tree: top.nodes, hiddenChildren: top.hidden, treeSkipped: skipped };
}`;

/**
 * Page-side function run on the element (`this`), see {@link RawInspect}.
 * Arguments: tree depth, the property names asked for with `--props` (or
 * null) and the `--why` property (or null).
 */
export const INSPECT_PAGE_JS = `function (depth, props, why) {
  const el = this;
  const view = el.ownerDocument.defaultView;
  const tree = (${FLAT_TREE_JS})(view);
  const textOf = ${TEXT_JS};
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const s = tree.style(el);
  const formControl = /^(input|textarea|select|button)$/.test(el.localName);
  const textControl = (${TEXT_CONTROL_JS})(el);
  const holder = textControl ? null : (${TEXT_HOLDER_JS})(el, tree);
  const textual = textControl || Boolean(holder && (holder.style === el || !tree.container(el)));
  const textFrom = holder && holder.style !== el ? holder.style : el;
  const content = textOf(el);
  const parent = tree.layoutParent(el);
  const typedMap = el.computedStyleMap ? el.computedStyleMap() : null;
  const typed = (name) => { try { return typedMap ? String(typedMap.get(name)) : ''; } catch (e) { return ''; } };
  const result = {
    tag: el.localName,
    id: el.id || '',
    classes: el.classList ? Array.from(el.classList) : [],
    context: (${ELEMENT_CONTEXT_JS})(el),
    content: content,
    textual: textual,
    formControl: formControl,
    rendered: textual && textFrom !== el
      ? tree.style(textFrom).visibility !== 'hidden' && tree.rendered(tree.style(textFrom).display === 'contents' ? tree.layoutParent(textFrom) : textFrom)
      : tree.rendered(el),
    hasText: textControl || holder !== null,
    replaced: el instanceof SVGElement || /^(img|video|canvas|iframe|embed|object|input|textarea|select|button|meter|progress)$/.test(el.localName),
    svg: el.namespaceURI === 'http://www.w3.org/2000/svg',
    typed: { width: typed('width'), height: typed('height') },
    parent: parent ? describe(parent) : undefined,
    animating: el.getAnimations ? [...new Set(el.getAnimations().filter((a) => a.playState === 'running').map((a) => a.transitionProperty || a.animationName || 'animation'))] : []
  };
  if (textFrom !== el) result.textHolder = tree.label(textFrom);
  if (/^(input|textarea)$/.test(el.localName) && el.placeholder && !el.value) {
    result.placeholder = el.placeholder.replace(/\\s+/g, ' ').trim();
    const placeholderStyle = tree.style(el, '::placeholder');
    result.placeholderColor = placeholderStyle.color;
    result.placeholderFont = { style: placeholderStyle.fontStyle, weight: placeholderStyle.fontWeight };
  }
  if (el.clientWidth > 0 && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
    result.scroll = { w: el.scrollWidth, h: el.scrollHeight, clientW: el.clientWidth, clientH: el.clientHeight };
  }
  if (props) {
    const known = (name) => name.startsWith('--') || CSS.supports(name, 'inherit');
    const valueOf = (name) => {
      const value = s.getPropertyValue(name).trim();
      if (value !== '' || name.startsWith('--')) return value;
      const sides = ['top', 'right', 'bottom', 'left'].map((side) => name + '-' + side).filter(known);
      return sides.map((side) => side.slice(name.length + 1) + ' ' + s.getPropertyValue(side).trim()).join(' / ');
    };
    result.props = Object.fromEntries(props.filter(known).map((name) => [name, valueOf(name)]));
    result.unknownProps = props.filter((name) => !known(name));
  }
  if (why && !why.startsWith('--')) {
    if (!CSS.supports(why, 'inherit')) result.unknownWhy = true;
    else {
      const probe = el.ownerDocument.createElement('div').style;
      probe.setProperty(why, 'inherit');
      if (probe.length > 1) {
        result.whyLonghands = Array.from(probe);
        result.whyComputed = s.getPropertyValue(why).trim();
      }
    }
  }
  return Object.assign(result,
    (${PLACEMENT_JS})(el, tree),
    (${BACKGROUNDS_JS})(textual ? textFrom : el, tree, view),
    (${TREE_JS})(el, tree, textOf, depth));
}`;

/**
 * Page-side function run on the element (`this`) that returns another
 * element whose styles CDP reads: `"parent"`, the parent that lays it out
 * (`display: contents` skipped, through shadow roots and slots),
 * `"textHolder"`, the element whose styles draw most of its text
 * ({@link TEXT_HOLDER_JS}; the element itself when that is its own text), or
 * `"fontHolder"`, the parent of that text's nodes (for the rendered font: a
 * slot's text nodes belong to the host's light DOM). Null when there is none.
 */
export const RELATED_NODE_JS = `function (which) {
  const tree = (${FLAT_TREE_JS})(this.ownerDocument.defaultView);
  if (which === 'parent') return tree.layoutParent(this);
  const holder = (${TEXT_HOLDER_JS})(this, tree);
  if (!holder) return null;
  return which === 'textHolder' ? holder.style : holder.font;
}`;
