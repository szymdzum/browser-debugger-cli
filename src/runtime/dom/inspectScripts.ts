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
  COMPOSED_JS,
  ELEMENT_CONTEXT_JS,
  ELEMENT_DESCRIPTION_JS,
  FLAT_TEXT_JS,
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
  /** Reached through a slot or a `display: contents` wrapper (`slot.label`, `div.row (contents)`) */
  via?: string;
  /** In the shadow root of its parent */
  shadow?: boolean;
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
  /** Its own opacity, below 1 (it fades its background and everything inside it) */
  opacity?: number;
}

/** A rule that would set a property if its `@media`/`@supports` condition applied */
export interface InactiveRule {
  selector: string;
  /** e.g. `@media (max-width: 600px)` */
  condition: string;
  value: string;
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
  /**
   * The first family of the text's `font-family` is a web font (`@font-face`)
   * the page loaded: whatever name the font file gives, it is not a fallback
   */
  familyLoaded?: boolean;
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
  /** Its text is cut off: clipped by `overflow` (ellipsis or not) or by a line clamp, on it or its text holder */
  truncated?: boolean;
  /** Content size when it overflows the box */
  scroll?: { w: number; h: number; clientW: number; clientH: number };
  /** Backgrounds from the element up to the root */
  backgrounds: RawBackground[];
  /** The page canvas behind everything is dark (color-scheme) */
  canvasDark: boolean;
  /** Opacity of the element times that of its ancestors */
  opacity?: number;
  /**
   * What makes the text's contrast approximate: blend modes and filters on
   * it or its ancestors, painted content behind it that is not an ancestor
   * (a canvas, a positioned layer) or on top of it
   */
  paintRisks?: string[];
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
  /** Font size of the root element (px), for rem custom properties in `--props` */
  rootFontSize?: number;
  /** `--props` names the browser does not know as CSS properties */
  unknownProps?: string[];
  /** The `--why` property is not a CSS property */
  unknownWhy?: boolean;
  /** Longhands of the `--why` property when it is a shorthand (as the browser expands it) */
  whyLonghands?: string[];
  /** Computed value of the `--why` shorthand (`getComputedStyle` writes it as one value) */
  whyComputed?: string;
  /** Rules for the element that set the `--why` property under a condition that does not apply now */
  whyInactive?: InactiveRule[];
  /** Properties of running CSS transitions, and names of running animations (time-based: scroll-driven ones do not change on their own) */
  animating: string[];
}

/**
 * Page-side flat-tree helpers: the element's computed style, its flat-tree
 * parent, the parent that lays it out (skipping `display: contents`), its
 * element children in the flat tree and whether an element is rendered.
 */
export const FLAT_TREE_JS = `(view) => {
  const style = (n, pseudo) => view.getComputedStyle(n, pseudo);
  const skipped = /^(script|style|template|link|meta|noscript|title|head|base)$/;
  const flatParent = (n) => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const layoutParent = (n) => {
    let p = flatParent(n);
    while (p && style(p).display === 'contents') p = flatParent(p);
    return p;
  };
  const via = new WeakMap();
  const label = (n) => n.localName + (n.id ? '#' + n.id : n.classList && n.classList.length ? '.' + n.classList[0] : '');
  const slotText = (slot) => slot.assignedNodes({ flatten: true }).some((t) => t.nodeType === 3 && t.data.trim() !== '');
  const children = (n) => {
    const out = [];
    const add = (c, through) => {
      if (skipped.test(c.localName)) return;
      if (c.localName === 'slot') {
        const assigned = c.assignedElements({ flatten: true });
        if (assigned.length === 0 && slotText(c)) out.push(c);
        else (assigned.length ? assigned : Array.from(c.children)).forEach((a) => add(a, label(c)));
      } else if (style(c).display === 'contents') {
        Array.from((c.shadowRoot || c).children).forEach((a) => add(a, label(c) + ' (contents)'));
      } else {
        if (through) via.set(c, through);
        out.push(c);
      }
    };
    Array.from((n.shadowRoot || n).children).forEach((c) => add(c, null));
    return out;
  };
  const rendered = (n) => n.getClientRects().length > 0 &&
    (!n.checkVisibility || n.checkVisibility({ visibilityProperty: true }));
  const container = (n) => children(n).some((c) => rendered(c) && !/^inline/.test(style(c).display));
  return { style, skipped, flatParent, layoutParent, children, rendered, container, label, via, slotText };
}`;

/**
 * Page-side holder of an element's text: the element whose styles draw most
 * of the visible text in its flat tree (characters, whitespace aside), and
 * the element whose child text nodes those are (for the rendered font).
 * Text slotted into a shadow root is drawn with the slot's styles, and text
 * of an element with a shadow root that is not slotted is not drawn, nor is
 * text inside a fully transparent descendant (a measuring copy under a
 * mask). Null when there is no visible text.
 */
const TEXT_HOLDER_JS = `(el, tree) => {
  const counts = new Map();
  const parents = new Map();
  let budget = 2000;
  const shown = (n) => Number(tree.style(n).opacity) !== 0 && (tree.style(n).display === 'contents' || tree.rendered(n));
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
  let total = 0;
  for (const length of counts.values()) total += length;
  return best && { style: best, font: parents.get(best), share: counts.get(best) / total };
}`;

/**
 * Page-side: whether loaded `@font-face` (or `FontFace`) faces of the first
 * family of an element's `font-family` cover the characters of its text
 * (their `unicode-range`): then that web font draws the text, whatever
 * name its file gives. A subset that lacks the text's characters (latin
 * loaded, Cyrillic text) does not count.
 */
const FAMILY_LOADED_JS = `(n, tree, text) => {
  const unquote = (name) => name.trim().replace(/^["']|["']$/g, '').toLowerCase();
  const match = /^\\s*("[^"]*"|'[^']*'|[^,]*)/.exec(tree.style(n).fontFamily);
  const first = unquote(match ? match[1] : '');
  if (!first || !n.ownerDocument.fonts) return false;
  const ranges = [];
  for (const face of n.ownerDocument.fonts) {
    if (face.status !== 'loaded' || unquote(face.family) !== first) continue;
    for (const part of face.unicodeRange.split(',')) {
      const [from, to] = part.trim().replace(/^U\\+/i, '').split('-');
      const low = parseInt(from.replace(/\\?/g, '0'), 16);
      const high = parseInt((to || from).replace(/\\?/g, 'F'), 16);
      if (!Number.isNaN(low) && !Number.isNaN(high)) ranges.push([low, high]);
    }
  }
  if (ranges.length === 0) return false;
  const covered = (code) => ranges.some(([low, high]) => code >= low && code <= high);
  return Array.from(text.replace(/\\s+/g, '')).every((char) => covered(char.codePointAt(0)));
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
 * `innerText` (`textContent` for SVG; the flat tree's text for web
 * components and slots, {@link FLAT_TEXT_JS}), masked when CSS hides it as a secret
 * (`-webkit-text-security`), whitespace collapsed. A container holding a
 * select or textarea gets its visible text without theirs, so a form's text
 * never carries a chosen option or typed text.
 */
const TEXT_JS = `(el) => {
  const isSensitive = ${SENSITIVE_FIELD_JS};
  const composed = ${COMPOSED_JS};
  const flatText = ${FLAT_TEXT_JS};
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
  const ownText = () => (typeof el.innerText === 'string' ? el.innerText : el.textContent);
  const raw = holdsControls ? outsideControls() : composed(el) ? flatText(el, 2000) : ownText();
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
  const zoom = parent.currentCSSZoom || 1;
  const edge = (side) => (parseFloat(ps['border-' + side + '-width']) + parseFloat(ps['padding-' + side])) * zoom;
  const inParent = {
    left: r.left - (p.left + edge('left')),
    top: r.top - (p.top + edge('top')),
    right: (p.right - edge('right')) - r.right,
    bottom: (p.bottom - edge('bottom')) - r.bottom
  };
  const inFlow = (n) => {
    if (n === el || !tree.rendered(n) || /^(absolute|fixed)$/.test(tree.style(n).position)) return false;
    const box = n.getBoundingClientRect();
    return box.width > 0 || box.height > 0;
  };
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
    const own = Number(s.opacity) || 0;
    const background = { color: s.backgroundColor, image: s.backgroundImage !== 'none' };
    backgrounds.push(own < 1 ? Object.assign(background, { opacity: own }) : background);
    opacity *= own;
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
 * Page-side hit test that also sees elements with `pointer-events: none`
 * (hero images, decorative layers and blended duplicates often have it, and
 * `elementsFromPoint` skips them): for the duration of `test`, a constructed
 * stylesheet makes every element of the given roots (documents and shadow
 * roots) hittable. It is added and removed within one script turn, so nothing
 * is painted with it and no DOM mutation is recorded. A root that already has
 * it (an outer call covering a whole page walk) is left as it is, so nested
 * calls cost no extra style recalculation.
 */
export const HIT_EVERYTHING_JS = `(roots, test) => {
  const added = [];
  for (const root of roots) {
    if (!root || !root.adoptedStyleSheets) continue;
    const view = (root.ownerDocument || root).defaultView;
    try {
      if (!view.__bdgHitSheet) {
        view.__bdgHitSheet = new view.CSSStyleSheet();
        view.__bdgHitSheet.replaceSync('* { pointer-events: auto !important; }');
      }
      if (root.adoptedStyleSheets.includes(view.__bdgHitSheet)) continue;
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, view.__bdgHitSheet];
      added.push([root, view.__bdgHitSheet]);
    } catch (e) {
      continue;
    }
  }
  try {
    return test();
  } finally {
    for (const [root, sheet] of added) root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
  }
}`;

/**
 * Page-side reasons the contrast of an element's text is approximate: a
 * blend mode or filter on it or an ancestor, and, hit-testing the middle of
 * its first line of text (else of its first box; only in the viewport), the
 * nearest element below it that is not an ancestor, above the first opaque
 * background of its own chain, and
 * paints (a canvas, video, image, background) and the nearest one on top of
 * it that paints (an overlay).
 */
export const PAINT_RISKS_JS = `(el, tree, textParent) => {
  const risks = [];
  const chain = [];
  for (let n = el; n && chain.length < 60; n = tree.flatParent(n)) chain.push(n);
  for (const n of chain) {
    const s = tree.style(n);
    if (s.mixBlendMode !== 'normal') risks.push('mix-blend-mode ' + s.mixBlendMode + ' on ' + tree.label(n));
    if (s.filter !== 'none') risks.push('filter on ' + tree.label(n));
  }
  const textNode = Array.from(textParent.childNodes).find((c) => c.nodeType === 3 && c.data.trim() !== '');
  const range = el.ownerDocument.createRange();
  if (textNode) range.selectNodeContents(textNode);
  const box = tree.style(el).display === 'contents' ? tree.layoutParent(el) : el;
  const rect = (textNode && range.getClientRects()[0]) || (box && box.getClientRects()[0]);
  const view = el.ownerDocument.defaultView;
  if (!rect) return risks;
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x >= view.innerWidth || y >= view.innerHeight) return risks;
  const root = el.getRootNode();
  const hits = (${HIT_EVERYTHING_JS})([el.ownerDocument, root], () => (root.elementsFromPoint ? root : el.ownerDocument).elementsFromPoint(x, y));
  const at = hits.findIndex((h) => chain.includes(h));
  if (at < 0) return risks;
  const clear = (color) => color === 'transparent' || /^rgba\\(.*,\\s*0\\)$/.test(color) || /\\/\\s*0\\)$/.test(color);
  const opaque = (n) => {
    const s = tree.style(n);
    return /^rgb\\(/.test(s.backgroundColor) && s.backgroundImage === 'none' && Number(s.opacity) === 1;
  };
  const paints = (n) => {
    const s = tree.style(n);
    return /^(canvas|video|img|iframe|embed|object|svg)$/.test(n.localName) || s.backgroundImage !== 'none' || !clear(s.backgroundColor);
  };
  let behind = null;
  for (const h of hits.slice(at)) {
    if (chain.includes(h)) {
      if (opaque(h)) break;
    } else if (paints(h)) {
      behind = h;
      break;
    }
  }
  if (behind) risks.push(tree.label(behind) + ' behind');
  const onTop = hits.slice(0, at).find((h) => !el.contains(h) && paints(h));
  if (onTop) risks.push(tree.label(onTop) + ' on top');
  return risks;
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
    const shown = kids.filter((k) => tree.rendered(k) || k.localName === 'slot');
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
    if (tree.via.has(n)) node.via = tree.via.get(n);
    if (n.parentNode && n.parentNode.nodeType === 11 && n.parentNode.host) node.shadow = true;
    if (n.localName === 'slot') {
      node.text = n.assignedNodes({ flatten: true }).map((t) => t.textContent).join(' ').replace(/\\s+/g, ' ').trim().slice(0, 60);
      return node;
    }
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
 * Page-side: rules for the element that set a property but sit under a
 * `@media` or `@supports` condition that does not apply now (at most 5),
 * from same-origin, `@import`ed, constructed and shadow-root stylesheets.
 */
const INACTIVE_RULES_JS = `(el, names) => {
  const view = el.ownerDocument.defaultView;
  const found = [];
  let budget = 20000;
  const unmet = (rule) => {
    if (rule.media && rule.media.mediaText && !view.matchMedia(rule.media.mediaText).matches) return '@media ' + rule.media.mediaText;
    if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) return '@supports ' + rule.conditionText;
    return null;
  };
  const sets = (rule) => names.map((name) => rule.style.getPropertyValue(name).trim()).find((value) => value !== '');
  const matches = (selector) => {
    try { return el.matches(selector); } catch (e) { return false; }
  };
  const visit = (rules, condition) => {
    for (const rule of Array.from(rules)) {
      if (budget-- <= 0 || found.length >= 5) return;
      if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
        try { if (rule.styleSheet) visit(rule.styleSheet.cssRules, condition); } catch (e) { continue; }
        continue;
      }
      const value = condition && rule.style && rule.selectorText ? sets(rule) : undefined;
      if (value !== undefined && matches(rule.selectorText)) found.push({ selector: rule.selectorText, condition: condition, value: value });
      if (rule.cssRules) visit(rule.cssRules, condition || unmet(rule));
    }
  };
  for (const scope of new Set([el.getRootNode(), el.ownerDocument])) {
    for (const sheet of [...Array.from(scope.styleSheets || []), ...Array.from(scope.adoptedStyleSheets || [])]) {
      try { visit(sheet.cssRules, null); } catch (e) { continue; }
    }
  }
  return found;
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
  const textChildren = tree.children(el).filter((c) => tree.rendered(c) && (c.textContent || '').trim() !== '').length;
  const textual = textControl || Boolean(holder && (holder.style === el || (holder.share >= 0.9 && textChildren <= 1) || !tree.container(el)));
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
    replaced: el instanceof SVGElement || /^(img|video|audio|canvas|iframe|embed|object|input|textarea|select|button|meter|progress)$/.test(el.localName),
    svg: el.namespaceURI === 'http://www.w3.org/2000/svg',
    typed: { width: typed('width'), height: typed('height') },
    parent: parent ? describe(parent) : undefined,
    animating: el.getAnimations ? [...new Set(el.getAnimations().filter((a) => a.playState === 'running' && (!a.timeline || a.timeline === el.ownerDocument.timeline)).map((a) => a.transitionProperty || a.animationName || 'animation'))] : []
  };
  if (textFrom !== el) result.textHolder = tree.label(textFrom);
  const clipped = (n) => {
    const cs = tree.style(n);
    if (cs.overflowX !== 'visible' && n.scrollWidth > n.clientWidth + 1) return true;
    return cs.webkitLineClamp !== 'none' && cs.overflowY !== 'visible' && n.scrollHeight > n.clientHeight + 1;
  };
  if (textual && !textControl && (clipped(el) || (textFrom !== el && clipped(textFrom)))) result.truncated = true;
  if ((${FAMILY_LOADED_JS})(textFrom, tree, textOf(textFrom))) result.familyLoaded = true;
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
    result.rootFontSize = parseFloat(tree.style(el.ownerDocument.documentElement).fontSize) || 16;
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
      const inactive = (${INACTIVE_RULES_JS})(el, [why].concat(result.whyLonghands || []));
      if (inactive.length > 0) result.whyInactive = inactive;
    }
  }
  return Object.assign(result,
    (${PLACEMENT_JS})(el, tree),
    (${BACKGROUNDS_JS})(textual ? textFrom : el, tree, view),
    textual ? { paintRisks: (${PAINT_RISKS_JS})(textFrom, tree, holder ? holder.font : el) } : {},
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

/** Where a custom property is set, as {@link VARIABLE_SETTERS_JS} finds it */
export interface VariableSetter {
  /** Selector of the rule, or `@keyframes name` */
  selector: string;
  /** Value as written (`inherit`, `` for an empty one) */
  value: string;
  /** Set in a keyframe of this animation */
  keyframes?: string;
  /** The rule matches the element or an ancestor now (null: bdg cannot test its selector) */
  matches: boolean | null;
  /** The `@media` or `@supports` condition it is under that does not apply now */
  condition?: string;
}

/**
 * Page-side function run on the element (`this`): for each custom property
 * name, a rule in the page's stylesheets (same-origin, `@import`ed,
 * constructed and the element's shadow root's) that sets it, keyframes
 * included: the first one that matches the element or an ancestor now
 * (across shadow roots, so `:root` matches inside a component), else the
 * first that would match without its state (`.btn:hover` for this `.btn`),
 * else the first one, with the `@media`/`@supports` condition it is under
 * when that does not apply. At most 20000 rules are read; cross-origin sheets are
 * skipped.
 */
export const VARIABLE_SETTERS_JS = `function (names) {
  const el = this;
  const view = el.ownerDocument.defaultView;
  const matching = {};
  const related = {};
  const other = {};
  let budget = 20000;
  const closestAcross = (selector) => {
    for (let n = el; n; n = n.getRootNode().host || null) {
      if (n.closest(selector)) return true;
    }
    return false;
  };
  const matches = (selector) => {
    try { return closestAcross(selector); } catch (e) { return null; }
  };
  const stateless = (selector) => selector.replace(/:(focus-visible|focus-within|focus|hover|active|visited|checked|target|open)(?![\\w-])/g, '');
  const applies = (rule) => {
    if (rule.media && rule.media.mediaText && !view.matchMedia(rule.media.mediaText).matches) return '@media ' + rule.media.mediaText;
    if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule && !CSS.supports(rule.conditionText)) return '@supports ' + rule.conditionText;
    return null;
  };
  const record = (name, rule, keyframes, condition) => {
    const selector = keyframes ? '@keyframes ' + keyframes : rule.selectorText || '';
    const match = keyframes || condition ? false : matches(selector);
    const setter = Object.assign(
      { selector: selector, value: rule.style.getPropertyValue(name).trim(), matches: match },
      keyframes ? { keyframes: keyframes } : {},
      condition ? { condition: condition } : {}
    );
    if (match && !matching[name]) matching[name] = setter;
    else if (!match && !keyframes && !related[name] && matches(stateless(selector))) related[name] = setter;
    else if (!match && !other[name]) other[name] = setter;
  };
  const visit = (rules, keyframes, condition) => {
    for (const rule of Array.from(rules)) {
      if (budget-- <= 0 || names.every((name) => matching[name])) return;
      if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
        try { if (rule.styleSheet) visit(rule.styleSheet.cssRules, keyframes, condition); } catch (e) { continue; }
        continue;
      }
      if (typeof CSSKeyframesRule !== 'undefined' && rule instanceof CSSKeyframesRule) {
        visit(rule.cssRules, rule.name, condition);
        continue;
      }
      if (rule.style) {
        for (const name of names) {
          if (!matching[name] && Array.from(rule.style).includes(name)) record(name, rule, keyframes, condition);
        }
      }
      if (rule.cssRules) visit(rule.cssRules, keyframes, condition || applies(rule));
    }
  };
  const sheets = [];
  for (const scope of new Set([el.getRootNode(), el.ownerDocument])) {
    sheets.push(...Array.from(scope.styleSheets || []), ...Array.from(scope.adoptedStyleSheets || []));
  }
  for (const sheet of sheets) {
    try { visit(sheet.cssRules, null, null); } catch (e) { continue; }
  }
  return Object.assign({}, other, related, matching);
}`;
