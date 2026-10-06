/**
 * Box and layout groups of `bdg dom inspect`, from computed styles.
 *
 * Core facts are always there (display, padding/margin/border as computed,
 * even when they equal the UA default); the rest only when it applies
 * (container fields for flex and grid containers, item fields in a flex or
 * grid parent) and is not a no-op default. Sizing is named like Figma's
 * auto layout: hug (sized by the content), fill (stretched by the parent)
 * or fixed, from the computed (not resolved) width and height.
 */

import type {
  InspectBox,
  InspectContainer,
  InspectLayout,
  InspectParent,
  Sides,
  SizingMode,
} from '@/ipc/protocol/inspectTypes.js';
import type { RawInspect } from '@/runtime/dom/inspectScripts.js';
import { compressTracks, cssLength, round1, type CssLength } from '@/utils/cssValues.js';

/** Computed styles by property name */
export type StyleMap = Record<string, string>;

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/**
 * The four sides of a box property.
 *
 * @param style - Computed styles
 * @param name - e.g. `padding-{side}`, `border-{side}-width`
 * @returns Top, right, bottom, left
 */
export function sides(style: StyleMap, name: string): Sides {
  return SIDES.map((side) => cssLength(style[name.replace('{side}', side)])) as Sides;
}

/**
 * Whether a computed value is a no-op for a size limit.
 *
 * @param value - Computed min/max width or height
 * @returns True for `auto`, `none` and 0
 */
function noLimit(value: string | undefined): boolean {
  return value === undefined || value === 'auto' || value === 'none' || value === '0px';
}

/**
 * Min or max sizes that constrain the box.
 *
 * @param style - Computed styles
 * @param kind - `min` or `max`
 * @returns Width and height limits, or undefined when there are none
 */
function sizeLimits(style: StyleMap, kind: 'min' | 'max'): InspectBox['min'] {
  const w = style[`${kind}-width`];
  const h = style[`${kind}-height`];
  const limits = {
    ...(!noLimit(w) && { w: cssLength(w) }),
    ...(!noLimit(h) && { h: cssLength(h) }),
  };
  return Object.keys(limits).length > 0 ? limits : undefined;
}

/**
 * The box group: padding, margin, border widths, box-sizing, size limits,
 * overflow and the content size when it overflows.
 *
 * @param style - Computed styles
 * @param raw - Page-side measurements
 * @returns Box group
 */
export function buildBox(style: StyleMap, raw: Pick<RawInspect, 'scroll'>): InspectBox {
  const overflowX = style['overflow-x'] ?? 'visible';
  const overflowY = style['overflow-y'] ?? 'visible';
  const overflow =
    overflowX === 'visible' && overflowY === 'visible'
      ? undefined
      : overflowX === overflowY
        ? overflowX
        : `${overflowX} ${overflowY}`;
  const min = sizeLimits(style, 'min');
  const max = sizeLimits(style, 'max');
  return {
    padding: sides(style, 'padding-{side}'),
    margin: sides(style, 'margin-{side}'),
    border: sides(style, 'border-{side}-width'),
    sizing: style['box-sizing'] ?? 'content-box',
    ...(min && { min }),
    ...(max && { max }),
    ...(overflow && { overflow }),
    ...(raw.scroll && { scroll: { w: raw.scroll.w, h: raw.scroll.h } }),
  };
}

/**
 * Row and column gap, when there is one.
 *
 * @param style - Computed styles
 * @returns One length when both are equal, else row and column
 */
function gapOf(style: StyleMap): InspectContainer['gap'] {
  const toLength = (value: string | undefined): CssLength =>
    value === undefined || value === 'normal' ? 0 : cssLength(value);
  const row = toLength(style['row-gap']);
  const column = toLength(style['column-gap']);
  if (row === 0 && column === 0) return undefined;
  return row === column ? row : [row, column];
}

/**
 * Whether a display value makes a flex or grid container.
 *
 * @param display - Computed display
 * @returns `flex`, `grid` or undefined
 */
export function containerKind(display: string | undefined): 'flex' | 'grid' | undefined {
  if (display === undefined) return undefined;
  if (/(^|-)flex$/.test(display) || display === '-webkit-box') return 'flex';
  return /(^|-)grid$/.test(display) ? 'grid' : undefined;
}

/**
 * Flex or grid container fields that are not no-op defaults (the flex
 * direction is always there).
 *
 * @param style - Computed styles
 * @returns Container fields, empty for other displays
 */
export function buildContainer(style: StyleMap): InspectContainer {
  const kind = containerKind(style['display']);
  if (!kind) return {};
  const justify = style['justify-content'];
  const align = style['align-items'];
  const wrap = style['flex-wrap'];
  const gap = gapOf(style);
  const columns = style['grid-template-columns'] ?? 'none';
  const rows = style['grid-template-rows'] ?? 'none';
  return {
    ...(kind === 'flex' && { direction: style['flex-direction'] ?? 'row' }),
    ...(kind === 'flex' && wrap && wrap !== 'nowrap' && { wrap }),
    ...(kind === 'grid' && columns !== 'none' && { columns: compressTracks(columns) }),
    ...(kind === 'grid' && rows !== 'none' && { rows: compressTracks(rows) }),
    ...(justify && !['normal', 'flex-start', 'start'].includes(justify) && { justify }),
    ...(align && !['normal', 'stretch'].includes(align) && { align }),
    ...(gap !== undefined && { gap }),
  };
}

/**
 * Position fields: position unless static, inset unless all `auto` (or all
 * 0/auto for relative), z-index unless `auto`.
 *
 * @param style - Computed styles
 * @returns Position fields
 */
function positionFields(style: StyleMap): Partial<InspectLayout> {
  const position = style['position'] ?? 'static';
  if (position === 'static') return {};
  const inset = sides(style, '{side}');
  const allAuto = inset.every((value) => value === 'auto');
  const noOffset = inset.every((value) => value === 'auto' || value === 0);
  const z = style['z-index'];
  return {
    position,
    ...(!allAuto && !(position === 'relative' && noOffset) && { inset }),
    ...(z && z !== 'auto' && { z: /^-?\d+$/.test(z) ? Number(z) : z }),
  };
}

/**
 * Fields of an element laid out by a flex or grid parent: flex
 * grow/shrink/basis (unless `0 1 auto`), self alignment, order and grid area.
 *
 * @param style - Computed styles
 * @param parentDisplay - Display of the layout parent
 * @returns Item fields, empty in other parents
 */
function itemFields(style: StyleMap, parentDisplay: string | undefined): Partial<InspectLayout> {
  const parentKind = containerKind(parentDisplay);
  if (!parentKind) return {};
  const flex = `${style['flex-grow'] ?? 0} ${style['flex-shrink'] ?? 1} ${cssLength(style['flex-basis'] ?? 'auto')}`;
  const self = style['align-self'];
  const justifySelf = style['justify-self'];
  const order = Number(style['order'] ?? 0);
  const placement = ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'].map(
    (name) => style[name] ?? 'auto'
  );
  const selfAlign = [self, parentKind === 'grid' ? justifySelf : undefined]
    .filter((value) => value && value !== 'auto')
    .join(' ');
  return {
    ...(parentKind === 'flex' && flex !== '0 1 auto' && { flex }),
    ...(selfAlign && { self: selfAlign }),
    ...(order !== 0 && { order }),
    ...(parentKind === 'grid' &&
      placement.some((value) => value !== 'auto') && { area: placement.join(' / ') }),
  };
}

/**
 * The parent line: its description, display, container fields and its
 * text alignment (when not the start).
 *
 * @param parentStyle - Computed styles of the layout parent
 * @param element - Its short description
 * @returns Parent fields
 */
function buildParent(parentStyle: StyleMap, element: string): InspectParent {
  const textAlign = parentStyle['text-align'];
  return {
    element,
    display: parentStyle['display'] ?? 'block',
    ...buildContainer(parentStyle),
    ...(textAlign && !['start', 'left', '-webkit-auto'].includes(textAlign) && { textAlign }),
  };
}

/** Inputs to {@link deriveSizing} */
export interface SizingInput {
  /** Computed (not resolved) size: `auto`, `200px`, `100%`, `fit-content`, … */
  size: string;
  axis: 'w' | 'h';
  display: string;
  position: string;
  float: string;
  flexGrow: number;
  flexBasis: string;
  alignSelf: string;
  justifySelf: string;
  parentDisplay?: string;
  parentDirection?: string;
  parentAlignItems?: string;
  parentJustifyItems?: string;
  /** A replaced element (img, video, canvas, iframe, form control…): sized by its intrinsic content */
  replaced?: boolean;
}

/**
 * Whether an item stretches along the cross axis of its flex or grid parent.
 *
 * @param self - The item's `align-self`/`justify-self`
 * @param items - The parent's `align-items`/`justify-items`
 * @returns True for `stretch` and `normal` (stretch for non-replaced items)
 */
function stretches(self: string, items: string | undefined): boolean {
  const effective = self === 'auto' ? (items ?? 'normal') : self;
  return effective === 'normal' || effective === 'stretch';
}

/**
 * How the element is sized along an axis inside a flex parent.
 *
 * @param input - Sizing inputs
 * @param automatic - The size is `auto` (or content-based)
 * @returns Sizing mode
 */
function flexItemSizing(input: SizingInput, automatic: boolean): SizingMode {
  const mainAxis = (input.parentDirection ?? 'row').startsWith('row') ? 'w' : 'h';
  if (input.axis === mainAxis) {
    if (input.flexGrow > 0) return 'fill';
    if (!['auto', 'content'].includes(input.flexBasis)) return 'fixed';
    return automatic ? 'hug' : 'fixed';
  }
  if (automatic && input.size === 'auto' && stretches(input.alignSelf, input.parentAlignItems)) {
    return 'fill';
  }
  return automatic ? 'hug' : input.size === '100%' ? 'fill' : 'fixed';
}

/**
 * Sizing of a replaced element with an automatic size: its intrinsic size
 * (hug), unless it grows along a flex main axis or is stretched explicitly
 * (`normal` alignment does not stretch replaced elements).
 *
 * @param input - Computed size, display and the parent's layout
 * @returns Sizing mode
 */
function replacedSizing(input: SizingInput): SizingMode {
  const kind = containerKind(input.parentDisplay);
  const mainAxis = (input.parentDirection ?? 'row').startsWith('row') ? 'w' : 'h';
  if (kind === 'flex' && input.axis === mainAxis && input.flexGrow > 0) return 'fill';
  const self = input.axis === 'w' && kind === 'grid' ? input.justifySelf : input.alignSelf;
  return kind && self === 'stretch' ? 'fill' : 'hug';
}

/**
 * How the element is sized along an axis: `fill` when its parent stretches
 * it (a flex item that grows, a stretched cross axis or grid cell, a block's
 * width in normal flow, 100%), `hug` when its content sizes it (`auto` and
 * the content keywords elsewhere), `fixed` for a length.
 *
 * @param input - Computed size, display and the parent's layout
 * @returns Sizing mode
 */
export function deriveSizing(input: SizingInput): SizingMode {
  const automatic =
    /^(auto|fit-content|max-content|min-content)$/.test(input.size) || input.size === '';
  if (input.display === 'inline') return 'hug';
  if (input.replaced && automatic) return replacedSizing(input);
  if (input.position === 'absolute' || input.position === 'fixed')
    return automatic ? 'hug' : 'fixed';
  const parentKind = containerKind(input.parentDisplay);
  if (parentKind === 'flex') return flexItemSizing(input, automatic);
  if (parentKind === 'grid' && input.size === 'auto') {
    const fills =
      input.axis === 'w'
        ? stretches(input.justifySelf, input.parentJustifyItems)
        : stretches(input.alignSelf, input.parentAlignItems);
    return fills ? 'fill' : 'hug';
  }
  if (input.size === '100%') return 'fill';
  if (!automatic) return 'fixed';
  const blockLevel = !/^inline|^table$/.test(input.display) && input.float === 'none';
  return input.axis === 'w' && input.size === 'auto' && blockLevel ? 'fill' : 'hug';
}

/**
 * Sizing along both axes.
 *
 * @param style - Computed styles
 * @param parentStyle - Computed styles of the layout parent
 * @param raw - Computed (not resolved) width and height, and whether the element is replaced
 * @returns Width and height sizing
 */
function sizingOf(
  style: StyleMap,
  parentStyle: StyleMap | undefined,
  raw: Pick<RawInspect, 'typed' | 'replaced'>
): { w: SizingMode; h: SizingMode } {
  const typed = raw.typed;
  const base = {
    ...(raw.replaced && { replaced: true }),
    display: style['display'] ?? 'inline',
    position: style['position'] ?? 'static',
    float: style['float'] ?? 'none',
    flexGrow: Number(style['flex-grow'] ?? 0),
    flexBasis: style['flex-basis'] ?? 'auto',
    alignSelf: style['align-self'] ?? 'auto',
    justifySelf: style['justify-self'] ?? 'auto',
    ...(parentStyle && {
      parentDisplay: parentStyle['display'] ?? 'block',
      parentDirection: parentStyle['flex-direction'] ?? 'row',
      parentAlignItems: parentStyle['align-items'] ?? 'normal',
      parentJustifyItems: parentStyle['justify-items'] ?? 'normal',
    }),
  };
  return {
    w: deriveSizing({ ...base, size: typed.width, axis: 'w' }),
    h: deriveSizing({ ...base, size: typed.height, axis: 'h' }),
  };
}

/**
 * Round each value of a record of distances.
 *
 * @param distances - Distances in CSS px
 * @returns Rounded distances
 */
function rounded<T extends Record<string, number>>(distances: T): T {
  return Object.fromEntries(
    Object.entries(distances).map(([key, value]) => [key, round1(value)])
  ) as T;
}

/**
 * The layout group: display, position, container and item fields, valign
 * for inline displays, float, sizing, and the parent with the element's
 * place in it (offsets from its content edges, gaps to the siblings).
 *
 * @param style - Computed styles
 * @param parentStyle - Computed styles of the layout parent (none for the root)
 * @param raw - Page-side measurements
 * @returns Layout group
 */
export function buildLayout(
  style: StyleMap,
  parentStyle: StyleMap | undefined,
  raw: Pick<RawInspect, 'typed' | 'replaced' | 'parent' | 'inParent' | 'siblings'>
): InspectLayout {
  const display = style['display'] ?? 'inline';
  const valign = style['vertical-align'];
  const float = style['float'];
  const siblings = raw.siblings && Object.keys(raw.siblings).length > 0 ? raw.siblings : undefined;
  return {
    display,
    ...positionFields(style),
    ...buildContainer(style),
    ...itemFields(style, parentStyle?.['display']),
    ...(/^inline|table-cell/.test(display) && valign && valign !== 'baseline' && { valign }),
    ...(float && float !== 'none' && { float }),
    ...(display !== 'none' && { sizing: sizingOf(style, parentStyle, raw) }),
    ...(parentStyle && raw.parent && { parent: buildParent(parentStyle, raw.parent) }),
    ...(raw.inParent && { inParent: rounded(raw.inParent) }),
    ...(siblings && { siblings: rounded(siblings) }),
  };
}
