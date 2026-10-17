/**
 * Human output of `bdg dom audit` and `bdg css search`.
 */

import type { AuditResult, CssSearchResult } from '@/ipc/protocol/auditTypes.js';
import { escapeOneLine } from '@/ui/formatters/keyAttributes.js';
import {
  A11Y_RULE_HINTS,
  a11yModalNote,
  a11yTruncatedNote,
  auditCanvasNote,
  auditUncertainContrastNote,
  pageLoadingWarning,
} from '@/ui/messages/commands.js';
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
    data.a11y && a11ySection(data.a11y),
  ].filter((section): section is string[] => section !== undefined);
  const capped = data.capped ? [`(stopped after ${data.walked} elements; the page has more)`] : [];
  const loading = data.loading ? [`⚠ ${pageLoadingWarning(data.loading)}`] : [];
  return [...sections.flatMap((lines) => [...lines, '']), ...capped, ...loading]
    .join('\n')
    .trimEnd();
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
      `  ${item.ratio.toFixed(2).padStart(5)}  ${item.color} on ${item.background}  ${escapeOneLine(item.element)} "${truncateByLength(item.text, TEXT_WIDTH)}" ${item.size}px${item.weight >= 700 ? ' bold' : ''}${item.opacity !== undefined ? ` (faded: opacity ${item.opacity})` : ''}${item.inView ? '' : ' (out of view)'}`
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
      (item) =>
        `  past the right edge: ${escapeOneLine(item.element)} (to ${item.right}, ${item.width} wide)`
    ),
    ...overflow.truncated.map(
      (item) =>
        `  cut off (${item.kind}): ${escapeOneLine(item.element)}${times(item.count)} "${truncateByLength(item.text, TEXT_WIDTH)}"`
    ),
    ...overflow.scrollers.map(
      (item) =>
        `  scrolls sideways inside: ${escapeOneLine(item.element)} (${item.scrollWidth} of content in ${item.width})`
    ),
    ...overflow.images.map(
      (image) =>
        `  image ${[image.upscaled && `upscaled ${image.scale}x${overflow.pixelRatio > 1 ? ` at pixel ratio ${overflow.pixelRatio}` : ''}`, image.distorted && 'distorted'].filter(Boolean).join(', ')}: ${escapeOneLine(image.element)}${times(image.count)} ${image.natural.w}x${image.natural.h} pixels drawn at ${image.rendered.w}x${image.rendered.h} CSS px`
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
        `  ${layer.position} z ${layer.zIndex}  ${escapeOneLine(layer.element)} ${layer.rect.w}x${layer.rect.h} at ${layer.rect.x},${layer.rect.y} of the viewport${layer.inView ? '' : ' (not in view now)'}`
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
        `  ${animation.name} on ${escapeOneLine(animation.element)}${times(animation.count)} (${animation.type}, ${typeof animation.duration === 'number' ? `${animation.duration}ms` : animation.duration}, ${animation.iterations === 'infinite' ? 'infinite' : `${animation.iterations}x`}${animation.scrollDriven ? ', scroll-driven' : ''})`
    ),
    ...note,
  ];
}

/**
 * The a11y section: the rules with findings, their elements and one pointer
 * to describe them.
 *
 * @param a11y - A11y findings
 * @returns Lines
 */
function a11ySection(a11y: NonNullable<AuditResult['a11y']>): string[] {
  const failing = a11y.rules.filter((rule) => rule.count > 0);
  const total = failing.reduce((sum, rule) => sum + rule.count, 0);
  const modal = a11y.modal ? [`⚠ ${a11yModalNote(a11y.modal.element)}`] : [];
  const note = a11y.truncated ? [`  ${a11yTruncatedNote()}`] : [];
  if (total === 0)
    return [...modal, `A11y: no issues (${a11y.rules.length} rules checked)`, ...note];
  return [
    ...modal,
    `A11y: ${total} ${total === 1 ? 'issue' : 'issues'} in ${failing.length} of ${a11y.rules.length} rules`,
    ...failing.flatMap((rule) => [
      `  ${rule.id}: ${rule.count} (${A11Y_RULE_HINTS[rule.id]})`,
      ...rule.elements.map((item) => `    ${escapeOneLine(item.element)}  ${item.detail}`),
      ...(rule.count > rule.elements.length
        ? [`    (+${rule.count - rule.elements.length} more; --limit to list them)`]
        : []),
    ]),
    ...note,
    `  Describe one: bdg dom a11y describe <element>`,
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
