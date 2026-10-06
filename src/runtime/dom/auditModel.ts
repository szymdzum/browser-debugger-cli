/**
 * `bdg dom audit` results from the page-side walk ({@link AUDIT_PAGE_JS}):
 * text below a WCAG contrast level (composited like `dom inspect`), what
 * makes the page scroll sideways, cut-off text, scaled or distorted images,
 * fixed and sticky layers and running animations. Pure: tested without a
 * browser.
 */

import type {
  AuditContrastItem,
  AuditImage,
  AuditResult,
  AuditCheck,
} from '@/ipc/protocol/auditTypes.js';
import type { RawAudit, RawAuditText, RawImage } from '@/runtime/dom/auditScripts.js';
import { textContrast } from '@/runtime/dom/inspectPaintModel.js';
import { hexColor } from '@/utils/color.js';
import { pxNumber, round1 } from '@/utils/cssValues.js';

/** Scale or aspect change (fraction) below which an image counts as drawn at its size */
const IMAGE_TOLERANCE = 0.05;

/** What `dom audit` was asked for */
export interface AuditOptions {
  checks: AuditCheck[];
  /** WCAG level text must reach */
  level: 'AA' | 'AAA';
  /** Findings listed per check */
  limit: number;
}

/**
 * The audit result.
 *
 * @param raw - Page-side walk
 * @param options - Checks, level and limit
 * @returns Result
 */
export function buildAudit(raw: RawAudit, options: AuditOptions): AuditResult {
  return {
    checks: options.checks,
    walked: raw.walked,
    ...(raw.capped && { capped: true }),
    ...(raw.texts && { contrast: contrastFindings(raw, options) }),
    ...(raw.wide && { overflow: overflowFindings(raw, options.limit) }),
    ...(raw.layers && {
      layers: raw.layers.slice(0, options.limit).map((layer) => ({
        element: layer.label,
        position: layer.position,
        zIndex: layer.zIndex,
        rect: {
          x: round1(layer.rect.x),
          y: round1(layer.rect.y),
          w: round1(layer.rect.w),
          h: round1(layer.rect.h),
        },
        inView: layer.inView,
      })),
    }),
    ...(raw.animations && {
      animations: grouped(
        raw.animations.map((animation) => ({
          element: animation.label,
          name: animation.name,
          type: animation.type,
          duration: animation.duration,
          iterations: animation.iterations,
          ...(animation.scrollDriven && { scrollDriven: true as const }),
        }))
      ).slice(0, options.limit),
    }),
  };
}

/**
 * Text below the level, weakest first.
 *
 * @param raw - Page-side walk
 * @param options - Level and limit
 * @returns How many were checked and failed, and the weakest
 */
function contrastFindings(
  raw: RawAudit,
  options: AuditOptions
): NonNullable<AuditResult['contrast']> {
  const checked = (raw.texts ?? []).map((text) => contrastItem(text, raw.canvasDark));
  const failing = checked
    .filter((item): item is AuditContrastItem => item !== undefined)
    .filter((item) => item.ratio < requiredRatio(item, options.level))
    .sort((a, b) => a.ratio - b.ratio);
  return {
    level: options.level,
    checked: checked.length,
    failing: failing.length,
    items: failing.slice(0, options.limit),
  };
}

/**
 * One text holder's contrast.
 *
 * @param text - Page-side text holder
 * @param canvasDark - The page canvas is dark
 * @returns Finding, or undefined when its color cannot be read
 */
function contrastItem(text: RawAuditText, canvasDark: boolean): AuditContrastItem | undefined {
  const contrast = textContrast(
    { color: text.color, 'font-size': text.fontSize, 'font-weight': text.fontWeight },
    {
      backgrounds: text.backgrounds,
      canvasDark,
      opacity: text.opacity,
      paintRisks: text.risks,
    }
  );
  if (!contrast) return undefined;
  return {
    element: text.label,
    text: text.text,
    ratio: contrast.ratio,
    color: hexColor(text.color),
    background: contrast.background,
    size: pxNumber(text.fontSize) ?? 16,
    weight: Number(text.fontWeight) || 400,
    inView: text.inView,
    ...(contrast.approximate && { approximate: contrast.approximate }),
  };
}

/**
 * The ratio WCAG asks of a text at a level: large text (24px, or 18.66px
 * bold) needs less.
 *
 * @param item - Text size and weight
 * @param level - AA or AAA
 * @returns Minimum ratio
 */
export function requiredRatio(
  item: Pick<AuditContrastItem, 'size' | 'weight'>,
  level: 'AA' | 'AAA'
): number {
  const large = item.size >= 24 || (item.size >= 18.66 && item.weight >= 700);
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

/**
 * What makes the page scroll sideways, cut-off text and scaled images.
 *
 * @param raw - Page-side walk
 * @param limit - Findings per list
 * @returns Overflow findings
 */
function overflowFindings(raw: RawAudit, limit: number): NonNullable<AuditResult['overflow']> {
  const wide = [...(raw.wide ?? [])].sort((a, b) => b.right - a.right);
  const images = grouped(
    (raw.images ?? [])
      .map((image) => imageFinding(image, raw.pixelRatio))
      .filter((image): image is AuditImage => image !== undefined)
  );
  return {
    pageWidth: raw.pageWidth,
    viewportWidth: raw.viewport.width,
    scrollsSideways: raw.pageWidth > raw.viewport.width + 1,
    wide: wide.slice(0, limit).map((element) => ({
      element: element.label,
      right: round1(element.right),
      width: round1(element.width),
    })),
    truncated: grouped(
      (raw.truncated ?? []).map((text) => ({
        element: text.label,
        text: text.text,
        kind: text.kind,
      }))
    ).slice(0, limit),
    images: images.slice(0, limit),
    pixelRatio: raw.pixelRatio,
    scrollers: (raw.scrollers ?? []).slice(0, limit).map((scroller) => ({
      element: scroller.label,
      scrollWidth: scroller.scrollWidth,
      width: scroller.width,
    })),
  };
}

/**
 * How much an image's pixels are stretched on screen, by its `object-fit`:
 * `fill` and `cover` stretch to the larger ratio, `contain` to the smaller,
 * `none` not at all, `scale-down` at most to its own size.
 *
 * @param image - Page-side image
 * @param pixelRatio - Device pixel ratio
 * @returns Screen pixels per image pixel
 */
function drawnScale(image: RawImage, pixelRatio: number): number {
  const across = (image.rendered.w * pixelRatio) / image.natural.w;
  const down = (image.rendered.h * pixelRatio) / image.natural.h;
  if (image.objectFit === 'none') return pixelRatio;
  if (image.objectFit === 'contain') return Math.min(across, down);
  if (image.objectFit === 'scale-down') return Math.min(pixelRatio, Math.min(across, down));
  return Math.max(across, down);
}

/**
 * Findings with identical ones merged into the first, with a `count`.
 *
 * @param findings - Findings in page order
 * @returns Findings, each distinct one once
 */
function grouped<T extends object>(findings: readonly T[]): Array<T & { count?: number }> {
  const byKey = new Map<string, T & { count?: number }>();
  for (const finding of findings) {
    const key = JSON.stringify(finding);
    const seen = byKey.get(key);
    if (seen) seen.count = (seen.count ?? 1) + 1;
    else byKey.set(key, { ...finding });
  }
  return [...byKey.values()];
}

/**
 * An image drawn with fewer pixels than the screen needs (upscaled, blurry:
 * rendered size × pixel ratio over its own pixels) or with another aspect
 * ratio (distorted, unless `object-fit` keeps the ratio).
 *
 * @param image - Page-side image
 * @param pixelRatio - Device pixel ratio
 * @returns Finding, or undefined when it is sharp and keeps its ratio
 */
export function imageFinding(image: RawImage, pixelRatio = 1): AuditImage | undefined {
  const scale = drawnScale(image, pixelRatio);
  const naturalRatio = image.natural.w / image.natural.h;
  const renderedRatio = image.rendered.w / image.rendered.h;
  const distorted =
    image.objectFit === 'fill' &&
    Math.abs(renderedRatio - naturalRatio) / naturalRatio > IMAGE_TOLERANCE;
  const upscaled = scale > 1 + IMAGE_TOLERANCE;
  if (!distorted && !upscaled) return undefined;
  return {
    element: image.label,
    natural: image.natural,
    rendered: { w: round1(image.rendered.w), h: round1(image.rendered.h) },
    scale: Math.round(scale * 100) / 100,
    ...(upscaled && { upscaled: true }),
    ...(distorted && { distorted: true }),
  };
}
