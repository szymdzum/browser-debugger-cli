/**
 * Human-readable output of `bdg dom layout`.
 */

import { indexSourceText } from '@/errors/messages.js';
import type { ElementLayout, LayoutResult, LayoutSize } from '@/ipc/protocol/domTypes.js';
import type { IndexSource } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import {
  coverText,
  indexLayoutHeadline,
  layoutHeadline,
  layoutPositionLabel,
  moreMatchesNote,
  pageLayoutLine,
} from '@/ui/messages/commands.js';

/** Elements listed in human output (JSON has up to 100) */
const LAYOUT_DISPLAY_LIMIT = 20;

/** `bdg dom layout` data (the `success` flag is implied by the envelope), with the list an index refers to */
type LayoutOutput = Omit<LayoutResult, 'success'> & { indexSource?: IndexSource | undefined };

/**
 * One element as a compact line: index, description, text, page position
 * and size (not for hidden elements, which have no meaningful box), where it
 * is relative to the viewport, what covers it, an inert or invisible element
 * and the iframe or shadow root it is in (unless the position already names
 * it as the clipping iframe).
 *
 * @param element - Element layout
 * @param viewport - Viewport size, when known (an element larger than it is not centred by the scroll)
 * @returns e.g. `[0] button#save "Save"  420,1180 120×40  below fold (scroll down 500px to centre it)`
 */
export function layoutLine(element: ElementLayout, viewport?: LayoutSize): string {
  const { bounds } = element;
  return [
    `[${element.index}] ${element.element}${element.text ? ` "${element.text}"` : ''}`,
    element.inViewport !== 'hidden' && `${bounds.x},${bounds.y} ${bounds.width}×${bounds.height}`,
    layoutPositionLabel(element, viewport),
    element.coveredBy && coverText(element.coveredBy, element.coverTransparent),
    element.inert && 'inert',
    element.invisible,
    element.context && element.context !== element.clippedBy && `in ${element.context}`,
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
    .text(
      data.indexSource
        ? indexLayoutHeadline(indexSourceText(data.indexSource))
        : layoutHeadline(data.count, data.elements.length + (data.omitted ?? 0), data.selector)
    )
    .list(shown.map((element) => layoutLine(element, data.page.viewport)))
    .list(more > 0 ? [moreMatchesNote(more, data.omitted ? data.elements.length : undefined)] : [])
    .build();
}
