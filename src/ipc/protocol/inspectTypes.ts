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
  /** `viewport`: x and y are in the viewport (a fixed element stays there however the page scrolls) */
  in?: 'viewport';
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
   * Opacity of the element and its ancestors (below 1): each translucent
   * element fades its background and the text over it before the ratio is
   * taken
   */
  opacity?: number;
  /**
   * Why the ratio is approximate: `mix-blend-mode hard-light on h1`,
   * `filter on div.skin-invert`, `canvas behind`, `div.overlay on top`
   */
  approximate?: string[];
}

/** Typography (for containers without text of their own: only what differs from the parent) */
export interface InspectText {
  /**
   * Label of the descendant that draws most of the text when it is not the
   * element (`abbr`, `slot.button__label`): the fields describe its text
   */
  holder?: string;
  family?: string;
  /** Font Chrome rendered the text with, when it is a fallback for the first family */
  rendered?: string;
  /** Font a generic first family (`sans-serif`, `system-ui`) resolved to */
  resolved?: string;
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
  /** `::placeholder`: font style and weight, when not the field's */
  fontStyle?: string;
  fontWeight?: number;
  /** `::placeholder`: contrast of the placeholder text with the field's background */
  contrast?: InspectContrast;
}

/** A row of the child tree; identical siblings are one row with a count */
export interface InspectTreeNode {
  /** `tag.firstClass` */
  element: string;
  /** Position relative to the parent's border box (like Figma's x/y in a frame; a group's first member) */
  x: number;
  y: number;
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

/** A declaration that has no effect, and why */
export interface InspectHint {
  /** `inactive` (has no effect), `unset-variable` (var() of an unset custom property), `not-inherited` (a form control in the browser's font) */
  kind: 'inactive' | 'unset-variable' | 'not-inherited';
  /** Property as written */
  property: string;
  value: string;
  /** e.g. `display is block` */
  reason: string;
  /** e.g. `use display: flex or grid on this element` */
  fix: string;
  /** e.g. `.hero (app.css:12)` */
  source: string;
}

/** Which declaration sets a property */
export interface InspectRule {
  /** Longhand, or the shorthand when one declaration sets all its sides */
  property: string;
  /** Value as written (custom properties visible) */
  value: string;
  /** Computed value, normalized (px as numbers, colors as hex), when the written one has `var()` */
  computed?: string;
  /** e.g. `.btn-primary (bootstrap.min.css:5:52628)`, `style attribute` */
  source: string;
  /** The rule as written (selector and declarations); a rule over 300 characters is cut to its selector and this declaration */
  rule?: string;
  /** Selectors of the declarations it beats */
  overrides?: string[];
  /** Set on an ancestor this many levels up (inherited) */
  inherited?: number;
  important?: true;
  layer?: string;
  /** Media or container condition of the rule */
  condition?: string;
}

/** One declaration in the cascade of a property (`--why`) */
export interface InspectWhyEntry {
  /** Value as written (a shorthand's whole value) */
  value: string;
  /** Shorthand or logical property it was written as */
  via?: string;
  /** The value with its custom properties substituted, when it has `var()` */
  resolved?: string;
  /** Custom properties it uses that are not set (the declaration is then invalid) */
  unset?: string[];
  source: string;
  /** Specificity of the rule's selector (ids, classes, types) */
  specificity?: [number, number, number];
  /** The rule as written (selector and declarations); a rule over 300 characters is cut to its selector and this declaration */
  rule?: string;
  /** `applied` (wins), `overridden`, or `inherited` (from an ancestor: the winner, or one it beat there) */
  status: 'applied' | 'overridden' | 'inherited';
  important?: true;
  layer?: string;
  condition?: string;
}

/** `--why`: every declaration of one property, winner first */
export interface InspectWhy {
  property: string;
  /** Computed value, normalized (px as numbers, colors as hex) */
  computed: string;
  chain: InspectWhyEntry[];
  /** Where the custom properties of the winning value are set */
  variables?: InspectVariable[];
}

/** A custom property a winning value uses, and where it is set */
export interface InspectVariable {
  name: string;
  value: string;
  source: string;
  /** Set on an ancestor this many levels up */
  inherited?: number;
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
  /**
   * Running CSS transitions (their property) and animations (their name):
   * the values read are mid-way and will still change
   */
  animating?: string[];
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
  /** Declarations that have no effect (checked by default; empty when none) */
  hints?: InspectHint[];
  /** `--rules`: the declaration that sets each shown property */
  rules?: InspectRule[];
  /** `--why <property>`: one entry, or one per longhand of a shorthand whose sides differ */
  why?: InspectWhy[];
  /** The cascade was not read: Chrome took longer than the time allowed, or failed */
  cascade?: 'timeout' | 'failed';
}
