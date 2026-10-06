/**
 * `bdg dom inspect --all` and `--props`.
 *
 * `--all` lists every computed longhand that is not noise and not its
 * default, collapsed into shorthands (margin, padding, inset, border,
 * radius, overflow, gap, flex, grid area, outline, animation). Defaults are
 * the CSS initial values as Chrome computes them; the UA stylesheet's
 * per-tag values (a `<p>`'s margins, a button's padding) are real values and
 * are listed. Display, font, size, line height and color are always listed.
 *
 * Noise: custom properties, logical duplicates of physical properties,
 * width/height (in the header), transitions, origins without a transform,
 * colors that only repeat `color` (currentColor), properties of borders,
 * outlines and rules that are not drawn, SVG paint properties on HTML
 * elements, and vendor-prefixed internals.
 */

import type { InspectProp } from '@/ipc/protocol/inspectTypes.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import { hexColorsIn } from '@/utils/color.js';
import {
  normalizeCssValue,
  readableTransform,
  shortUrls,
  sidesShorthand,
} from '@/utils/cssValues.js';

/** CSS initial values as Chrome computes them, by value */
const INITIAL_BY_VALUE: ReadonlyArray<readonly [string, string]> = [
  [
    'auto',
    'accent-color align-self animation-timeline aspect-ratio background-size bottom break-after break-before break-inside caret-animation caret-shape clip column-count column-height column-width column-wrap cursor flex-basis font-kerning font-optical-sizing font-synthesis-small-caps font-synthesis-style font-synthesis-weight forced-color-adjust grid-auto-columns grid-auto-rows grid-column-end grid-column-start grid-row-end grid-row-start hyphenate-character hyphenate-limit-chars image-rendering interactivity isolation justify-self left line-break mask-size offset-anchor overflow-anchor overscroll-behavior-x overscroll-behavior-y pointer-events quotes right ruby-overhang scroll-behavior scroll-padding-bottom scroll-padding-left scroll-padding-right scroll-padding-top scrollbar-color scrollbar-gutter scrollbar-width table-layout text-align-last text-box-edge text-decoration-skip-ink text-decoration-thickness text-justify text-rendering text-size-adjust text-underline-offset text-underline-position text-wrap-style top touch-action user-select view-timeline-inset will-change z-index',
  ],
  [
    'none',
    'anchor-name anchor-scope animation-fill-mode animation-name animation-trigger app-region appearance backdrop-filter background-image border-bottom-style border-image-source border-left-style border-right-style border-shape border-top-style box-shadow clear clip-path column-rule-style column-span contain contain-intrinsic-height contain-intrinsic-size contain-intrinsic-width container-name counter-increment counter-reset counter-set filter float font-size-adjust grid-template-areas grid-template-columns grid-template-rows list-style-image mask-image max-height max-width object-view-box offset-path outline-style overlay perspective position-area position-try-fallbacks resize rotate row-rule-style scale scroll-initial-target scroll-marker-group scroll-snap-align scroll-snap-type scroll-target-group scroll-timeline-name shape-outside text-box-trim text-combine-upright text-decoration text-decoration-line text-emphasis-style text-fit text-shadow text-transform timeline-scope transform translate trigger-scope view-timeline-name view-transition-class view-transition-name view-transition-scope window-drag -webkit-line-clamp -webkit-text-security',
  ],
  [
    'normal',
    'align-content align-items animation-direction animation-range-end animation-range-start background-blend-mode color-scheme column-gap container-type content font-feature-settings font-language-override font-palette font-style font-variant font-variant-alternates font-variant-caps font-variant-east-asian font-variant-emoji font-variant-ligatures font-variant-numeric font-variant-position font-variation-settings initial-letter interest-delay-end interest-delay-start justify-content justify-items letter-spacing line-height math-shift math-style mix-blend-mode offset-position overflow-wrap position-anchor position-try-order reading-flow row-gap scroll-snap-stop speak text-spacing-trim view-transition-group word-break',
  ],
  [
    '0px',
    'border-bottom-left-radius border-bottom-right-radius border-bottom-width border-left-width border-right-width border-top-left-radius border-top-right-radius border-top-width margin-bottom margin-left margin-right margin-top min-height min-width offset-distance outline-offset overflow-clip-margin padding-bottom padding-left padding-right padding-top scroll-margin-bottom scroll-margin-left scroll-margin-right scroll-margin-top shape-margin text-indent word-spacing -webkit-text-stroke-width',
  ],
  ['1', 'animation-iteration-count border-image-width flex-line-count flex-shrink opacity zoom'],
  ['0', 'border-image-outset flex-grow math-depth order reading-order shape-image-threshold'],
  ['visible', 'backface-visibility content-visibility overflow-x overflow-y visibility'],
  [
    'superellipse(1)',
    'corner-bottom-left-shape corner-bottom-right-shape corner-top-left-shape corner-top-right-shape',
  ],
  ['border-box', 'background-clip mask-clip mask-origin'],
  ['3px', 'column-rule-width outline-width row-rule-width'],
  ['block', 'scroll-timeline-axis view-timeline-axis'],
  ['0s', 'animation-delay animation-duration'],
  ['0% 0%', 'background-position mask-position'],
  ['repeat', 'background-repeat mask-repeat'],
  ['100%', 'border-image-slice font-stretch'],
  ['row', 'flex-direction grid-auto-flow'],
  ['0%', 'background-position-x background-position-y mask-position-x mask-position-y'],
  ['2', 'orphans widows'],
  ['over', 'ruby-position text-emphasis-position'],
  ['start', 'text-align'],
  ['replace', 'animation-composition'],
  ['running', 'animation-play-state'],
  ['ease', 'animation-timing-function'],
  ['scroll', 'background-attachment'],
  ['rgba(0, 0, 0, 0)', 'background-color'],
  ['padding-box', 'background-origin'],
  ['separate', 'border-collapse'],
  ['stretch', 'border-image-repeat'],
  ['slice', 'box-decoration-break'],
  ['content-box', 'box-sizing'],
  ['top', 'caption-side'],
  ['balance', 'column-fill'],
  ['ltr', 'direction'],
  ['no-limit', 'dynamic-range-limit'],
  ['show', 'empty-cells'],
  ['fixed', 'field-sizing'],
  ['nowrap', 'flex-wrap'],
  ['manual', 'hyphens'],
  ['from-image', 'image-orientation'],
  ['numeric-only', 'interpolate-size'],
  ['outside', 'list-style-position'],
  ['disc', 'list-style-type'],
  ['add', 'mask-composite'],
  ['match-source', 'mask-mode'],
  ['luminance', 'mask-type'],
  ['fill', 'object-fit'],
  ['50% 50%', 'object-position'],
  ['auto 0deg', 'offset-rotate'],
  ['static', 'position'],
  ['anchors-visible', 'position-visibility'],
  ['economy', 'print-color-adjust'],
  ['space-around', 'ruby-align'],
  ['row-over-column', 'rule-overlap'],
  ['8', 'tab-size'],
  ['no-autospace', 'text-autospace'],
  ['solid', 'text-decoration-style'],
  ['mixed', 'text-orientation'],
  ['clip', 'text-overflow'],
  ['wrap', 'text-wrap-mode'],
  ['view-box', 'transform-box'],
  ['flat', 'transform-style'],
  ['baseline', 'vertical-align'],
  ['collapse', 'white-space-collapse'],
  ['horizontal-tb', 'writing-mode'],
  ['isolate', 'unicode-bidi'],
];

/** Initial value per property ({@link INITIAL_BY_VALUE}) */
const INITIAL_VALUES: ReadonlyMap<string, string> = new Map(
  INITIAL_BY_VALUE.flatMap(([value, names]) =>
    names.split(' ').map((name) => [name, value] as const)
  )
);

/** Defaults Chrome computes differently for some elements or versions */
const ALSO_DEFAULT: Readonly<Record<string, readonly string[]>> = {
  'unicode-bidi': ['normal'],
  'text-align': ['left', '-webkit-auto'],
  cursor: ['default'],
};

/**
 * Values that are the default of properties the table does not know (new or
 * experimental ones Chrome adds, e.g. `timeline-trigger-*`): their initial
 * value is one of these keywords
 */
const GENERIC_DEFAULTS = new Set(['', 'auto', 'none', 'normal', '0px', '0']);

/** Always listed, also with their default value */
const CORE = new Set([
  'display',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'color',
]);

/** Noise by name */
const NOISE = new Set([
  'width',
  'height',
  'x',
  'y',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'perspective-origin',
  'transform-origin',
  'caret-color',
  'flex-line-count',
  'speak',
]);

/** Logical duplicates of physical properties */
const LOGICAL =
  /((^|-)block(-|$)|(^|-)inline(-|$)|^inset-|-start-start|-start-end|-end-end|-end-start)/;

/** Vendor-prefixed properties worth listing */
const PREFIXED_KEPT = new Set([
  '-webkit-line-clamp',
  '-webkit-text-stroke-width',
  '-webkit-text-security',
]);

/** SVG paint and geometry properties (noise on HTML elements) */
const SVG_ONLY =
  /^(fill|fill-opacity|fill-rule|stroke|stroke-.*|stop-.*|flood-.*|lighting-color|marker-.*|clip-rule|color-interpolation.*|color-rendering|shape-rendering|text-anchor|dominant-baseline|alignment-baseline|baseline-shift|vector-effect|buffered-rendering|paint-order|mask-type)$/;

/** Colors that repeat `color` when not set otherwise */
const CURRENT_COLOR_ECHOES =
  /^(border-(top|right|bottom|left)-color|outline-color|column-rule-color|row-rule-color|text-decoration-color|text-emphasis-color|-webkit-text-fill-color|-webkit-text-stroke-color)$/;

/**
 * Whether a property is noise for `--all`.
 *
 * @param name - Property name
 * @param style - All computed styles (for the conditions)
 * @param svg - The element is an SVG element
 * @returns True when it is left out
 */
function isNoise(name: string, style: StyleMap, svg: boolean): boolean {
  if (name.startsWith('--') || NOISE.has(name) || name.startsWith('transition')) return true;
  if (LOGICAL.test(name) && !name.endsWith('-axis')) return true;
  if (name.startsWith('-webkit-') && !PREFIXED_KEPT.has(name)) return true;
  if (!svg && SVG_ONLY.test(name)) return true;
  if (CURRENT_COLOR_ECHOES.test(name) && style[name] === style['color']) return true;
  const side = /^border-(top|right|bottom|left)-(color|style|width)$/.exec(name)?.[1];
  if (side && ['none', 'hidden'].includes(style[`border-${side}-style`] ?? 'none')) return true;
  const drawn = /^(outline|column-rule|row-rule)-/.exec(name)?.[1];
  return drawn !== undefined && name !== `${drawn}-style` && style[`${drawn}-style`] === 'none';
}

/**
 * Whether a computed value is its property's default.
 *
 * @param name - Property name
 * @param value - Computed value
 * @returns True for the initial value (or an equivalent), an empty value, and
 *   a generic default keyword for a property the table does not know
 */
export function isDefaultValue(name: string, value: string): boolean {
  if (CORE.has(name)) return false;
  if (value === '') return true;
  const initial = INITIAL_VALUES.get(name);
  if (initial === undefined) return GENERIC_DEFAULTS.has(value);
  return initial === value || (ALSO_DEFAULT[name]?.includes(value) ?? false);
}

/**
 * A computed value normalized: px as numbers, colors as hex, URLs as file
 * names, matrices as transforms.
 *
 * @param name - Property name
 * @param value - Computed value
 * @returns Normalized value
 */
export function normalizeProperty(name: string, value: string): string {
  if (name === 'transform') return readableTransform(value);
  return normalizeCssValue(shortUrls(hexColorsIn(value)));
}

/** Longhands collapsed into a shorthand: the shorthand and how to write it */
interface Collapse {
  shorthand: string;
  longhands: readonly string[];
  write: (values: string[]) => string;
}

const sideNames = (pattern: string): string[] =>
  ['top', 'right', 'bottom', 'left'].map((side) => pattern.replace('{side}', side));

const COLLAPSES: readonly Collapse[] = [
  { shorthand: 'margin', longhands: sideNames('margin-{side}'), write: sidesShorthand },
  { shorthand: 'padding', longhands: sideNames('padding-{side}'), write: sidesShorthand },
  { shorthand: 'inset', longhands: sideNames('{side}'), write: sidesShorthand },
  {
    shorthand: 'scroll-margin',
    longhands: sideNames('scroll-margin-{side}'),
    write: sidesShorthand,
  },
  {
    shorthand: 'scroll-padding',
    longhands: sideNames('scroll-padding-{side}'),
    write: sidesShorthand,
  },
  {
    shorthand: 'border-radius',
    longhands: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
      (c) => `border-${c}-radius`
    ),
    write: sidesShorthand,
  },
  {
    shorthand: 'overflow',
    longhands: ['overflow-x', 'overflow-y'],
    write: ([x, y]) => (x === y ? `${x}` : `${x} ${y}`),
  },
  {
    shorthand: 'gap',
    longhands: ['row-gap', 'column-gap'],
    write: ([row, column]) => (row === column ? `${row}` : `${row} ${column}`),
  },
  {
    shorthand: 'flex',
    longhands: ['flex-grow', 'flex-shrink', 'flex-basis'],
    write: (v) => v.join(' '),
  },
  {
    shorthand: 'grid-area',
    longhands: ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
    write: (v) => v.join(' / '),
  },
  {
    shorthand: 'outline',
    longhands: ['outline-width', 'outline-style', 'outline-color', 'outline-offset'],
    write: ([width, style, color, offset]) =>
      `${width} ${style} ${color}${offset === '0' ? '' : ` offset ${offset}`}`,
  },
  {
    shorthand: 'animation',
    longhands: [
      'animation-name',
      'animation-duration',
      'animation-timing-function',
      'animation-delay',
      'animation-iteration-count',
      'animation-direction',
      'animation-fill-mode',
    ],
    write: (v) => v.join(' '),
  },
];

/**
 * Border longhands collapsed: one `border` when the four drawn sides are
 * equal, else one entry per drawn side.
 *
 * @param style - All computed styles
 * @returns Collapsed entries
 */
function collapseBorders(style: StyleMap): Array<[string, string]> {
  const sides = ['top', 'right', 'bottom', 'left'].filter(
    (side) => !['none', 'hidden'].includes(style[`border-${side}-style`] ?? 'none')
  );
  const write = (side: string): string =>
    ['width', 'style', 'color']
      .map((part) =>
        normalizeProperty(`border-${side}-${part}`, style[`border-${side}-${part}`] ?? '')
      )
      .join(' ');
  const lines = sides.map((side) => [`border-${side}`, write(side)] as [string, string]);
  const first = lines[0]?.[1];
  if (lines.length === 4 && lines.every(([, line]) => line === first))
    return [['border', first ?? '']];
  return lines;
}

/**
 * Replace collapsible longhands with their shorthands, each at the place of
 * its first longhand.
 *
 * @param kept - Listed longhands with normalized values, in computed order
 * @param style - All computed styles (values of the longhands that are defaults)
 * @returns Listed properties
 */
function collapse(kept: Map<string, string>, style: StyleMap): Record<string, string> {
  const result: Array<[string, string]> = [];
  const done = new Set<string>();
  const borderPart = /^border-(top|right|bottom|left)-(width|style|color)$/;
  for (const [name, value] of kept) {
    if (done.has(name)) continue;
    if (borderPart.test(name)) {
      for (const key of kept.keys()) if (borderPart.test(key)) done.add(key);
      result.push(...collapseBorders(style));
      continue;
    }
    const group = COLLAPSES.find((entry) => entry.longhands.includes(name));
    if (!group) {
      result.push([name, value]);
      continue;
    }
    group.longhands.forEach((longhand) => done.add(longhand));
    const values = group.longhands.map(
      (longhand) => kept.get(longhand) ?? normalizeProperty(longhand, style[longhand] ?? '')
    );
    result.push([group.shorthand, group.write(values)]);
  }
  return Object.fromEntries(result);
}

/**
 * Every computed longhand that is not noise and not a default, normalized
 * and collapsed into shorthands.
 *
 * @param style - Computed styles
 * @param svg - The element is an SVG element (SVG properties are listed)
 * @returns Properties and values
 */
export function allStyles(style: StyleMap, svg: boolean): Record<string, string> {
  const kept = new Map<string, string>();
  const transformed = (style['transform'] ?? 'none') !== 'none';
  for (const [name, value] of Object.entries(style)) {
    if (name === 'transform-origin' && transformed) {
      kept.set(name, normalizeProperty(name, value));
      continue;
    }
    if (isNoise(name, style, svg) || isDefaultValue(name, value)) continue;
    kept.set(name, normalizeProperty(name, value));
  }
  return collapse(kept, style);
}

/**
 * The properties asked for with `--props`, raw and normalized. CDP's
 * computed longhands come first; shorthands and custom properties come from
 * the page (`getComputedStyle`).
 *
 * @param names - Property names, lowercase
 * @param style - Computed longhands (CDP)
 * @param pageValues - Values the page read
 * @returns Values by name, and the names no value was found for
 */
export function selectedProps(
  names: readonly string[],
  style: StyleMap,
  pageValues: Record<string, string> | undefined
): { props: Record<string, InspectProp>; unknown: string[] } {
  const props: Record<string, InspectProp> = {};
  const unknown: string[] = [];
  for (const name of names) {
    const computed = style[name] ?? pageValues?.[name] ?? '';
    if (computed === '' && !(name in style)) unknown.push(name);
    else props[name] = { computed, value: normalizeProperty(name, computed) };
  }
  return { props, unknown };
}
