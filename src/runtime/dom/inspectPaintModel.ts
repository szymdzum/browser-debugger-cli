/**
 * Text, fill, border, effect, state and pseudo-element groups of
 * `bdg dom inspect`, from computed styles. No-op defaults (transparent,
 * none, 0, normal, 1) are left out, colors are hex and shadows drop
 * invisible layers. The text group shows the font Chrome rendered the text
 * with and the WCAG contrast against the background behind the text (the
 * backgrounds of the element and its ancestors composited over the page
 * canvas).
 */

import type {
  InspectContrast,
  InspectEffect,
  InspectFill,
  InspectFx,
  InspectPseudo,
  InspectState,
  InspectStroke,
  InspectText,
  Sides,
} from '@/ipc/protocol/inspectTypes.js';
import type { StyleMap } from '@/runtime/dom/inspectLayoutModel.js';
import type { RawBackground, RawInspect } from '@/runtime/dom/inspectScripts.js';
import {
  composite,
  contrastLevel,
  contrastRatio,
  hexColor,
  parseColor,
  toHex,
  type Rgba,
} from '@/utils/color.js';
import {
  cssLength,
  firstFontFamily,
  normalizeCssValue,
  parseShadows,
  pxNumber,
  readableTransform,
  shadowText,
  shortUrls,
  splitTopLevel,
} from '@/utils/cssValues.js';

/** A font Chrome used for the text (`CSS.getPlatformFontsForNode`) */
export interface PlatformFont {
  familyName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

/** Background images and gradients are shown at most this long */
const IMAGE_TEXT_LENGTH = 140;

/** Page canvas colors (light and dark color-scheme) */
const CANVAS: Record<'light' | 'dark', Rgba> = {
  light: { r: 1, g: 1, b: 1, a: 1 },
  dark: { r: 0x12 / 255, g: 0x12 / 255, b: 0x12 / 255, a: 1 },
};

/** CSS generic font families: the browser picks a font for them */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  '-apple-system',
  'blinkmacsystemfont',
]);

/**
 * The font the text was rendered with and whether it is a web font. For a
 * generic first family, the font it resolved to (`resolved`). Otherwise
 * `rendered` only when it is a fallback: not a face of the first family
 * (`DM Sans 9pt` is a face of `DM Sans`, `Liberation Sans` is not one of
 * `Arial`), and the first family is not a web font the page loaded (whose
 * file may give any internal name: `Copyright Klim Type Foundry`, or the
 * local font a `src: local()` points at). Names that are not readable
 * (sites that scramble a web font's internal name) are left out.
 *
 * @param family - First family of `font-family`
 * @param fonts - Platform fonts of the text
 * @param familyLoaded - The first family is a loaded web font
 * @returns `rendered`, `resolved` and `webfont` fields
 */
export function renderedFont(
  family: string,
  fonts: readonly PlatformFont[],
  familyLoaded = false
): Pick<InspectText, 'rendered' | 'resolved' | 'webfont'> {
  const primary = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0];
  if (!primary) return {};
  const webfont = primary.isCustomFont ? { webfont: true as const } : {};
  const readable = /^[\p{L}\p{N}.][\p{L}\p{N} ._'-]+$/u.test(primary.familyName);
  if (!readable || familyLoaded) return webfont;
  if (GENERIC_FAMILIES.has(family.toLowerCase())) {
    return { resolved: primary.familyName, ...webfont };
  }
  const differs = !primary.familyName.toLowerCase().startsWith(family.toLowerCase());
  return { ...(differs && { rendered: primary.familyName }), ...webfont };
}

/** Fully transparent */
const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Paint the text color and the background behind it the way the browser
 * composites them: from the element up to the root, each element's content
 * over its own background, the result faded by its opacity (a translucent
 * ancestor fades its background along with the text), then over the page
 * canvas.
 *
 * @param text - Text color (undefined: the background alone)
 * @param backgrounds - Backgrounds with their opacity, the element's own first
 * @param canvasDark - The page canvas is dark
 * @returns The text pixel, the background pixel and whether a background
 *   image or gradient was in the way
 */
function paintOver(
  text: Rgba | undefined,
  backgrounds: readonly RawBackground[],
  canvasDark: boolean
): { text: Rgba; background: Rgba; overImage: boolean } {
  let withText = text ?? CLEAR;
  let without = CLEAR;
  let overImage = false;
  for (const layer of backgrounds) {
    if (layer.image && without.a < 0.999) overImage = true;
    const color = parseColor(layer.color);
    if (color && color.a > 0) {
      withText = composite(withText, color);
      without = composite(without, color);
    }
    const opacity = layer.opacity ?? 1;
    withText = { ...withText, a: withText.a * opacity };
    without = { ...without, a: without.a * opacity };
  }
  const canvas = CANVAS[canvasDark ? 'dark' : 'light'];
  return {
    text: composite(withText, canvas),
    background: composite(without, canvas),
    overImage,
  };
}

/**
 * The background behind the element's text: its own and its ancestors'
 * backgrounds composited with their opacity over the page canvas.
 *
 * @param backgrounds - Backgrounds, the element's own first
 * @param canvasDark - The page canvas is dark
 * @returns Opaque background, whether it came from an ancestor and whether an image was in the way
 */
export function effectiveBackground(
  backgrounds: readonly RawBackground[],
  canvasDark: boolean
): { color: Rgba; inherited: boolean; overImage: boolean } {
  const painted = paintOver(undefined, backgrounds, canvasDark);
  const own = parseColor(backgrounds[0]?.color ?? '');
  return {
    color: painted.background,
    inherited: !own || own.a < 0.999,
    overImage: painted.overImage,
  };
}

/**
 * Contrast of the text color with the background behind it, both painted
 * as the browser composites them ({@link paintOver}), with what makes the
 * number approximate (blend modes, filters, content behind or on top).
 *
 * @param style - Computed styles (color, font size and weight)
 * @param raw - Backgrounds, the page canvas, opacity and paint risks
 * @returns Ratio (rounded down to 2 decimals), level and background
 */
export function textContrast(
  style: StyleMap,
  raw: Pick<RawInspect, 'backgrounds' | 'canvasDark' | 'opacity' | 'paintRisks'>
): InspectContrast | undefined {
  const color = parseColor(style['color'] ?? '');
  if (!color) return undefined;
  const opacity = raw.opacity ?? 1;
  const painted = paintOver(color, raw.backgrounds, raw.canvasDark);
  const ratio = Math.floor(contrastRatio(painted.text, painted.background) * 100) / 100;
  const size = pxNumber(style['font-size']) ?? 16;
  const weight = Number(style['font-weight'] ?? 400);
  const own = parseColor(raw.backgrounds[0]?.color ?? '');
  const approximate = raw.paintRisks ?? [];
  return {
    ratio,
    level: contrastLevel(ratio, size, weight),
    background: toHex(painted.background),
    ...((!own || own.a < 0.999) && { inherited: true }),
    ...(painted.overImage && { overImage: true }),
    ...(opacity < 1 && { opacity: Math.round(opacity * 100) / 100 }),
    ...(approximate.length > 0 && { approximate }),
  };
}

/**
 * White-space handling as the `white-space` keyword.
 *
 * @param style - Computed styles
 * @returns e.g. `nowrap`, `pre-wrap`; undefined for `normal`
 */
function whiteSpaceOf(style: StyleMap): string | undefined {
  const collapse = style['white-space-collapse'] ?? 'collapse';
  const wrap = (style['text-wrap-mode'] ?? 'wrap') === 'wrap';
  if (collapse === 'collapse') return wrap ? undefined : 'nowrap';
  if (collapse === 'preserve') return wrap ? 'pre-wrap' : 'pre';
  if (collapse === 'preserve-breaks') return wrap ? 'pre-line' : collapse;
  return collapse;
}

/**
 * Text decoration: the lines, with a style other than solid and a color
 * other than the text color.
 *
 * @param style - Computed styles
 * @returns e.g. `underline dotted #f00`; undefined without lines
 */
function decorationOf(style: StyleMap): string | undefined {
  const line = style['text-decoration-line'];
  if (!line || line === 'none') return undefined;
  const decorationStyle = style['text-decoration-style'];
  const color = style['text-decoration-color'];
  return [
    line,
    decorationStyle !== 'solid' && decorationStyle,
    color && color !== style['color'] && hexColor(color),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Text fields beyond font, size and color, when not their default.
 *
 * @param style - Computed styles
 * @returns Alignment, transform, tracking, decoration, white-space, overflow, clamp, shadow, features
 */
function textExtras(style: StyleMap): InspectText {
  const align = style['text-align'];
  const transform = style['text-transform'];
  const tracking = style['letter-spacing'];
  const overflow = style['text-overflow'];
  const clamp = style['-webkit-line-clamp'];
  const shadow = parseShadows(style['text-shadow'] ?? 'none').map((layer) =>
    shadowText(layer, false)
  );
  const features = style['font-feature-settings'];
  const decoration = decorationOf(style);
  const whiteSpace = whiteSpaceOf(style);
  return {
    ...(align && !['start', 'left', '-webkit-auto'].includes(align) && { align }),
    ...(transform && transform !== 'none' && { transform }),
    ...(tracking && tracking !== 'normal' && { tracking: cssLength(tracking) }),
    ...(decoration && { decoration }),
    ...(whiteSpace && { whiteSpace }),
    ...(overflow && overflow !== 'clip' && { overflow }),
    ...(clamp && clamp !== 'none' && { clamp }),
    ...(shadow.length > 0 && { shadow: shadow.join(', ') }),
    ...(features && features !== 'normal' && { features }),
  };
}

/**
 * Horizontal text alignment, the default (`start`, older `-webkit-auto`)
 * included, so "is it centered?" is answered without asking.
 *
 * @param style - Computed styles
 * @returns e.g. `start`, `center`, `right`
 */
function alignOf(style: StyleMap): string {
  const align = style['text-align'] ?? 'start';
  return align === '-webkit-auto' ? 'start' : align;
}

/**
 * Font, size and color fields.
 *
 * @param style - Computed styles
 * @returns Family, weight, style, size, line height and color
 */
function fontFields(style: StyleMap): InspectText {
  const fontStyle = style['font-style'];
  return {
    family: firstFontFamily(style['font-family'] ?? ''),
    weight: Number(style['font-weight'] ?? 400),
    ...(fontStyle && fontStyle !== 'normal' && { style: fontStyle }),
    size: pxNumber(style['font-size']) ?? 16,
    lineHeight: cssLength(style['line-height'] ?? 'normal'),
    color: hexColor(style['color'] ?? ''),
  };
}

/** Computed styles the text group reads */
export interface TextStyles {
  /** The element's */
  style: StyleMap;
  /** Its layout parent's */
  parentStyle?: StyleMap | undefined;
  /** The descendant's that draws most of its text, when it is not the element */
  holderStyle?: StyleMap | undefined;
}

/**
 * The text group. Elements with text (or text fields) get the full group,
 * read from whatever draws the text (the element, or the descendant with
 * most of it, named in `holder`): font with the rendered font, size, color,
 * alignment, contrast (not for text no one can see: not rendered,
 * `opacity: 0` on it or an ancestor, `visibility: hidden`) and the
 * non-default extras. Containers get only what differs from their parent,
 * with the font their text was rendered in when that text has the
 * container's family. Nothing for an element without text (an icon button,
 * a checkbox).
 *
 * @param styles - Computed styles of the element, its parent and its text holder
 * @param raw - Page-side measurements
 * @param fonts - Platform fonts of the text
 * @returns Text group, or undefined when there is nothing to say
 */
export function buildText(
  styles: TextStyles,
  raw: Pick<
    RawInspect,
    | 'textual'
    | 'textHolder'
    | 'rendered'
    | 'hasText'
    | 'familyLoaded'
    | 'backgrounds'
    | 'canvasDark'
    | 'opacity'
    | 'paintRisks'
  >,
  fonts: readonly PlatformFont[]
): InspectText | undefined {
  const { style, parentStyle, holderStyle } = styles;
  if (raw.textual) {
    const textStyle = raw.textHolder && holderStyle ? holderStyle : style;
    const fields = fontFields(textStyle);
    const seen =
      raw.rendered !== false && (raw.opacity ?? 1) > 0 && textStyle['visibility'] !== 'hidden';
    const contrast = seen ? textContrast(textStyle, raw) : undefined;
    return {
      ...(textStyle !== style && raw.textHolder && { holder: raw.textHolder }),
      ...fields,
      ...renderedFont(fields.family ?? '', fonts, raw.familyLoaded),
      ...(contrast && { contrast }),
      ...textExtras(textStyle),
      align: alignOf(textStyle),
    };
  }
  if (!parentStyle || raw.hasText === false) return undefined;
  const fields = fontFields(style);
  const parentFields = { ...fontFields(parentStyle), ...textExtras(parentStyle) };
  const own = { ...fields, ...textExtras(style) };
  const differing: InspectText = Object.fromEntries(
    Object.entries(own).filter(([key, value]) => parentFields[key as keyof InspectText] !== value)
  );
  if (Object.keys(differing).length === 0) return undefined;
  const sameFamily = !holderStyle || holderStyle['font-family'] === style['font-family'];
  return differing.family && sameFamily
    ? { ...differing, ...renderedFont(differing.family, fonts, raw.familyLoaded) }
    : differing;
}

/**
 * Cut a long value.
 *
 * @param text - Value
 * @returns At most {@link IMAGE_TEXT_LENGTH} characters
 */
function cut(text: string): string {
  return text.length > IMAGE_TEXT_LENGTH ? `${text.slice(0, IMAGE_TEXT_LENGTH)}…` : text;
}

/**
 * Background layers: images and gradients (top first), then the color.
 *
 * @param style - Computed styles
 * @returns Fills
 */
export function buildFills(style: StyleMap): InspectFill[] {
  const fills: InspectFill[] = [];
  const image = style['background-image'];
  const size = style['background-size'];
  if (image && image !== 'none') {
    for (const layer of splitTopLevel(image)) {
      const value = cut(normalizeCssValue(shortUrls(layer)));
      if (layer.includes('gradient(')) fills.push({ type: 'gradient', value });
      else
        fills.push({
          type: 'image',
          value,
          ...(size && size !== 'auto' && { size: normalizeCssValue(size) }),
        });
    }
  }
  const color = hexColor(style['background-color'] ?? 'transparent');
  if (color !== 'transparent') fills.push({ type: 'solid', color });
  return fills;
}

/**
 * Border sides that show (a style other than none/hidden and a width): one
 * `all` stroke when the four are equal.
 *
 * @param style - Computed styles
 * @returns Strokes
 */
export function buildStrokes(style: StyleMap): InspectStroke[] {
  const strokes = (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    side,
    width: pxNumber(style[`border-${side}-width`]) ?? 0,
    style: style[`border-${side}-style`] ?? 'none',
    color: hexColor(style[`border-${side}-color`] ?? ''),
  }));
  const shown = strokes.filter((s) => s.width > 0 && !['none', 'hidden'].includes(s.style));
  const [first] = shown;
  const same = (s: InspectStroke): boolean =>
    s.width === first?.width && s.style === first.style && s.color === first.color;
  if (first && shown.length === 4 && shown.every(same)) return [{ ...first, side: 'all' }];
  return shown;
}

/**
 * Corner radii, when any corner is rounded.
 *
 * @param style - Computed styles
 * @returns Top-left, top-right, bottom-right, bottom-left
 */
export function buildRadius(style: StyleMap): Sides | undefined {
  const radius = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) =>
    cssLength(style[`border-${corner}-radius`] ?? '0px')
  ) as Sides;
  return radius.every((value) => value === 0) ? undefined : radius;
}

/**
 * The outline, when it shows (a style, a width and a visible color).
 *
 * @param style - Computed styles
 * @returns Outline fields
 */
export function buildOutline(
  style: StyleMap
): { width: number; style: string; color: string; offset?: number } | undefined {
  const outlineStyle = style['outline-style'] ?? 'none';
  const width = pxNumber(style['outline-width']) ?? 0;
  const color = hexColor(style['outline-color'] ?? '');
  if (outlineStyle === 'none' || width === 0 || color === 'transparent') return undefined;
  const offset = pxNumber(style['outline-offset']) ?? 0;
  return { width, style: outlineStyle, color, ...(offset !== 0 && { offset }) };
}

/**
 * Box shadows as effects (invisible layers left out).
 *
 * @param style - Computed styles
 * @returns Effects
 */
export function buildEffects(style: StyleMap): InspectEffect[] {
  return parseShadows(style['box-shadow'] ?? 'none').map((layer) => ({
    type: layer.inset ? 'inner-shadow' : 'shadow',
    x: layer.x,
    y: layer.y,
    blur: layer.blur,
    spread: layer.spread,
    color: layer.color,
  }));
}

/**
 * The transform: the `transform` matrix in readable form and the
 * individual `translate`, `rotate` and `scale` properties.
 *
 * @param style - Computed styles
 * @returns e.g. `translate(10,20) rotate(45deg)`; undefined without one
 */
function transformOf(style: StyleMap): string | undefined {
  const parts = [
    style['transform'] && style['transform'] !== 'none' && readableTransform(style['transform']),
    ...(['translate', 'rotate', 'scale'] as const).map((name) => {
      const value = style[name];
      return value && value !== 'none' && `${name} ${normalizeCssValue(value)}`;
    }),
  ].filter((part): part is string => Boolean(part) && part !== 'none');
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/**
 * Effects other than shadows: transform, filter, backdrop filter, clip
 * path, mask and a running animation (never transitions).
 *
 * @param style - Computed styles
 * @returns Fx fields, or undefined when there are none
 */
export function buildFx(style: StyleMap): InspectFx | undefined {
  const set = (name: string): string => {
    const value = style[name];
    return value && value !== 'none' ? cut(normalizeCssValue(shortUrls(value))) : '';
  };
  const filter = set('filter');
  const backdrop = set('backdrop-filter');
  const clip = set('clip-path');
  const mask = set('mask-image');
  const animationName = style['animation-name'];
  const iterations = style['animation-iteration-count'];
  const animation =
    animationName && animationName !== 'none'
      ? [animationName, style['animation-duration'], iterations !== '1' && iterations]
          .filter(Boolean)
          .join(' ')
      : undefined;
  const transform = transformOf(style);
  const fx: InspectFx = {
    ...(transform && { transform }),
    ...(filter && { filter }),
    ...(backdrop && { backdrop }),
    ...(clip && { clip }),
    ...(mask && { mask }),
    ...(animation && { animation }),
  };
  return Object.keys(fx).length > 0 ? fx : undefined;
}

/**
 * Interaction state set by CSS: a cursor (other than the default, and the
 * pointer links get anyway), `pointer-events: none`, visibility,
 * `user-select: none` and `appearance: none` on form controls.
 *
 * @param style - Computed styles
 * @param raw - Tag and whether it is a form control
 * @returns State fields, or undefined when there are none
 */
export function buildState(
  style: StyleMap,
  raw: Pick<RawInspect, 'tag' | 'formControl'>
): InspectState | undefined {
  const cursor = style['cursor'];
  const linkPointer = raw.tag === 'a' && cursor === 'pointer';
  const state: InspectState = {
    ...(cursor && !['auto', 'default'].includes(cursor) && !linkPointer && { cursor }),
    ...(style['pointer-events'] === 'none' && { pointerEvents: 'none' }),
    ...(style['visibility'] &&
      style['visibility'] !== 'visible' && { visibility: style['visibility'] }),
    ...(style['user-select'] === 'none' && { userSelect: 'none' }),
    ...(raw.formControl && style['appearance'] === 'none' && { appearance: 'none' }),
  };
  return Object.keys(state).length > 0 ? state : undefined;
}

/** A generated pseudo-element as CDP reads it */
export interface PseudoSource {
  type: '::before' | '::after';
  style: StyleMap;
  /** Border box size, when it is rendered */
  size?: { w: number; h: number };
}

/**
 * A `::before`/`::after` pseudo-element whose `content` is set: its content,
 * display (unless inline), position, size, color (when not the host's),
 * background, radius, shadow, transform and opacity.
 *
 * @param pseudo - Pseudo-element styles and size
 * @param hostColor - Text color of the element
 * @returns Pseudo fields, or undefined when it generates nothing
 */
export function buildGeneratedPseudo(
  pseudo: PseudoSource,
  hostColor: string | undefined
): InspectPseudo | undefined {
  const { style } = pseudo;
  const content = style['content'];
  if (!content || content === 'none' || content === 'normal') return undefined;
  const display = style['display'];
  const position = style['position'];
  const radius = buildRadius(style);
  const effects = buildEffects(style);
  const fills = buildFills(style);
  const opacity = Number(style['opacity'] ?? 1);
  const transform = transformOf(style);
  return {
    type: pseudo.type,
    content: shortUrls(content),
    ...(display && display !== 'inline' && { display }),
    ...(position && position !== 'static' && { position }),
    ...(pseudo.size && { size: pseudo.size }),
    ...(style['color'] && style['color'] !== hostColor && { color: hexColor(style['color']) }),
    ...(fills.length > 0 && { fills }),
    ...(radius && { radius: radius.join(' ') }),
    ...(effects.length > 0 && { effects }),
    ...(transform && { transform }),
    ...(opacity !== 1 && { opacity }),
  };
}

/**
 * The pseudo group: generated `::before`/`::after` and the placeholder color.
 *
 * @param generated - Pseudo-elements CDP found
 * @param hostStyle - Computed styles of the element (text color, and the font
 *   size and weight the placeholder's contrast level depends on)
 * @param raw - Placeholder color of an empty field, and the backgrounds behind it
 * @returns Pseudo-elements, or undefined when there are none
 */
export function buildPseudo(
  generated: readonly PseudoSource[],
  hostStyle: StyleMap,
  raw: Pick<
    RawInspect,
    'placeholderColor' | 'placeholderFont' | 'backgrounds' | 'canvasDark' | 'opacity'
  >
): InspectPseudo[] | undefined {
  const pseudo = generated
    .map((source) => buildGeneratedPseudo(source, hostStyle['color']))
    .filter((entry): entry is InspectPseudo => entry !== undefined);
  if (raw.placeholderColor) {
    const font = raw.placeholderFont;
    const weight = font?.weight ?? hostStyle['font-weight'] ?? '400';
    const contrast = textContrast(
      { ...hostStyle, color: raw.placeholderColor, 'font-weight': weight },
      raw
    );
    pseudo.push({
      type: '::placeholder',
      color: hexColor(raw.placeholderColor),
      ...(font &&
        font.style !== (hostStyle['font-style'] ?? 'normal') && { fontStyle: font.style }),
      ...(weight !== (hostStyle['font-weight'] ?? '400') && { fontWeight: Number(weight) }),
      ...(contrast && { contrast }),
    });
  }
  return pseudo.length > 0 ? pseudo : undefined;
}
