/**
 * Normalization of computed CSS values for `bdg dom inspect`: px as numbers
 * rounded to one decimal (no unit), colors as hex, 1-4 value shorthands,
 * shadow layers, grid tracks with `repeat()`, transforms decomposed from the
 * matrices Chrome computes, and the first font family.
 */

import { hexColor, hexColorsIn } from '@/utils/color.js';

/** A length: px as a number, anything else (`auto`, `50%`, `10px 20px`) as text */
export type CssLength = number | string;

/** px lengths inside a value */
const PX_IN_VALUE = /(-?\d*\.?\d+(?:e-?\d+)?)px\b/g;

/**
 * Round to one decimal (and drop `-0`).
 *
 * @param value - Number
 * @returns e.g. 12.5, 0
 */
export function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * A px value as a number.
 *
 * @param value - Computed value, e.g. `12.5px`
 * @returns Rounded number, or undefined when the value is not a single px length
 */
export function pxNumber(value: string | undefined): number | undefined {
  const match = /^(-?\d*\.?\d+(?:e-?\d+)?)px$/.exec((value ?? '').trim());
  return match ? round1(Number(match[1])) : undefined;
}

/**
 * A length as {@link CssLength}.
 *
 * @param value - Computed value
 * @returns Number for px, else the value as text
 */
export function cssLength(value: string | undefined): CssLength {
  return pxNumber(value) ?? normalizeCssValue(value ?? '');
}

/**
 * A computed value with px lengths as rounded unitless numbers and colors as
 * hex, e.g. `rgba(0, 0, 0, 0.2) 0px 1.25px 2px` → `#00000033 0 1.3 2`.
 *
 * @param value - Computed value
 * @returns Normalized value
 */
export function normalizeCssValue(value: string): string {
  return hexColorsIn(value)
    .replace(PX_IN_VALUE, (_match, number: string) => String(round1(Number(number))))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1-4 values the way CSS shorthands write them (top, right, bottom, left).
 *
 * @param sides - Top, right, bottom, left
 * @returns e.g. `10`, `10 0`, `10 0 1`, `1 2 3 4`
 */
export function sidesShorthand(sides: readonly CssLength[]): string {
  const [top, right, bottom, left] = sides.map(String);
  if (top === right && right === bottom && bottom === left) return `${top}`;
  if (top === bottom && right === left) return `${top} ${right}`;
  if (right === left) return `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/**
 * Split a value at commas (or another separator) outside parentheses.
 *
 * @param value - e.g. `rgb(0, 0, 0) 0px 1px, rgb(1, 1, 1) 0px 2px`
 * @param separator - Character to split at
 * @returns Parts, trimmed
 */
export function splitTopLevel(value: string, separator = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * The first family of a `font-family` list, without quotes.
 *
 * @param fontFamily - e.g. `"DM Sans", Arial, sans-serif`
 * @returns e.g. `DM Sans`
 */
export function firstFontFamily(fontFamily: string): string {
  const first = splitTopLevel(fontFamily)[0] ?? '';
  return first.replace(/^["']|["']$/g, '');
}

/** One layer of a `box-shadow` or `text-shadow` */
export interface ShadowLayer {
  x: number;
  y: number;
  blur: number;
  /** Not for text shadows */
  spread: number;
  color: string;
  inset: boolean;
}

/**
 * Parse one shadow layer as Chrome computes it (`<color> <x> <y> <blur> [<spread>] [inset]`).
 *
 * @param layer - e.g. `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px`
 * @returns The layer, or undefined when it does not parse
 */
function parseShadowLayer(layer: string): ShadowLayer | undefined {
  const color = /^((?:rgba?|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}|[a-z]+)\s+/i.exec(
    layer
  );
  const rest = (color ? layer.slice(color[0].length) : layer).split(/\s+/);
  const lengths = rest.map(pxNumber).filter((n): n is number => n !== undefined);
  if (lengths.length < 2) return undefined;
  return {
    x: lengths[0] ?? 0,
    y: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color: hexColor(color?.[1] ?? 'currentcolor'),
    inset: rest.includes('inset'),
  };
}

/**
 * The visible layers of a shadow: transparent layers and layers with no
 * offset, blur or spread (Tailwind's ring placeholders) are left out.
 *
 * @param value - Computed `box-shadow` or `text-shadow`
 * @returns Layers, outermost first
 */
export function parseShadows(value: string): ShadowLayer[] {
  if (!value || value === 'none') return [];
  return splitTopLevel(value)
    .map(parseShadowLayer)
    .filter((layer): layer is ShadowLayer => layer !== undefined)
    .filter(
      (layer) =>
        layer.color !== 'transparent' &&
        (layer.x !== 0 || layer.y !== 0 || layer.blur !== 0 || layer.spread !== 0)
    );
}

/**
 * A shadow layer as text, e.g. `#00000033 0 1 2 0`, `inset #000 0 0 0 1`.
 *
 * @param layer - Shadow layer
 * @param withSpread - Include the spread (box shadows)
 * @returns Text
 */
export function shadowText(layer: ShadowLayer, withSpread = true): string {
  const lengths = [layer.x, layer.y, layer.blur, ...(withSpread ? [layer.spread] : [])];
  return `${layer.inset ? 'inset ' : ''}${layer.color} ${lengths.join(' ')}`;
}

/**
 * Grid tracks with runs of equal sizes written as `repeat()`.
 *
 * @param value - Computed `grid-template-columns`/`rows`, e.g. `100px 100px 100px 50px`
 * @returns e.g. `repeat(3,100) 50`; `none` stays `none`
 */
export function compressTracks(value: string): string {
  if (!value || value === 'none') return value;
  const tracks = splitTopLevel(value, ' ').map((token) => normalizeCssValue(token));
  const parts: string[] = [];
  for (let i = 0; i < tracks.length;) {
    let run = 1;
    while (tracks[i + run] === tracks[i]) run++;
    parts.push(run > 1 ? `repeat(${run},${tracks[i]})` : `${tracks[i]}`);
    i += run;
  }
  return parts.join(' ');
}

/**
 * Round a number for a transform (3 decimals at most).
 *
 * @param value - Number
 * @returns Rounded number
 */
function round3(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * A 2D matrix as translate/rotate/scale when it is one (no skew).
 *
 * @param m - a, b, c, d, e, f
 * @returns e.g. `translate(10,20) rotate(45deg)`, or undefined for a skew
 */
function decomposeMatrix([a = 1, b = 0, c = 0, d = 1, e = 0, f = 0]: number[]): string | undefined {
  if (Math.abs(a * c + b * d) > 1e-6) return undefined;
  const scaleX = Math.hypot(a, b);
  const scaleY = scaleX === 0 ? 0 : (a * d - b * c) / scaleX;
  const angle = round3((Math.atan2(b, a) * 180) / Math.PI);
  const parts: string[] = [];
  if (e !== 0 || f !== 0) parts.push(`translate(${round1(e)},${round1(f)})`);
  if (angle !== 0) parts.push(`rotate(${angle}deg)`);
  const [sx, sy] = [round3(scaleX), round3(scaleY)];
  if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${sx})` : `scale(${sx},${sy})`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

/**
 * A computed transform in readable form: a 2D matrix as
 * translate/rotate/scale, other matrices with rounded numbers.
 *
 * @param value - Computed `transform`, e.g. `matrix(1, 0, 0, 1, 10, 20)`
 * @returns e.g. `translate(10,20)`; `none` when it does nothing
 */
export function readableTransform(value: string): string {
  const match = /^(matrix|matrix3d)\((.*)\)$/.exec(value.trim());
  if (!match) return normalizeCssValue(value);
  const numbers = (match[2] ?? '').split(',').map((n) => Number(n.trim()));
  const decomposed = match[1] === 'matrix' ? decomposeMatrix(numbers) : undefined;
  return decomposed ?? `${match[1]}(${numbers.map(round3).join(',')})`;
}

/**
 * The file name of a URL in a CSS value: `url("https://x.com/a/b.png?v=1")` → `url(b.png)`;
 * `data:` URLs become `url(data:…)`.
 *
 * @param value - Computed value with `url()`s
 * @returns The value with short URLs
 */
export function shortUrls(value: string): string {
  return value.replace(/url\((["']?)(.*?)\1\)/g, (_match, _quote, url: string) => {
    if (url.startsWith('data:')) return 'url(data:…)';
    const name = url.split(/[?#]/)[0]?.split('/').filter(Boolean).pop() ?? url;
    return `url(${name})`;
  });
}
