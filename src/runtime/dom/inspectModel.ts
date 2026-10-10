/**
 * Assemble the `bdg dom inspect` result from what CDP and the page-side walk
 * read: the header (label, text, rect, what keeps it from being seen), then
 * the groups (or, with `--all`/`--props`, the property lists) and the child
 * tree. Pure: every input is plain data, so the rules are tested without a
 * browser.
 */

import type { ElementLayout } from '@/ipc/protocol/domTypes.js';
import type { InspectRect, InspectResult, InspectVisibility } from '@/ipc/protocol/inspectTypes.js';
import { labelClasses } from '@/runtime/dom/elementInfo.js';
import { allStyles } from '@/runtime/dom/inspectAllStyles.js';
import { buildBox, buildLayout, type StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import {
  buildEffects,
  buildFills,
  buildSvgPaint,
  buildFx,
  buildOutline,
  buildPseudo,
  buildRadius,
  buildState,
  buildStrokes,
  buildText,
  effectiveBackground,
  type PlatformFont,
  type PseudoSource,
} from '@/runtime/dom/inspectPaintModel.js';
import type { MatchedStyles } from '@/runtime/dom/inspectRules.js';
import type { RawInspect } from '@/runtime/dom/inspectScripts.js';
import { buildTree, rowText } from '@/runtime/dom/inspectTree.js';
import { hexColor, relativeLuminance } from '@/utils/color.js';
import { normalizeCssValue, round1 } from '@/utils/cssValues.js';

/** Classes shown in the label (the rest are counted) */
const LABEL_CLASSES = 2;

/** What one inspect read */
export interface InspectSources {
  raw: RawInspect;
  style: StyleMap;
  parentStyle?: StyleMap;
  /** Computed styles of the descendant that draws the text, when it is not the element */
  holderStyle?: StyleMap;
  pseudo: PseudoSource[];
  /** Platform fonts of the text (of the descendant that draws it, when there is one) */
  fonts: PlatformFont[];
  /** Border box size from `DOM.getBoxModel`; absent when the element has no box */
  size?: { w: number; h: number };
  /** The element as `dom layout` measures it */
  layout?: ElementLayout;
  colorScheme?: 'light' | 'dark';
  /** Matched rules for the cascade fields; `timeout`, `failed` or `skipped` when they were not read */
  matched?: MatchedStyles;
  /** `--rules` was asked for */
  rules?: boolean;
  /** `--why` property */
  why?: string;
  /** `--props` names, custom property patterns expanded (`--rules` covers only these) */
  props?: string[];
  /** `--no-hints` */
  hints?: false;
  /** The element hosts a closed shadow root */
  closedShadowRoot?: true;
}

/** What the command asked for */
export interface InspectRequest {
  selector: string;
  index: number;
  count: number;
  /** Tree rows shown at most */
  treeLimit: number;
  all?: boolean;
  /** `--props` values (from `selectedProps`) */
  propValues?: InspectResult['props'];
}

/**
 * The element's label: tag, id and the first classes ({@link isLabelClass}),
 * with a count of the rest.
 *
 * @param raw - Tag, id and classes
 * @returns e.g. `a.z-1.max-sm:hidden(+11)`, `input#user-name`
 */
export function elementLabel(raw: Pick<RawInspect, 'tag' | 'id' | 'classes'>): string {
  const { shown, more } = labelClasses(raw.classes, LABEL_CLASSES);
  const classes = shown.map((name) => `.${name}`).join('');
  return `${raw.tag}${raw.id ? `#${raw.id}` : ''}${classes}${more > 0 ? `(+${more})` : ''}`;
}

/**
 * Why the element cannot be seen, from `dom layout`'s measurements.
 *
 * @param layout - Layout measurements
 * @param rendered - The element has a box
 * @returns Visibility fields
 */
export function visibilityOf(
  layout: ElementLayout | undefined,
  rendered: boolean
): InspectVisibility {
  if (!rendered)
    return { notRendered: true, ...(layout?.hiddenReason && { hidden: layout.hiddenReason }) };
  if (!layout) return {};
  const hidden = layout.inViewport === 'hidden' ? layout.hiddenReason : layout.invisible;
  const offscreen = ['above', 'below', 'left', 'right'].includes(layout.inViewport)
    ? layout.inViewport
    : undefined;
  return {
    ...(hidden && { hidden }),
    ...(offscreen && { offscreen }),
    ...(layout.coveredBy && { coveredBy: layout.coveredBy }),
    ...(layout.coverTransparent && { coverTransparent: true }),
    ...(layout.masked && { masked: layout.masked }),
  };
}

/**
 * The header rectangle: border box size (and the box it covers on screen
 * when a transform turns it), and the page position, or the
 * viewport position of an element fixed to the viewport (it or a container
 * is `position: fixed`: its page position changes with the scroll).
 *
 * @param layout - Layout measurements
 * @param size - Border box size
 * @param style - Computed styles (transforms)
 * @returns Rectangle
 */
function headerRect(
  layout: ElementLayout,
  size: { w: number; h: number },
  style: StyleMap
): InspectRect {
  const { width, height } = layout.bounds;
  const transformed = ['transform', 'rotate', 'scale'].some(
    (name) => (style[name] ?? 'none') !== 'none'
  );
  const turned = transformed && (Math.abs(width - size.w) > 1 || Math.abs(height - size.h) > 1);
  const box = {
    w: round1(size.w),
    h: round1(size.h),
    ...(turned && { screen: { w: width, h: height } }),
  };
  return layout.fixed
    ? { x: layout.viewport.x, y: layout.viewport.y, ...box, in: 'viewport' }
    : { x: layout.bounds.x, y: layout.bounds.y, ...box };
}

/** Below this relative luminance a page background counts as dark */
const DARK_LUMINANCE = 0.18;

/**
 * Header fields: label, text, placeholder, context, rect, visibility and
 * the color scheme.
 *
 * @param sources - What was read
 * @param request - Selector, index and match count
 * @returns Header part of the result
 */
function header(sources: InspectSources, request: InspectRequest): InspectResult {
  const { raw, size, layout } = sources;
  const content = raw.textual && raw.content ? rowText(raw.content) : undefined;
  return {
    success: true,
    selector: request.selector,
    count: request.count,
    index: request.index,
    element: elementLabel(raw),
    ...(content && { content }),
    ...(raw.placeholder && { placeholder: rowText(raw.placeholder) }),
    ...(raw.context && { context: raw.context }),
    ...(size && layout && { rect: headerRect(layout, size, sources.style) }),
    visibility: visibilityOf(layout, size !== undefined),
    ...(sources.colorScheme && { colorScheme: sources.colorScheme }),
    ...(sources.colorScheme === 'dark' && pageLooksDark(raw) && { theme: 'dark' }),
    ...(raw.animating.length > 0 && { animating: raw.animating }),
  };
}

/**
 * Whether the page renders dark: a dark canvas (its color-scheme), or a dark
 * background on the page's root (the backgrounds of body and html).
 *
 * @param raw - Backgrounds from the element up to the root, and the canvas
 * @returns True for a dark page
 */
function pageLooksDark(raw: Pick<RawInspect, 'backgrounds' | 'canvasDark'>): boolean {
  if (raw.canvasDark) return true;
  const root = effectiveBackground(raw.backgrounds.slice(-2), false).color;
  return relativeLuminance(root) < DARK_LUMINANCE;
}

/**
 * The style groups: box, layout, text, fills, strokes, radius, outline,
 * effects, fx, state and pseudo-elements.
 *
 * @param sources - What was read
 * @returns Group fields
 */
function groups(sources: InspectSources): Partial<InspectResult> {
  const { style, parentStyle, raw } = sources;
  const text = buildText(
    { style, parentStyle, holderStyle: sources.holderStyle },
    raw,
    sources.fonts
  );
  const fills = buildFills(style);
  const paint = buildSvgPaint(style, raw);
  const strokes = buildStrokes(style);
  const radius = buildRadius(style);
  const outline = buildOutline(style);
  const effects = buildEffects(style);
  const fx = buildFx(style);
  const state = buildState(style, raw);
  const pseudo = buildPseudo(sources.pseudo, style, raw);
  const opacity = Number(style['opacity'] ?? 1);
  const blend = style['mix-blend-mode'];
  return {
    box: buildBox(style, raw),
    layout: buildLayout(style, parentStyle, raw),
    ...(text && { text }),
    ...(fills.length > 0 && { fills }),
    ...(paint && { paint }),
    ...(opacity !== 1 && { opacity }),
    ...(blend && blend !== 'normal' && { blend }),
    ...(strokes.length > 0 && { strokes }),
    ...(radius && { radius }),
    ...(outline && { outline }),
    ...(effects.length > 0 && { effects }),
    ...(fx && { fx }),
    ...(state && { state }),
    ...(pseudo && { pseudo }),
  };
}

/**
 * The child tree fields.
 *
 * @param raw - Page-side walk
 * @param limit - Rows shown at most
 * @returns Children, hidden count and rows left out
 */
function treeFields(raw: RawInspect, limit: number): Partial<InspectResult> {
  if (!raw.tree) return {};
  const { children, moreRows } = buildTree(raw.tree, limit, raw.treeSkipped);
  return {
    ...(children.length > 0 && { children }),
    ...(raw.hiddenChildren > 0 && { hiddenChildren: raw.hiddenChildren }),
    ...(moreRows > 0 && { moreRows }),
  };
}

/**
 * The `--all` list: the element's own non-default longhands, plus its
 * generated pseudo-elements' content and the placeholder color.
 *
 * @param sources - What was read
 * @returns Properties and values
 */
function allFields(sources: InspectSources): Record<string, string> {
  const all = allStyles(sources.style, sources.raw.svg === true, sources.raw.formControl);
  for (const pseudo of sources.pseudo) {
    const content = pseudo.style['content'];
    if (content && content !== 'none' && content !== 'normal') {
      all[`${pseudo.type}`] = normalizeCssValue(content);
    }
  }
  if (sources.raw.placeholderColor)
    all['::placeholder'] = `color ${hexColor(sources.raw.placeholderColor)}`;
  return all;
}

/**
 * The `bdg dom inspect` result.
 *
 * @param sources - What CDP and the page-side walk read
 * @param request - Selector, index, match count and options
 * @returns Inspect result
 */
export function buildInspectResult(
  sources: InspectSources,
  request: InspectRequest
): InspectResult {
  const result = header(sources, request);
  if (request.propValues) return { ...result, props: request.propValues };
  const body = request.all ? { all: allFields(sources) } : groups(sources);
  return {
    ...result,
    ...body,
    ...treeFields(sources.raw, request.treeLimit),
    ...(sources.closedShadowRoot && { shadowRootMode: 'closed' as const }),
  };
}
