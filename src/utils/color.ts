/**
 * CSS colors as `bdg dom inspect` reports them: parsed from the computed
 * values Chrome returns (`rgb()`/`rgba()`, and `lab()`, `lch()`, `oklab()`,
 * `oklch()` and `color()` as Tailwind v4 and other modern CSS leave them),
 * converted to sRGB the way Chrome paints them on an sRGB screen (channels
 * outside the gamut are clipped), and printed as short hex. Also the WCAG
 * contrast math over alpha-composited backgrounds.
 *
 * Conversions follow the CSS Color 4 sample code (Bradford D50 → D65, the
 * OKLab matrices of Björn Ottosson).
 */

/** A color in sRGB: channels 0-1 (unclipped until printed), alpha 0-1 */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

type Vector = [number, number, number];
type Matrix = [Vector, Vector, Vector];

const XYZ_D65_TO_LINEAR_SRGB: Matrix = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];

const D50_TO_D65: Matrix = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];

const LINEAR_P3_TO_XYZ_D65: Matrix = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];

const LINEAR_REC2020_TO_XYZ_D65: Matrix = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];

const LINEAR_A98_TO_XYZ_D65: Matrix = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];

const LINEAR_PROPHOTO_TO_XYZ_D50: Matrix = [
  [0.7977666449006423, 0.13518129740053308, 0.0313477341283922],
  [0.2880748288194013, 0.711835234241873, 0.00008993693872564],
  [0, 0, 0.8251046025104602],
];

/** D50 reference white (CSS Color 4) */
const D50_WHITE: Vector = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];

/**
 * Multiply a 3×3 matrix by a vector.
 *
 * @param m - Matrix
 * @param v - Vector
 * @returns Product
 */
function multiply(m: Matrix, v: Vector): Vector {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/**
 * Apply a transfer function to each channel, keeping the sign.
 *
 * @param v - Channels
 * @param fn - Transfer function for non-negative values
 * @returns Transformed channels
 */
function perChannel(v: Vector, fn: (x: number) => number): Vector {
  return v.map((x) => Math.sign(x) * fn(Math.abs(x))) as Vector;
}

/** sRGB (also Display P3) gamma-encoded → linear */
const srgbToLinear = (x: number): number =>
  x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;

/** Linear → sRGB gamma-encoded */
const linearToSrgb = (x: number): number =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;

/** Rec. 2020 gamma-encoded → linear */
const rec2020ToLinear = (x: number): number => {
  const alpha = 1.09929682680944;
  const beta = 0.018053968510807;
  return x < beta * 4.5 ? x / 4.5 : ((x + alpha - 1) / alpha) ** (1 / 0.45);
};

/** ProPhoto gamma-encoded → linear */
const prophotoToLinear = (x: number): number => (x <= 16 / 512 ? x / 16 : x ** 1.8);

/**
 * Gamma-encoded sRGB channels from XYZ (D65).
 *
 * @param xyz - XYZ relative to D65
 * @returns sRGB channels (unclipped)
 */
function xyzD65ToSrgb(xyz: Vector): Vector {
  return perChannel(multiply(XYZ_D65_TO_LINEAR_SRGB, xyz), linearToSrgb);
}

/**
 * XYZ (D50) from CIE Lab.
 *
 * @param lab - L (0-100), a, b
 * @returns XYZ relative to D50
 */
function labToXyzD50([l, a, b]: Vector): Vector {
  const kappa = 24389 / 27;
  const epsilon = 216 / 24389;
  const f1 = (l + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > epsilon ? f0 ** 3 : (116 * f0 - 16) / kappa;
  const y = l > kappa * epsilon ? f1 ** 3 : l / kappa;
  const z = f2 ** 3 > epsilon ? f2 ** 3 : (116 * f2 - 16) / kappa;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}

/**
 * Gamma-encoded sRGB channels from OKLab.
 *
 * @param oklab - L (0-1), a, b
 * @returns sRGB channels (unclipped)
 */
function oklabToSrgb([l, a, b]: Vector): Vector {
  const lms: Vector = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ];
  const linear: Vector = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ];
  return perChannel(linear, linearToSrgb);
}

/**
 * Cartesian a/b from a polar chroma and hue.
 *
 * @param lch - Lightness, chroma, hue in degrees
 * @returns Lightness, a, b
 */
function polarToCartesian([l, c, h]: Vector): Vector {
  const radians = (h * Math.PI) / 180;
  return [l, c * Math.cos(radians), c * Math.sin(radians)];
}

/** Gamma-encoded sRGB from the channels of a `color()` space */
const COLOR_SPACES: Record<string, (v: Vector) => Vector> = {
  srgb: (v) => v,
  'srgb-linear': (v) => perChannel(v, linearToSrgb),
  'display-p3': (v) => xyzD65ToSrgb(multiply(LINEAR_P3_TO_XYZ_D65, perChannel(v, srgbToLinear))),
  rec2020: (v) => xyzD65ToSrgb(multiply(LINEAR_REC2020_TO_XYZ_D65, perChannel(v, rec2020ToLinear))),
  'a98-rgb': (v) =>
    xyzD65ToSrgb(
      multiply(
        LINEAR_A98_TO_XYZ_D65,
        perChannel(v, (x) => x ** (563 / 256))
      )
    ),
  'prophoto-rgb': (v) =>
    xyzD65ToSrgb(
      multiply(D50_TO_D65, multiply(LINEAR_PROPHOTO_TO_XYZ_D50, perChannel(v, prophotoToLinear)))
    ),
  xyz: (v) => xyzD65ToSrgb(v),
  'xyz-d65': (v) => xyzD65ToSrgb(v),
  'xyz-d50': (v) => xyzD65ToSrgb(multiply(D50_TO_D65, v)),
};

/**
 * One color function argument as a number: `none` is 0, a percentage is
 * scaled to `percentScale` (100% = percentScale), an angle is in degrees.
 *
 * @param token - Argument, e.g. `37.3%`, `0.2`, `none`, `120deg`
 * @param percentScale - Value of 100%
 * @returns Number, or NaN when it is not one
 */
function argument(token: string, percentScale: number): number {
  if (token === 'none') return 0;
  const match = /^(-?[\d.]+(?:e-?\d+)?)(%|deg|grad|rad|turn)?$/i.exec(token);
  if (!match) return NaN;
  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === '%') return (value / 100) * percentScale;
  if (unit === 'rad') return (value * 180) / Math.PI;
  if (unit === 'grad') return value * 0.9;
  if (unit === 'turn') return value * 360;
  return value;
}

/**
 * Split the arguments of a color function into its channels and alpha
 * (after a `/`, or the token after the channels in legacy `rgba(r, g, b, a)`).
 *
 * @param body - Text between the parentheses
 * @param count - Tokens before the alpha (4 for `color()`: the space and three channels)
 * @returns Channel tokens and the alpha token (when given)
 */
function splitArguments(body: string, count: number): { channels: string[]; alpha?: string } {
  const [main = '', alpha] = body.split('/').map((part) => part.trim());
  const channels = main.split(/[\s,]+/).filter(Boolean);
  if (alpha !== undefined) return { channels, alpha };
  const legacyAlpha = channels.length === count + 1 ? channels[count] : undefined;
  if (legacyAlpha !== undefined) return { channels: channels.slice(0, count), alpha: legacyAlpha };
  return { channels };
}

/** How each color function maps its three channels to sRGB, with each channel's 100% */
const FUNCTIONS: Record<string, { scales: Vector; toSrgb: (v: Vector) => Vector }> = {
  rgb: { scales: [255, 255, 255], toSrgb: (v) => v.map((x) => x / 255) as Vector },
  lab: {
    scales: [100, 125, 125],
    toSrgb: (v) => xyzD65ToSrgb(multiply(D50_TO_D65, labToXyzD50(v))),
  },
  lch: {
    scales: [100, 150, 1],
    toSrgb: (v) => xyzD65ToSrgb(multiply(D50_TO_D65, labToXyzD50(polarToCartesian(v)))),
  },
  oklab: { scales: [1, 0.4, 0.4], toSrgb: oklabToSrgb },
  oklch: { scales: [1, 0.4, 1], toSrgb: (v) => oklabToSrgb(polarToCartesian(v)) },
};

/**
 * Parse a `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` color.
 *
 * @param hex - Hex digits without `#`
 * @returns Color, or null when malformed
 */
function parseHex(hex: string): Rgba | null {
  if (!/^([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const channel = (i: number): number => parseInt(full.slice(i * 2, i * 2 + 2), 16) / 255;
  return { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) : 1 };
}

/**
 * Parse a functional color: `rgb()`/`rgba()`, `lab()`, `lch()`, `oklab()`,
 * `oklch()` or `color(<space> …)`.
 *
 * @param name - Function name, lowercased
 * @param body - Text between the parentheses
 * @returns Color in sRGB, or null when it is not one
 */
function parseFunction(name: string, body: string): Rgba | null {
  const { channels, alpha } = splitArguments(body, name === 'color' ? 4 : 3);
  const a = alpha === undefined ? 1 : argument(alpha, 1);
  if (name === 'color') {
    const [space = '', ...rest] = channels;
    const toSrgb = COLOR_SPACES[space.toLowerCase()];
    const values = rest.map((token) => argument(token, 1));
    if (!toSrgb || values.length !== 3) return null;
    return withAlpha(toSrgb(values as Vector), a);
  }
  const fn = FUNCTIONS[name === 'rgba' ? 'rgb' : name];
  if (!fn || channels.length !== 3) return null;
  const values = channels.map((token, i) => argument(token, fn.scales[i] ?? 1)) as Vector;
  return withAlpha(fn.toSrgb(values), a);
}

/**
 * A color from sRGB channels and an alpha, or null when a value is not a number.
 *
 * @param rgb - sRGB channels
 * @param a - Alpha
 * @returns Color, or null
 */
function withAlpha(rgb: Vector, a: number): Rgba | null {
  if ([...rgb, a].some((value) => Number.isNaN(value))) return null;
  return { r: rgb[0], g: rgb[1], b: rgb[2], a: Math.min(1, Math.max(0, a)) };
}

/**
 * Parse a CSS color as Chrome computes it.
 *
 * @param value - e.g. `rgba(0, 0, 0, 0.2)`, `oklch(0.373 0.034 259.733)`, `#fff`, `transparent`
 * @returns The color in sRGB, or null for anything else (`currentcolor`, keywords, gradients)
 */
export function parseColor(value: string): Rgba | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (text.startsWith('#')) return parseHex(text.slice(1));
  const match = /^([a-z]+)\((.*)\)$/.exec(text);
  return match?.[1] && match[2] !== undefined ? parseFunction(match[1], match[2]) : null;
}

/**
 * A channel (0-1, clipped to the sRGB gamut) as two hex digits.
 *
 * @param channel - Channel value
 * @returns e.g. `0a`
 */
function hexByte(channel: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, channel)) * 255);
  return byte.toString(16).padStart(2, '0');
}

/**
 * A color as short hex: `#rgb` when every channel's digits repeat, else
 * `#rrggbb`; `#rrggbbaa` when translucent; `transparent` at alpha 0.
 *
 * @param color - Color in sRGB
 * @returns e.g. `#fff`, `#364153`, `#00000033`
 */
export function toHex(color: Rgba): string {
  const alpha = Math.round(color.a * 255);
  if (alpha === 0) return 'transparent';
  const rgb = [color.r, color.g, color.b].map(hexByte);
  if (alpha < 255) return `#${rgb.join('')}${alpha.toString(16).padStart(2, '0')}`;
  const short = rgb.every((byte) => byte[0] === byte[1]);
  return `#${short ? rgb.map((byte) => byte[0]).join('') : rgb.join('')}`;
}

/**
 * A computed color as short hex ({@link toHex}).
 *
 * @param value - Computed color
 * @returns Hex, or the value unchanged when it is not a color
 */
export function hexColor(value: string): string {
  const color = parseColor(value);
  return color ? toHex(color) : value;
}

/** Color functions and hex colors inside a longer value (shadows, gradients) */
const COLOR_IN_VALUE = /\b(?:rgba?|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi;

/**
 * Replace every color inside a value with its hex ({@link toHex}).
 *
 * @param value - e.g. `rgba(0, 0, 0, 0.2) 0px 1px 2px 0px`
 * @returns e.g. `#00000033 0px 1px 2px 0px`
 */
export function hexColorsIn(value: string): string {
  return value.replace(COLOR_IN_VALUE, (match) => hexColor(match));
}

/**
 * Paint a color over another (source-over alpha compositing).
 *
 * @param top - Color on top
 * @param bottom - Color below
 * @returns The color a user sees
 */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number): number => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/**
 * WCAG relative luminance of an opaque color (clipped to sRGB).
 *
 * @param color - Color
 * @returns Luminance 0-1
 */
export function relativeLuminance(color: Rgba): number {
  const linear = [color.r, color.g, color.b].map((channel) =>
    srgbToLinear(Math.min(1, Math.max(0, channel)))
  );
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/**
 * WCAG contrast ratio of text over an opaque background; translucent text
 * is composited over the background first.
 *
 * @param text - Text color
 * @param background - Opaque background color
 * @returns Ratio 1-21
 */
export function contrastRatio(text: Rgba, background: Rgba): number {
  const lighter = relativeLuminance(composite(text, background));
  const other = relativeLuminance(background);
  const [high, low] = lighter > other ? [lighter, other] : [other, lighter];
  return (high + 0.05) / (low + 0.05);
}

/** WCAG 2 conformance of a contrast ratio */
export type ContrastLevel = 'AAA' | 'AA' | 'AA large' | 'fail';

/**
 * WCAG 2 level a contrast ratio reaches. Large text (24px, or 18.66px bold)
 * needs 4.5 for AAA and 3 for AA; other text 7 and 4.5.
 *
 * @param ratio - Contrast ratio
 * @param fontSize - Font size in px
 * @param fontWeight - Font weight
 * @returns Level reached
 */
export function contrastLevel(ratio: number, fontSize: number, fontWeight: number): ContrastLevel {
  const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
  if (ratio >= (large ? 4.5 : 7)) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return large && ratio >= 3 ? 'AA large' : 'fail';
}
