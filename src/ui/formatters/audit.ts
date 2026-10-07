/**
 * Human output of `bdg dom audit` and `bdg css search`.
 */

import type { AuditResult, CssSearchResult } from '@/ipc/protocol/auditTypes.js';
import { auditCanvasNote, auditUncertainContrastNote } from '@/ui/messages/commands.js';
import { truncateByLength } from '@/utils/strings.js';

/** Width of the text quoted in a finding */
const TEXT_WIDTH = 50;

/**
 * Format `bdg dom audit`.
 *
 * @param data - Audit result
 * @returns Output
 */
export function formatAudit(data: AuditResult): string {
  const sections = [
    data.contrast && contrastSection(data.contrast),
    data.overflow && overflowSection(data.overflow),
    data.layers && layersSection(data.layers),
    data.animations && animationsSection(data.animations, data.canvases),
  ].filter((section): section is string[] => section !== undefined);
  const capped = data.capped ? [`(stopped after ${data.walked} elements; the page has more)`] : [];
  return [...sections.flatMap((lines) => [...lines, '']), ...capped].join('\n').trimEnd();
}

/**
 * The contrast section.
 *
 * @param contrast - Contrast findings
 * @returns Lines
 */
function contrastSection(contrast: NonNullable<AuditResult['contrast']>): string[] {
  const head = `Contrast (${contrast.level}): ${contrast.failing} of ${contrast.checked} text elements below`;
  const rows = contrast.items.map(
    (item) =>
      `  ${item.ratio.toFixed(2).padStart(5)}  ${item.color} on ${item.background}  ${item.element} "${truncateByLength(item.text, TEXT_WIDTH)}" ${item.size}px${item.weight >= 700 ? ' bold' : ''}${item.opacity !== undefined ? ` (faded: opacity ${item.opacity})` : ''}${item.inView ? '' : ' (out of view)'}`
  );
  const more = contrast.failing - contrast.items.length;
  return [
    head,
    ...rows,
    ...(more > 0 ? [`  (+${more} more; --limit to list them)`] : []),
    ...(contrast.uncertain ? [`  ${auditUncertainContrastNote(contrast.uncertain)}`] : []),
  ];
}

/**
 * The overflow section.
 *
 * @param overflow - Overflow findings
 * @returns Lines
 */
function overflowSection(overflow: NonNullable<AuditResult['overflow']>): string[] {
  const head = overflow.scrollsSideways
    ? `Overflow: the page is ${overflow.pageWidth} wide in a ${overflow.viewportWidth} viewport (it scrolls sideways)`
    : `Overflow: nothing makes the page scroll sideways (${overflow.viewportWidth} wide)`;
  return [
    head,
    ...overflow.wide.map(
      (item) => `  past the right edge: ${item.element} (to ${item.right}, ${item.width} wide)`
    ),
    ...overflow.truncated.map(
      (item) =>
        `  cut off (${item.kind}): ${item.element}${times(item.count)} "${truncateByLength(item.text, TEXT_WIDTH)}"`
    ),
    ...overflow.scrollers.map(
      (item) =>
        `  scrolls sideways inside: ${item.element} (${item.scrollWidth} of content in ${item.width})`
    ),
    ...overflow.images.map(
      (image) =>
        `  image ${[image.upscaled && `upscaled ${image.scale}x${overflow.pixelRatio > 1 ? ` at pixel ratio ${overflow.pixelRatio}` : ''}`, image.distorted && 'distorted'].filter(Boolean).join(', ')}: ${image.element}${times(image.count)} ${image.natural.w}x${image.natural.h} pixels drawn at ${image.rendered.w}x${image.rendered.h} CSS px`
    ),
  ];
}

/**
 * How many identical findings a row stands for.
 *
 * @param count - Count, when 2 or more
 * @returns e.g. ` ×5`, or empty
 */
function times(count: number | undefined): string {
  return count ? ` ×${count}` : '';
}

/**
 * The layers section.
 *
 * @param layers - Fixed and sticky elements
 * @returns Lines
 */
function layersSection(layers: NonNullable<AuditResult['layers']>): string[] {
  if (layers.length === 0) return ['Layers: no fixed or sticky elements'];
  return [
    `Layers: ${layers.length} fixed or sticky`,
    ...layers.map(
      (layer) =>
        `  ${layer.position} z ${layer.zIndex}  ${layer.element} ${layer.rect.w}x${layer.rect.h} at ${layer.rect.x},${layer.rect.y} of the viewport${layer.inView ? '' : ' (not in view now)'}`
    ),
  ];
}

/**
 * The animations section.
 *
 * @param animations - Running animations
 * @param canvases - Visible canvas elements
 * @returns Lines
 */
function animationsSection(
  animations: NonNullable<AuditResult['animations']>,
  canvases: number | undefined
): string[] {
  const note = canvases ? [`  ${auditCanvasNote(canvases)}`] : [];
  if (animations.length === 0) return ['Animations: none running', ...note];
  return [
    `Animations: ${animations.length} running`,
    ...animations.map(
      (animation) =>
        `  ${animation.name} on ${animation.element}${times(animation.count)} (${animation.type}, ${typeof animation.duration === 'number' ? `${animation.duration}ms` : animation.duration}, ${animation.iterations === 'infinite' ? 'infinite' : `${animation.iterations}x`}${animation.scrollDriven ? ', scroll-driven' : ''})`
    ),
    ...note,
  ];
}

/**
 * Format `bdg css search`.
 *
 * @param data - Search result
 * @returns Output
 */
export function formatCssSearch(data: CssSearchResult): string {
  if (data.total === 0) return `"${data.query}" is not in the page's ${data.sheets} stylesheets`;
  const more = data.total - data.matches.length;
  return [
    `"${data.query}": ${data.total} matches in ${data.sheets} stylesheets`,
    ...data.matches.flatMap((match) => [`  ${match.source}`, `    ${match.text}`]),
    ...(more > 0 ? [`  (+${more} more; --limit to list them)`] : []),
  ].join('\n');
}
