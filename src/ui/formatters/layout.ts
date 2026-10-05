/**
 * Human-readable output of `bdg dom layout`.
 */

import type { ElementLayout, LayoutResult } from '@/ipc/protocol/domTypes.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  layoutHeadline,
  layoutPositionLabel,
  moreMatchesNote,
  pageLayoutLine,
} from '@/ui/messages/commands.js';

/** Elements listed in human output (JSON has up to 100) */
const LAYOUT_DISPLAY_LIMIT = 20;

/** `bdg dom layout` data (the `success` flag is implied by the envelope) */
type LayoutOutput = Omit<LayoutResult, 'success'>;

/**
 * One element as a compact line: index, description, text, page position
 * and size, where it is relative to the viewport, what covers it, an inert
 * or fully transparent element and the iframe or shadow root it is in.
 *
 * @param element - Element layout
 * @returns e.g. `[0] button#save "Save"  420,1180 120×40  below fold (scroll down 500px)`
 */
export function layoutLine(element: ElementLayout): string {
  const { bounds } = element;
  return [
    `[${element.index}] ${element.element}${element.text ? ` "${element.text}"` : ''}`,
    `${bounds.x},${bounds.y} ${bounds.width}×${bounds.height}`,
    layoutPositionLabel(element),
    element.coveredBy && `covered by ${element.coveredBy}`,
    element.inert && 'inert',
    element.computed.opacity === '0' && 'opacity: 0',
    element.context && `in ${element.context}`,
  ]
    .filter(Boolean)
    .join('  ');
}

/**
 * Format `bdg dom layout` output: the page dimensions, then one line per
 * element (the first {@link LAYOUT_DISPLAY_LIMIT}).
 *
 * @param data - Layout report
 * @returns Formatted output
 */
export function formatLayout(data: LayoutOutput): string {
  const shown = data.elements.slice(0, LAYOUT_DISPLAY_LIMIT);
  const more = data.elements.length - shown.length + (data.omitted ?? 0);
  return new OutputFormatter()
    .text(pageLayoutLine(data.page))
    .text(layoutHeadline(data.count, data.elements.length + (data.omitted ?? 0), data.selector))
    .list(shown.map(layoutLine))
    .list(more > 0 ? [moreMatchesNote(more)] : [])
    .build();
}
