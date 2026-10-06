/**
 * What `bdg dom inspect` returns: one element's look as a designer reads it,
 * in a schema aligned with Figma's concepts (rect, box, layout with
 * hug/fill/fixed sizing, text, fills, strokes, radius, effects, children), so
 * it can be compared key by key with a design. Lengths are CSS px as numbers
 * (one decimal); other units stay text. Colors are hex (`#rrggbbaa` when
 * translucent).
 */

import type { ContrastLevel } from '@/utils/color.js';
import type { CssLength } from '@/utils/cssValues.js';

/** Border box: page coordinates (iframe offsets and page scroll included) and size */
export interface InspectRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sides top, right, bottom, left */
export type Sides = [CssLength, CssLength, CssLength, CssLength];

/** How a box gets its size along an axis, as Figma's auto layout names it */
export type SizingMode = 'fixed' | 'hug' | 'fill';

/** Padding, margin, border widths and the constraints on the box */
export interface InspectBox {
  padding: Sides;
  margin: Sides;
  border: Sides;
  sizing: string;
  min?: { w?: CssLength; h?: CssLength };
  max?: { w?: CssLength; h?: CssLength };
  /** `overflow` when not visible, e.g. `hidden` or `hidden auto` (x y) */
  overflow?: string;
  /** Size of the content when it overflows the box by more than 1px */
  scroll?: { w: number; h: number };
}

/** Flex or grid container properties */
export interface InspectContainer {
  direction?: string;
  wrap?: string;
  justify?: string;
  align?: string;
  /** Row and column gap (one number when equal) */
  gap?: CssLength | [CssLength, CssLength];
  columns?: string;
  rows?: string;
}

/** The parent that lays the element out (display: contents wrappers skipped) */
export interface InspectParent extends InspectContainer {
  element: string;
  display: string;
  textAlign?: string;
}

/** Gaps to the previous and next rendered in-flow siblings, by the side each is on */
export interface InspectSiblings {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** Display, position and the layout the element takes part in */
export interface InspectLayout extends InspectContainer {
  display: string;
  position?: string;
  inset?: Sides;
  z?: CssLength;
  float?: string;
  valign?: string;
  /** As a flex item: grow shrink basis */
  flex?: string;
  self?: string;
  order?: number;
  /** As a grid item: row-start / column-start / row-end / column-end */
  area?: string;
  sizing?: { w: SizingMode; h: SizingMode };
  parent?: InspectParent;
  /** Distances from the parent's content box edges */
  inParent?: { left: number; top: number; right: number; bottom: number };
  siblings?: InspectSiblings;
}

/** Contrast of the text with what is behind it */
export interface InspectContrast {
  ratio: number;
  level: ContrastLevel;
  /** Effective background (ancestor backgrounds composited) */
  background: string;
  /** The background was taken from an ancestor (or the page canvas) */
  inherited?: boolean;
  /** A background image or gradient is behind the text: the ratio uses the colors only */
  overImage?: boolean;
  /**
   * Opacity of the element and its ancestors (below 1): the text color is
   * faded by it before the ratio is taken (backgrounds inside the faded
   * subtree are not, so the ratio is approximate)
   */
  opacity?: number;
}

/** Typography (for containers without text of their own: only what differs from the parent) */
export interface InspectText {
  family?: string;
  /** Font Chrome rendered the text with, when it is not the first family */
  rendered?: string;
  /** The rendered font is a web font */
  webfont?: boolean;
  weight?: number;
  style?: string;
  size?: number;
  lineHeight?: CssLength;
  color?: string;
  contrast?: InspectContrast;
  align?: string;
  transform?: string;
  tracking?: CssLength;
  decoration?: string;
  whiteSpace?: string;
  overflow?: string;
  clamp?: string;
  shadow?: string;
  features?: string;
}

/** A background layer */
export type InspectFill =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; value: string }
  | { type: 'image'; value: string; size?: string };

/** A border side (or all four) */
export interface InspectStroke {
  side: 'all' | 'top' | 'right' | 'bottom' | 'left';
  width: number;
  style: string;
  color: string;
}

/** A shadow layer */
export interface InspectEffect {
  type: 'shadow' | 'inner-shadow';
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

/** Visual effects other than shadows */
export interface InspectFx {
  transform?: string;
  filter?: string;
  backdrop?: string;
  clip?: string;
  mask?: string;
  animation?: string;
}

/** Interaction state set by CSS */
export interface InspectState {
  cursor?: string;
  pointerEvents?: string;
  visibility?: string;
  userSelect?: string;
  appearance?: string;
}

/** A generated pseudo-element (`::before`, `::after`) or the placeholder */
export interface InspectPseudo {
  type: '::before' | '::after' | '::placeholder';
  content?: string;
  display?: string;
  position?: string;
  size?: { w: number; h: number };
  color?: string;
  fills?: InspectFill[];
  radius?: string;
  effects?: InspectEffect[];
  transform?: string;
  opacity?: number;
  /** `::placeholder`: contrast of the placeholder text with the field's background */
  contrast?: InspectContrast;
}

/** A row of the child tree; identical siblings are one row with a count */
export interface InspectTreeNode {
  /** `tag.firstClass` */
  element: string;
  w: number;
  h: number;
  /** `flex` or `grid` container */
  layout?: 'flex' | 'grid';
  text?: string;
  /** Identical siblings this row stands for (2 or more) */
  count?: number;
  children?: InspectTreeNode[];
  /** Rendered element children (at the depth limit, where they are not listed) */
  childCount?: number;
  /** Children that are not rendered (not listed) */
  hiddenChildren?: number;
}

/** Why the element cannot be seen, or where it is when it is out of view */
export interface InspectVisibility {
  /** No box: `display: none` on it or an ancestor, or not in the page's layout */
  notRendered?: true;
  /** Rendered but not seen, e.g. `visibility: hidden`, `zero size` */
  hidden?: string;
  /** Out of the viewport: `above`, `below`, `left` or `right` */
  offscreen?: string;
  /** Topmost element at the center of its visible part, when another one */
  coveredBy?: string;
  /** The cover paints nothing there: the element shows, but clicks land on the cover */
  coverTransparent?: true;
}

/** A property asked for with `--props` */
export interface InspectProp {
  /** Computed value as Chrome reports it */
  computed: string;
  /** Normalized: px as numbers, colors as hex */
  value: string;
}

/** `bdg dom inspect` result */
export interface InspectResult {
  success: true;
  /** Selector the element was found with (for an index: the cached query's) */
  selector: string;
  /** Elements the selector matched */
  count: number;
  /** Which match was inspected (0-based) */
  index: number;
  /**
   * How the match was chosen when no index was given and several matched:
   * the first rendered one (`first-visible`, when earlier ones are not
   * rendered) or the first
   */
  picked?: 'first-visible' | 'first';
  /** `tag#id.c1.c2(+N)` */
  element: string;
  /** Its text (innerText) or form value, at most 30 characters; not for containers */
  content?: string;
  /** Placeholder of an empty field */
  placeholder?: string;
  /** Enclosing iframe(s) and shadow root */
  context?: string;
  /** Absent when not rendered */
  rect?: InspectRect;
  visibility: InspectVisibility;
  /**
   * `dark` when the page renders a dark theme (dark canvas or dark page
   * background) while the session prefers dark; colors are then the dark
   * theme's
   */
  theme?: 'dark';
  /** `prefers-color-scheme` the page sees */
  colorScheme?: 'light' | 'dark';
  box?: InspectBox;
  layout?: InspectLayout;
  text?: InspectText;
  fills?: InspectFill[];
  opacity?: number;
  blend?: string;
  strokes?: InspectStroke[];
  /** Corner radii top-left, top-right, bottom-right, bottom-left */
  radius?: Sides;
  outline?: { width: number; style: string; color: string; offset?: number };
  effects?: InspectEffect[];
  fx?: InspectFx;
  state?: InspectState;
  pseudo?: InspectPseudo[];
  children?: InspectTreeNode[];
  /** Children not rendered (not listed) */
  hiddenChildren?: number;
  /** Tree rows left out beyond `--tree-limit` */
  moreRows?: number;
  /** `--all`: every longhand that is not a no-op default, collapsed into shorthands */
  all?: Record<string, string>;
  /** `--props`: the properties asked for */
  props?: Record<string, InspectProp>;
}
