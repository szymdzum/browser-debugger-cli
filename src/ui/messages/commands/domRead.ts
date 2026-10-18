/**
 * DOM read and layout messages.
 */

import type { DomFrame } from '@/ipc/protocol/commands.js';
import type {
  ElementLayout,
  LayoutPoint,
  LayoutSize,
  PageLayout,
} from '@/ipc/protocol/domTypes.js';
import { MASKED_VALUE } from '@/runtime/dom/elementInfo.js';
import type { ViewportPosition } from '@/types.js';
import { pluralize } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

import { frameUrlLabel } from './shared.js';

/**
 * Note under a shortened human list whose JSON output lists more, up to a cap.
 *
 * @param hidden - Items not listed
 * @param jsonLimit - Most items the JSON output lists
 * @returns e.g. "... and 8980 more (--json lists up to 100)"
 */
export function moreMatchesNote(hidden: number, jsonLimit: number): string {
  return `... and ${hidden} more (--json lists up to ${jsonLimit})`;
}

/**
 * Note under `dom query` matches cut by `--limit`.
 *
 * @param omitted - Matches not listed
 * @param indexed - Matches usable by index, when not all of them
 * @returns e.g. `... and 49953 more (--limit 0 lists all; indices 0-999 work with other commands)`
 */
export function queryMoreMatchesNote(omitted: number, indexed?: number): string {
  const indices =
    indexed === undefined ? '' : `; indices 0-${indexed - 1} work with other commands`;
  return `... and ${omitted} more (--limit 0 lists all${indices})`;
}

/**
 * Note under `dom query` matches listed past those whose viewport position
 * was checked.
 *
 * @param checked - First matches checked
 * @returns e.g. `Visibility is checked for the first 100 matches only; bdg dom layout <index> checks any of them`
 */
export function queryViewportCheckedNote(checked: number): string {
  return `Visibility is checked for the first ${checked} matches only; ${sessionCommand('bdg dom layout <index>')} checks any of them`;
}

/**
 * First line under an accessibility tree cut by `--limit` or `--depth`.
 *
 * @param listed - Nodes listed
 * @returns e.g. "Showing the first 50 nodes (text boxes and repeated text left out)"
 */
export function a11yTreeShownNote(listed: number): string {
  return `Showing the first ${listed} nodes (text boxes and repeated text left out)`;
}

/**
 * How to see the rest of an accessibility tree cut by `--limit` or `--depth`.
 *
 * @param omitted - Nodes left out
 * @returns e.g. "51391 more: --limit 0 lists all, --depth <n> limits the levels, or search with bdg dom a11y query \"role:<role>\""
 */
export function a11yTreeMoreNote(omitted: number): string {
  return `${omitted} more: --limit 0 lists all, --depth <n> limits the levels, or search with bdg dom a11y query "role:<role>"`;
}

/**
 * Note under a list of a11y query matches cut by `--limit`.
 *
 * @param omitted - Matches not listed
 * @returns e.g. "... and 213 more (--limit 0 lists all; their indices work too)"
 */
export function a11yMoreMatchesNote(omitted: number): string {
  return `... and ${omitted} more (--limit 0 lists all; their indices work too)`;
}

/**
 * Pieces of the reasons `bdg dom layout` gives for hidden and invisible
 * elements. The page-side measurement builds the reasons from them, e.g.
 * `clipped by div#acc: zero height`, `opacity: 0 on div#menu`.
 */
export const LAYOUT_REASONS = {
  /** Hidden: an `<option>` of a closed `<select>` has no box */
  option: 'not rendered (an <option> is shown by its <select>)',
  /** Hidden: a `display: contents` element (a slot) none of whose content has a box */
  noBox: 'display: contents (no box of its own)',
  /** Hidden: start of the reason for a `display: contents` element (a slot) whose content does not show, followed by why its first content does not */
  contentNotShown: 'content not shown: ',
  /** Hidden: a `<slot>` with nothing assigned and no fallback content */
  emptySlot: 'empty slot (nothing assigned, no fallback content)',
  /** Hidden: start of the reason for a clipping container with no area, followed by it */
  clippedBy: 'clipped by ',
  /** Which size of that container is zero */
  zeroHeight: 'zero height',
  zeroWidth: 'zero width',
  /** Invisible: fully transparent */
  transparent: 'opacity: 0',
  /** Joins an invisible reason to the ancestor causing it */
  on: ' on ',
} as const;

/** Start of the off-screen reason of an element a scroll-locked page hides ({@link scrollLockedReason}) */
const SCROLL_LOCKED_PREFIX = 'page scrolling is locked';

/**
 * Off-screen reason for an element out of view on a page whose scrolling is
 * locked, naming the visible dialog that likely locked it when there is one.
 *
 * @param lock - What locks it, e.g. `overflow: hidden on body`
 * @param dialog - Visible dialog on the page, e.g. `div#consent` (null: none)
 * @returns e.g. `page scrolling is locked (overflow: hidden on body), likely by dialog div#consent`,
 *   or `page scrolling is locked (overflow: hidden on body)`
 */
export function scrollLockedReason(lock: string, dialog: string | null = null): string {
  const cause = dialog ? `, likely by dialog ${dialog}` : '';
  return `${SCROLL_LOCKED_PREFIX} (${lock})${cause}`;
}

/** Short location hints for elements a user cannot see without scrolling */
const VIEWPORT_POSITION_HINTS: Partial<Record<ViewportPosition, string>> = {
  above: 'above viewport',
  below: 'below fold',
  left: 'left of viewport',
  right: 'right of viewport',
  hidden: 'hidden',
};

/**
 * Location hint for an element outside the viewport or hidden.
 *
 * @param position - Where the element is
 * @param clippedBy - Ancestor or iframe cutting it off, if any
 * @returns e.g. "below fold", "out of view in ul#list"; undefined for
 *   elements (partly) in view
 */
export function viewportPositionHint(
  position: ViewportPosition,
  clippedBy?: string
): string | undefined {
  const outside = position !== 'visible' && position !== 'partly' && position !== 'hidden';
  if (outside && clippedBy) return `out of view in ${clippedBy}`;
  return VIEWPORT_POSITION_HINTS[position];
}

/**
 * Page scroll that would bring an element into view, in words.
 *
 * @param scrollBy - Scroll amounts
 * @param purpose - What the scroll does, e.g. "centre it"
 * @returns e.g. "scroll down 760px to centre it"
 */
function scrollAdvice(scrollBy: LayoutPoint, purpose: string): string {
  const steps = [
    scrollBy.y !== 0 && `${scrollBy.y > 0 ? 'down' : 'up'} ${Math.abs(scrollBy.y)}px`,
    scrollBy.x !== 0 && `${scrollBy.x > 0 ? 'right' : 'left'} ${Math.abs(scrollBy.x)}px`,
  ].filter(Boolean);
  return `scroll ${steps.join(', ')} to ${purpose}`;
}

/** What {@link layoutPositionLabel} reads of an element */
type LabelledLayout = Pick<
  ElementLayout,
  | 'inViewport'
  | 'percentVisible'
  | 'hiddenReason'
  | 'scrollBy'
  | 'clippedBy'
  | 'offScreenReason'
  | 'bounds'
>;

/**
 * Whether an element fits the viewport (the scroll then centres it; a larger
 * one gets its start aligned).
 *
 * @param element - Element layout
 * @param viewport - Viewport size, when known
 * @returns True when it fits, or the viewport is unknown
 */
function fitsViewport(element: LabelledLayout, viewport?: LayoutSize): boolean {
  const { width, height } = element.bounds;
  return !viewport || (width <= viewport.width && height <= viewport.height);
}

/**
 * How to bring an element that is out of view into view, in words.
 *
 * @param element - Element layout
 * @param viewport - Viewport size (an element larger than it is not centred)
 * @returns e.g. "scroll down 760px to centre it", "off-screen: fixed position, page scroll
 *   does not move it"; undefined when neither applies
 */
function layoutScrollNote(element: LabelledLayout, viewport?: LayoutSize): string | undefined {
  if (element.scrollBy) {
    const purpose = fitsViewport(element, viewport) ? 'centre it' : 'bring it into view';
    return scrollAdvice(element.scrollBy, purpose);
  }
  return element.offScreenReason && `off-screen: ${element.offScreenReason}`;
}

/**
 * How to see all of an element that is partly in view, in words.
 *
 * @param element - Element layout
 * @param viewport - Viewport size (for an element larger than it, the scroll shows its start)
 * @returns e.g. "scroll down 302px to see all of it", "sticky position, page scroll moves it
 *   only until it sticks"; undefined when neither applies
 */
function partlyVisibleNote(element: LabelledLayout, viewport?: LayoutSize): string | undefined {
  if (element.scrollBy) {
    const purpose = fitsViewport(element, viewport) ? 'see all of it' : 'show it from its start';
    return scrollAdvice(element.scrollBy, purpose);
  }
  return element.offScreenReason;
}

/**
 * Where an element is relative to the viewport, for `bdg dom layout`.
 *
 * @param element - Element layout
 * @param viewport - Viewport size, when known
 * @returns e.g. "visible", "partly visible (40%); scroll down 302px to see all of it",
 *   "below fold (scroll down 760px to centre it)",
 *   "out of view in ul#list (below)", "hidden (display: none)",
 *   "left of viewport (off-screen: beyond the page's scroll range)",
 *   "below fold; page scrolling is locked (overflow: hidden on body), likely by dialog div#consent"
 */
export function layoutPositionLabel(element: LabelledLayout, viewport?: LayoutSize): string {
  const { inViewport, percentVisible, hiddenReason, clippedBy, offScreenReason } = element;
  if (inViewport === 'visible') return 'visible';
  const locked = !element.scrollBy && offScreenReason?.startsWith(SCROLL_LOCKED_PREFIX);
  if (inViewport === 'partly') {
    const clipped = clippedBy ? `, clipped by ${clippedBy}` : '';
    const label = `partly visible (${percentVisible ?? 0}%${clipped})`;
    const note = partlyVisibleNote(element, viewport);
    return note ? `${label}; ${note}` : label;
  }
  const note = locked ? undefined : layoutScrollNote(element, viewport);
  const label = viewportPositionHint(inViewport, clippedBy) ?? inViewport;
  if (hiddenReason) return `${label} (${hiddenReason})`;
  if (clippedBy) return `${label} (${inViewport})`;
  if (locked) return `${label}; ${offScreenReason}`;
  return note ? `${label} (${note})` : label;
}

/**
 * Page dimensions line of `bdg dom layout`.
 *
 * @param page - Viewport, scroll position, document size and the color scheme the page is told to prefer
 * @returns e.g. "Page: viewport 1280×720, scrolled to 0,0, document 1280×2400, prefers-color-scheme: dark"
 */
export function pageLayoutLine(page: PageLayout): string {
  const { viewport, scroll, document, colorScheme } = page;
  const scheme = colorScheme ? `, prefers-color-scheme: ${colorScheme}` : '';
  return `Page: viewport ${viewport.width}×${viewport.height}, scrolled to ${scroll.x},${scroll.y}, document ${document.width}×${document.height}${scheme}`;
}

/**
 * Headline of `bdg dom layout`.
 *
 * @param count - Elements matched
 * @param listed - Elements reported (fewer with --index)
 * @param selector - Selector they matched
 * @returns e.g. '3 elements match "button" (page x,y and size in CSS px):',
 *   '1 of 3 elements matching "button" (...)'
 */
export function layoutHeadline(count: number, listed: number, selector: string): string {
  const matched =
    listed < count
      ? `${listed} of ${count} elements matching "${selector}"`
      : `${count} element${count === 1 ? ' matches' : 's match'} "${selector}"`;
  return `${matched} (page x,y and size in CSS px):`;
}

/**
 * Headline of `bdg dom layout` for a cached index.
 *
 * @param target - The index and the list it refers to, in words
 * @returns e.g. `Element at index 0 of the last dom query "h3" (page x,y and size in CSS px):`
 */
export function indexLayoutHeadline(target: string): string {
  return `Element at ${target} (page x,y and size in CSS px):`;
}

/**
 * One line describing an iframe: index, URL, name/id, and how it is isolated.
 *
 * @param frame - Frame from `bdg dom frames`
 * @returns e.g. `[1] https://pay.example/  #checkout  cross-origin, out-of-process`
 */
export function frameLabel(frame: DomFrame): string {
  const names = [frame.name && `name=${frame.name}`, frame.id && `#${frame.id}`].filter(Boolean);
  const isolation = [
    frame.crossOrigin ? 'cross-origin' : 'same-origin',
    frame.outOfProcess && 'out-of-process',
  ].filter(Boolean);
  const label = `[${frame.index}] ${frameUrlLabel(frame.url)}`;
  return [label, ...names, isolation.join(', ')].join('  ');
}

/**
 * `bdg dom frames` on a page without iframes.
 *
 * @returns Message
 */
export function noFramesMessage(): string {
  return 'The page has no iframes';
}

/**
 * `bdg dom frames` while the page is still loading: its iframes may not
 * exist yet.
 *
 * @param empty - No iframe was found
 * @returns e.g. `No iframes yet; the page is still loading, so the list may be incomplete (bdg dom wait --load)`
 */
export function framesStillLoadingNote(empty: boolean): string {
  const wait = `(${sessionCommand('bdg dom wait --load')})`;
  return empty
    ? `No iframes yet; the page is still loading, so the list may be incomplete ${wait}`
    : `Note: the page is still loading, so the list may be incomplete ${wait}`;
}

/**
 * Text of an element in `bdg dom get` output.
 *
 * @param text - Collapsed text, ending in `...` when it was cut
 * @returns e.g. `Text: Welcome to ... (cut at 500 characters; --full shows all of it)`
 */
export function elementTextLine(text: string): string {
  const cut = text.endsWith('...') ? ' (cut at 500 characters; --full shows all of it)' : '';
  return `Text: ${text}${cut}`;
}

/**
 * What an element without text holds, in `bdg dom get` output. A closed
 * shadow root is out of reach of selectors and `bdg dom inspect`; its
 * elements appear in the accessibility tree, whose query indices
 * `dom fill`, `dom click` and `dom get` accept.
 *
 * @param children - First child elements, e.g. `iframe#app`
 * @param count - Number of child elements
 * @param shadowRoot - Mode of the shadow root the children are in (`--raw` does not show them); none for light children
 * @returns e.g. `No text; holds 1 element: iframe (see its HTML with --raw)`,
 *   `No text; its shadow root holds 1 element: button "Close" (see it with bdg dom inspect)`,
 *   `No text; its closed shadow root holds 1 element: form (selectors and dom inspect cannot reach it; …)`
 */
export function emptyElementLine(
  children: string[],
  count: number,
  shadowRoot?: 'open' | 'closed'
): string {
  const root = shadowRoot === 'closed' ? 'its closed shadow root' : 'its shadow root';
  if (count === 0) return `No text and no child elements${shadowRoot ? ` in ${root}` : ''}`;
  const more = count > children.length ? `, … ${count - children.length} more` : '';
  const holder = shadowRoot ? `${root} holds` : 'holds';
  return `No text; ${holder} ${pluralize(count, 'element')}: ${children.join(', ')}${more} (${childrenHint(shadowRoot)})`;
}

/**
 * Where to see the children named by {@link emptyElementLine}.
 *
 * @param shadowRoot - Mode of the shadow root they are in; none for light children
 * @returns A command that shows them
 */
function childrenHint(shadowRoot?: 'open' | 'closed'): string {
  if (shadowRoot === 'closed')
    return 'selectors and dom inspect cannot reach it; bdg dom a11y query, e.g. role=textbox, lists its elements by index for dom fill, dom click and dom get';
  return shadowRoot ? 'see it with bdg dom inspect' : 'see its HTML with --raw';
}

/**
 * Tree line of `bdg dom inspect` for an element hosting a closed shadow
 * root, whose children the tree cannot show.
 *
 * @returns e.g. `shadow closed root, not shown: …`
 */
export function inspectClosedShadowRootLine(): string {
  return 'shadow closed root, not shown: bdg dom a11y query, e.g. role=textbox, lists its elements by index for dom fill, dom click and dom get';
}

/**
 * Next commands after `bdg dom query`, by index so they reach matches in
 * shadow roots and iframes too.
 *
 * @param index - Match to use in the examples
 * @returns One line
 */
export function queryNextSteps(index: number): string {
  return `Next: bdg dom get ${index} (text), bdg dom get ${index} --raw (HTML), bdg dom layout ${index} (position)`;
}

/** Examples under `bdg css search --help` */
export const CSS_SEARCH_HELP_EXAMPLES = `
Examples:
  bdg css search -- --brand       Where a custom property is set and used (-- before a text
                                  that starts with -; options go before it:
                                  bdg css search --limit 50 -- --brand)
  bdg css search "oklch("         Rules that use oklch colors
  bdg css search ".btn-primary"   Rules of a class, in every stylesheet`;

/**
 * Footer of `dom get --raw` and `dom a11y tree` output in which a secret
 * value is masked.
 *
 * @returns The note, naming how to read a value
 */
export function rawHtmlMaskedNote(): string {
  return `Secret values shown as ${MASKED_VALUE} (read them with ${sessionCommand('bdg eval')})`;
}
