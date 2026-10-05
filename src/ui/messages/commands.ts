/**
 * Command operation messages (stop, cleanup, etc.)
 *
 * User-facing messages for command-specific operations like stopping sessions,
 * cleaning up stale files, and validating command arguments.
 */

import type { DomFrame, PageLoadingState, PendingRequestInfo } from '@/ipc/protocol/commands.js';
import type {
  ElementLayout,
  FillValueMismatch,
  LayoutPoint,
  LayoutSize,
  NewMessage,
  PageLayout,
  PageNavigation,
} from '@/ipc/protocol/domTypes.js';
import type { DelegationNote } from '@/runtime/dom/listenerSummary.js';
import type { WaitCondition, WaitSnapshot } from '@/runtime/dom/waitCondition.js';
import type { DocumentRequestState, ViewportPosition } from '@/types.js';
import {
  buildAgentDiscoveryHelp,
  buildCommonTaskExamples,
  buildUrlExamples,
  buildSessionManagementReminder,
} from '@/ui/formatters/helpFormatters.js';
import { formatDuration, joinLines, pluralize, truncateUrl } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { truncateByLength } from '@/utils/strings.js';

/**
 * Chrome closed by `bdg stop` (gracefully, so the profile is saved).
 *
 * @param pid - Chrome process ID
 * @returns Formatted success message
 */
export function chromeClosedMessage(pid?: number): string {
  return pid ? `Closed Chrome (PID ${pid})` : 'Closed Chrome';
}

/**
 * Generate orphaned daemons cleaned message.
 *
 * @param count - Number of orphaned daemons cleaned up
 * @returns Formatted success message
 */
export function orphanedDaemonsCleanedMessage(count: number): string {
  return `Cleaned up ${count} orphaned daemon process${count === 1 ? '' : 'es'}`;
}

/**
 * Warning shown when a click falls back from mouse events to `el.click()`.
 *
 * @param reason - Why the mouse could not reach the element (e.g. "covered by another element")
 * @returns Warning text
 */
export function domClickFallbackWarning(reason: string | null | undefined): string {
  return `Element is ${reason ?? 'not reachable by the mouse'}; dispatched DOM events instead of mouse events (a user could not reach it like this)`;
}

/** Reason of a `bdg dom form` blocker for a required field left empty */
export const REQUIRED_FIELD_EMPTY_REASON = 'Required field is empty';

/**
 * Field labels as a list (without a trailing colon), the first five and how
 * many more.
 *
 * @param labels - Field labels
 * @returns e.g. "Last Name, Zip"
 */
function fieldLabelList(labels: string[]): string {
  const shown = labels
    .slice(0, 5)
    .map((label) => label.replace(/\s*:\s*$/, ''))
    .join(', ');
  return labels.length > 5 ? `${shown} and ${labels.length - 5} more` : shown;
}

/**
 * Part of the `bdg dom form` summary naming the required fields left empty.
 *
 * @param labels - Labels of the empty required fields
 * @returns e.g. "2 required fields empty: Last Name, Zip"
 */
export function requiredFieldsEmptyMessage(labels: string[]): string {
  const fields = labels.length === 1 ? 'field' : 'fields';
  return `${labels.length} required ${fields} empty: ${fieldLabelList(labels)}`;
}

/**
 * Readiness at the end of the `bdg dom form` summary.
 *
 * @param summary - Whether the form is ready, how many fields are filled and
 *   required, and the labels of the empty ones
 * @returns e.g. "READY to submit", "NOT ready (no fields filled)"
 */
export function formReadinessMessage(summary: {
  readyToSubmit: boolean;
  filledFields: number;
  requiredTotal: number;
  emptyFieldLabels: string[];
}): string {
  if (!summary.readyToSubmit) {
    return summary.filledFields === 0 ? 'NOT ready (no fields filled)' : 'NOT ready';
  }
  if (summary.requiredTotal > 0 || summary.emptyFieldLabels.length === 0) return 'READY to submit';
  return `READY to submit (no field is marked required; empty: ${fieldLabelList(summary.emptyFieldLabels)})`;
}

/** Why an action's status line is not a clean success when nothing changed */
export const NO_VISIBLE_EFFECT =
  'no visible effect observed: no DOM change, requests or navigation within 300 ms';

/**
 * Status line of a DOM action: a check mark only for a clean success.
 *
 * @param done - What was done, e.g. "Element Clicked"
 * @param warned - Whether the action has warnings (shown right below)
 * @param noEffect - Whether the action had no visible effect
 * @returns e.g. "✓ Element Clicked", "⚠ Element Clicked (with warnings)" or
 *   "⚠ Element Clicked (no visible effect observed: no DOM change, requests or navigation within 300 ms)"
 */
export function actionStatusLine(done: string, warned: boolean, noEffect = false): string {
  if (noEffect) return `⚠ ${done} (${NO_VISIBLE_EFFECT})`;
  return warned ? `⚠ ${done} (with warnings)` : `✓ ${done}`;
}

/**
 * How an action changed the page's location, for its `Page:` row.
 *
 * @param navigation - Navigation the action caused
 * @returns e.g. "navigated to https://example.com/secure (200)" or
 *   "URL changed to https://example.com/#/active (same document)"
 */
export function pageNavigationText(navigation: PageNavigation): string {
  if (navigation.sameDocument) return `URL changed to ${navigation.url} (same document)`;
  const status = navigation.status === undefined ? '' : ` (${navigation.status})`;
  return `navigated to ${navigation.url}${status}`;
}

/**
 * A message an action made appear, for its `New text:` rows.
 *
 * @param message - New message
 * @returns e.g. `"Your password is invalid!" (div#flash.flash.error)`
 */
export function newMessageText(message: NewMessage): string {
  return `"${message.text}" (${message.element})`;
}

/**
 * Warning shown when a filled field's value read back is not the one given:
 * cut to its maxlength, a password of another length (values never shown),
 * or another value (naming the field the value went to, when one has it).
 *
 * @param mismatch - Value given and value found (masked for passwords)
 * @returns Warning text
 */
export function valueMismatchWarning(mismatch: FillValueMismatch): string {
  if (mismatch.truncatedTo !== undefined) {
    return `The value was cut to ${mismatch.truncatedTo} characters by maxlength`;
  }
  if (mismatch.expectedLength !== undefined) {
    return `The password field's value differs from the one filled (length ${mismatch.actualLength ?? 0}, expected ${mismatch.expectedLength}); the page may have rejected or changed the input`;
  }
  const outcome =
    mismatch.movedTo === undefined
      ? 'the page may have rejected or moved the input'
      : `the value appeared in ${mismatch.movedTo} instead`;
  return `The field's value is "${mismatch.actual}" after filling (expected "${mismatch.expected}"); ${outcome}`;
}

/**
 * Warning shown when a mouse press was dispatched but the target never
 * received it (e.g. a browser dialog or bubble captured the input).
 */
export const CLICK_NOT_RECEIVED_WARNING =
  'The click may not have reached the element: the page saw no mouse press (the browser may be showing a dialog or bubble that captures input)';

/**
 * Note under a shortened list of matches.
 *
 * @param hidden - Matches not listed
 * @param jsonLimit - How many JSON output lists, when it leaves some out too
 * @returns e.g. "... and 1174 more (use --json for all)",
 *   "... and 8980 more (--json lists the first 100)"
 */
export function moreMatchesNote(hidden: number, jsonLimit?: number): string {
  const where =
    jsonLimit === undefined ? 'use --json for all' : `--json lists the first ${jsonLimit}`;
  return `... and ${hidden} more (${where})`;
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
 * Note under a shortened list of requests an action triggered when JSON
 * output left some out too (they are only in the network telemetry then).
 *
 * @param hidden - Requests not listed
 * @returns e.g. "... and 50 more (see bdg network list)"
 */
export function moreRequestsNote(hidden: number): string {
  return `... and ${hidden} more (see ${sessionCommand('bdg network list')})`;
}

/**
 * Title of the list of requests that started while an action ran (they are
 * attributed by time, so a page poller's requests are listed too: the title
 * doesn't claim the action caused them).
 *
 * @param total - Requests in all
 * @returns e.g. "Requests during the action (18):"
 */
export function triggeredRequestsTitle(total: number): string {
  return `Requests during the action (${total}):`;
}

/**
 * Line counting the static assets an action loaded instead of listing them.
 *
 * @param count - Asset requests
 * @param types - Short type names, e.g. ["css", "js", "images"]
 * @returns e.g. "+ 97 assets (css, js, fonts, images)"
 */
export function assetRequestsNote(count: number, types: string[]): string {
  return `+ ${count} ${count === 1 ? 'asset' : 'assets'} (${types.join(', ')})`;
}

/**
 * Pieces of the reasons `bdg dom layout` gives for hidden and invisible
 * elements. The page-side measurement builds the reasons from them, e.g.
 * `clipped by div#acc: zero height`, `opacity: 0 on div#menu`.
 */
export const LAYOUT_REASONS = {
  /** Hidden: an `<option>` of a closed `<select>` has no box */
  option: 'not rendered (an <option> is shown by its <select>)',
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
 * The `prefers-color-scheme` media feature the page sees, labelled as the
 * preference it is (the page may still render its own theme), and where it
 * comes from.
 *
 * @param scheme - Light or dark
 * @param emulated - Set with `--color-scheme` (otherwise the system setting)
 * @returns e.g. `prefers-color-scheme: dark (from the system setting)`
 */
export function colorSchemeLabel(scheme: string, emulated: boolean): string {
  const source = emulated ? 'emulated with --color-scheme' : 'from the system setting';
  return `prefers-color-scheme: ${scheme} (${source})`;
}

/**
 * First line of `bdg status` for a running session.
 *
 * @param page - URL and title of the page, when the session reported them
 * @returns e.g. `Session active: https://example.com/ — Example Domain`
 */
export function sessionActiveLine(page?: { url: string; title: string }): string {
  if (!page) return 'Session active';
  return `Session active: ${page.url}${page.title ? ` — ${page.title}` : ''}`;
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
 * Warning when a selector matched several elements and no --index was given.
 *
 * @param count - Number of matching elements
 * @param action - What was done, e.g. "clicked the first visible one"
 * @returns Warning text
 */
export function multipleMatchesWarning(count: number, action: string): string {
  return `${count} elements match; ${action} (use --index or a more specific selector)`;
}

/** Listeners found, by where they are attached */
export interface ListenerCounts {
  target: number;
  ancestor: number;
  /** On the document and the window */
  global: number;
}

/**
 * Headline of `bdg dom listeners`, saying where the counted listeners are:
 * the list covers the element, its ancestors, its document and window.
 *
 * @param element - Inspected element, e.g. "button#save"
 * @param counts - Listeners found, by placement
 * @param context - Index of the element and the iframe it is in, if any
 * @returns e.g. "Event listeners for button#save (156: 3 on the element, 120 on ancestors, 33 on document and window)"
 */
export function listenersHeadline(
  element: string,
  counts: ListenerCounts,
  context: { index?: number | undefined; frame?: string | undefined } = {}
): string {
  const index = context.index === undefined ? '' : ` [${context.index}]`;
  const frame = context.frame ? ` in ${context.frame}` : '';
  const total = counts.target + counts.ancestor + counts.global;
  const where = [
    counts.target > 0 && `${counts.target} on the element`,
    counts.ancestor > 0 && `${counts.ancestor} on ancestors`,
    counts.global > 0 && `${counts.global} on document and window`,
  ].filter(Boolean);
  return `Event listeners for ${element}${index}${frame} (${total}: ${where.join(', ')})`;
}

/** Heading of the collapsed framework root listeners */
export const COLLAPSED_LISTENERS_HEADING =
  'Framework roots (one line per node; --all lists each listener):';

/**
 * One collapsed framework root.
 *
 * @param root - Framework label, event types, phases and dispatcher names
 * @returns e.g. "React root: 90 event types, capture and bubble (dispatchEvent, …)"
 */
export function collapsedListenersSummary(root: {
  framework?: string | undefined;
  types: string[];
  capture: boolean;
  bubble: boolean;
  handlers: string[];
}): string {
  const phases = [root.capture && 'capture', root.bubble && 'bubble'].filter(Boolean).join(' and ');
  const label = root.framework ?? 'Dispatcher';
  return `${label}: ${root.types.length} event types, ${phases} (${root.handlers.join(', ')})`;
}

/**
 * jQuery handlers left unresolved because there were too many.
 *
 * @param count - Handlers not resolved
 * @returns One-line note
 */
export function jqueryHandlersSkippedNote(count: number): string {
  return `Note: ${count} more jQuery handler${count === 1 ? '' : 's'} not resolved; their jQuery dispatcher is listed instead (narrow down with --type)`;
}

/**
 * Event types a mistyped `--type` probably meant.
 *
 * @param types - Suggested types
 * @returns e.g. "Did you mean: --type click?"
 */
export function eventTypeSuggestion(types: string[]): string {
  return `Did you mean: --type ${types.join(',')}? (event types are case-sensitive, without "on")`;
}

/**
 * `bdg dom listeners` found nothing.
 *
 * @param element - Inspected element
 * @param types - Event types asked for with --type, if any
 * @returns e.g. "No click listeners on button#save, its ancestors, document or window"
 */
export function noListenersMessage(element: string, types?: string[]): string {
  const kind = types?.length ? `${types.join('/')} listeners` : 'event listeners';
  return `No ${kind} on ${element}, its ancestors, document or window`;
}

/** What `bdg dom listeners` covers, shown when it found nothing */
export const NO_LISTENERS_HINT =
  'Inline on… attributes and on… properties are included, and so are handlers frameworks delegate to ancestors (React, jQuery)';

/** Event types named in a note; the rest are counted */
const NOTE_TYPES_SHOWN = 5;

/**
 * "click", "click and keydown", "click, keydown and input", "a, b, c, d, e
 * and 3 more".
 *
 * @param types - Event types
 * @returns The types as a list in prose
 */
function typeList(types: string[]): string {
  if (types.length > NOTE_TYPES_SHOWN + 1) {
    return `${types.slice(0, NOTE_TYPES_SHOWN).join(', ')} and ${types.length - NOTE_TYPES_SHOWN} more`;
  }
  return types.length > 1
    ? `${types.slice(0, -1).join(', ')} and ${types[types.length - 1]}`
    : (types[0] ?? '');
}

/**
 * Note for interaction event types the element has no listener of its own for.
 *
 * @param note - How the types reach their handlers
 * @returns One-line note, or undefined when the listed handlers say it all
 */
export function delegationNote(note: DelegationNote): string | undefined {
  const types = typeList(note.types);
  const has = note.types.length === 1 ? 'has' : 'have';
  const placeholders = typeList(note.placeholderTypes);
  const placeholder = `the element's own ${placeholders} listener is only React's no-op placeholder`;
  switch (note.kind) {
    case 'react':
      if (note.placeholderTypes.length === 0) return undefined;
      return `Note: ${placeholder}; the React on… handlers listed above for ${placeholders} run from React's root container`;
    case 'react-root':
      return `Note: React's root container (${note.node ?? 'its root'}) handles ${types}, but no React on… prop for ${note.types.length === 1 ? 'it' : 'them'} was found on the element or its ancestors${note.placeholderTypes.length > 0 ? `; ${placeholder}` : ''}`;
    case 'jquery':
      return `Note: ${types} ${has} no listener on the element itself; jQuery runs the handlers listed above by delegation from ${note.node ?? 'an ancestor'}`;
    case 'delegated': {
      const own =
        note.placeholderTypes.length > 0 ? 'no listener that does anything' : 'no listener';
      return `Note: ${types} ${has} ${own} on the element itself; the listeners on its ancestors, document or window listed above still run for it (event delegation)`;
    }
  }
}

/**
 * React prop handlers left unresolved because there were too many.
 *
 * @param count - Handlers not resolved
 * @returns One-line note
 */
export function reactHandlersSkippedNote(count: number): string {
  return `Note: ${count} more React handler prop${count === 1 ? '' : 's'} not listed (narrow down with --type)`;
}

/**
 * A JavaScript dialog bdg accepted, as one line.
 *
 * @param dialog - Dialog type and text
 * @returns e.g. 'alert() dialog accepted: "Saved"'
 */
export function dialogConsoleText(dialog: { type: string; message: string }): string {
  const kind = dialog.type === 'beforeunload' ? 'beforeunload' : `${dialog.type}()`;
  return `${kind} dialog accepted${dialog.message ? `: "${dialog.message}"` : ''}`;
}

/** Headline of each pointer action, e.g. "Element Double-clicked" */
export const POINTER_ACTION_DONE = {
  click: 'Clicked',
  double: 'Double-clicked',
  right: 'Right-clicked',
  hover: 'Hovered',
} as const;

/** Headline of each `bdg page` action */
export const PAGE_ACTION_DONE = {
  navigate: 'Navigated',
  reload: 'Reloaded',
  back: 'Went back',
  forward: 'Went forward',
} as const;

/** Help text of the `bdg page` history commands */
/** Description of `bdg page info` */
export const PAGE_INFO_DESCRIPTION = 'Show the URL and title of the session page';

export const PAGE_ACTION_DESCRIPTIONS = {
  reload: 'Reload the page',
  back: 'Go back one page (like the browser button)',
  forward: 'Go forward one page (like the browser button)',
} as const;

/**
 * `bdg page navigate|reload|back|forward` when the document answered with an
 * error status, or the page then loaded another document that answered
 * differently (a 404 page whose script loads the app).
 *
 * @param status - HTTP status of the navigation's document
 * @param later - The last document the page loaded afterwards, if any
 * @returns Warning, or undefined when there is nothing to report
 */
export function documentStatusWarning(
  status: number,
  later?: { status: number; url: string }
): string | undefined {
  const failed = status >= 400;
  const laterFailed = later !== undefined && later.status >= 400;
  if (later && (failed || laterFailed)) {
    return `The page responded with HTTP ${status}, then loaded ${later.url} (HTTP ${later.status})`;
  }
  return failed ? `The page responded with HTTP ${status}` : undefined;
}

/**
 * `bdg page navigate` to a URL that loaded no page.
 *
 * @returns Warning
 */
export function notAPageWarning(): string {
  return 'The URL did not load a page (it may be a file download); the page did not change';
}

/**
 * `bdg page` when the server did not answer in time.
 *
 * @param ms - Time waited
 * @returns Warning
 */
export function stillLoadingWarning(ms: number): string {
  return `The new page has not answered within ${Math.round(ms / 1000)}s; it is still loading (check with ${sessionCommand('bdg status')})`;
}

/**
 * A request the page is still waiting for.
 *
 * @param request - Pending request
 * @returns e.g. `GET code.jquery.com/ui/.../jquery-ui.js (pending 30s)`
 */
function pendingRequestLabel(request: PendingRequestInfo): string {
  return `${request.method} ${truncateUrl(request.url)} (pending ${formatDuration(request.pendingMs)})`;
}

/**
 * Requests still running, the longest-running first, in words.
 *
 * @param pending - The requests to name
 * @param count - All requests still running
 * @returns e.g. `GET …/app.js (pending 30s) and 2 more`
 */
export function pendingRequestsText(pending: PendingRequestInfo[], count: number): string {
  const more = count - pending.length;
  return `${pending.map(pendingRequestLabel).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * How far a page request got, in words.
 *
 * @param request - The page request
 * @returns e.g. `POST …/authenticate pending for 30s`, `POST …/authenticate returned 503 Service Unavailable`,
 *   `POST …/authenticate failed (net::ERR_CONNECTION_REFUSED)`
 */
export function documentRequestText(request: DocumentRequestState): string {
  const target = `${request.method} ${truncateUrl(request.url)}`;
  if (request.errorText !== undefined) return `${target} failed (${request.errorText})`;
  if (request.status !== undefined) {
    return `${target} returned ${request.status}${request.statusText ? ` ${request.statusText}` : ''}`;
  }
  return `${target} pending for ${formatDuration(request.pendingMs ?? 0)}`;
}

/**
 * Start and `bdg page` when the document has not finished loading within
 * the readiness wait: its readyState and the requests it is waiting on.
 *
 * @param state - Loading state of the page
 * @returns Warning, e.g. `The page is still loading (document.readyState: loading); waiting on: GET …/jquery-ui.js (pending 30s)`
 */
export function pageLoadingWarning(state: PageLoadingState): string {
  const waitingOn =
    state.pending.length > 0
      ? `; waiting on: ${pendingRequestsText(state.pending, state.pendingCount)}`
      : '';
  return `The page is still loading (document.readyState: ${state.readyState})${waitingOn}. Elements may be missing until it finishes: ${sessionCommand('bdg dom wait <selector>')} waits for one`;
}

/**
 * Help of `dom click`/`submit`: they wait for the network only, so results a
 * page shows later (timers, spinners, animations) are waited for with `dom wait`.
 */
export const CLICK_RESULT_WAIT_HELP = joinLines(
  '',
  'Waits only for the requests the action starts (150 ms idle, up to 2 s), not for',
  'results the page shows later (timers, spinners, animations). Wait for those with:',
  "  bdg dom wait '#result' --visible          # or --text 'Saved', or '.spinner' --gone"
);

/** Examples in the help of `bdg dom wait` */
export const WAIT_HELP_EXAMPLES = joinLines(
  '',
  'Examples:',
  "  bdg dom wait '#finish' --visible          # timer-based loading (a spinner, then the result)",
  "  bdg dom wait '.toast' --text 'Saved'      # a match containing the text",
  "  bdg dom wait '#loading' --gone            # the spinner went away",
  '  bdg dom wait --load                       # the page finished loading'
);

/**
 * The elements `bdg dom wait` waits for.
 *
 * @param condition - What is waited for
 * @returns e.g. `#finish with text "hello world"`
 */
export function waitTargetLabel(condition: WaitCondition): string {
  const text = condition.text !== undefined ? ` with text "${condition.text}"` : '';
  return `${condition.selector ?? 'the page'}${text}`;
}

/**
 * One-line result of `bdg dom wait`.
 *
 * @param condition - What was waited for
 * @param elapsedMs - How long it took
 * @returns e.g. `✓ div#finish visible after 5.1s`
 */
export function waitMetMessage(condition: WaitCondition, elapsedMs: number): string {
  const after = `after ${(elapsedMs / 1000).toFixed(1)}s`;
  if (condition.selector === undefined) return `✓ Page loaded ${after}`;
  const state = condition.gone
    ? condition.visible
      ? 'hidden'
      : 'gone'
    : condition.visible
      ? 'visible'
      : 'found';
  const loaded = condition.load ? ' and page loaded' : '';
  return `✓ ${waitTargetLabel(condition)} ${state}${loaded} ${after}`;
}

/**
 * What the page showed, for a `bdg dom wait` that timed out.
 *
 * @param snapshot - Last thing the page reported
 * @param condition - What was waited for
 * @returns e.g. `2 matches, none visible` or `document.readyState: loading`
 */
export function waitSnapshotSummary(snapshot: WaitSnapshot, condition: WaitCondition): string {
  const some = (count: number): string => (count === 0 ? 'none' : String(count));
  const parts: string[] = [];
  if (condition.selector !== undefined) {
    parts.push(snapshot.count === 0 ? 'no matches' : pluralize(snapshot.count, 'match', 'matches'));
    if (condition.text !== undefined && snapshot.count > 0) {
      parts.push(`${some(snapshot.textCount)} with text "${condition.text}"`);
    }
    if (condition.visible && snapshot.textCount > 0) {
      parts.push(`${some(snapshot.visibleCount)} visible`);
    }
  }
  if (condition.load || snapshot.readyState !== 'complete') {
    parts.push(`document.readyState: ${snapshot.readyState}`);
  }
  return parts.join(', ');
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

/** Longest frame URL shown in human output (JSON has the full URL) */
const FRAME_URL_MAX_LENGTH = 100;

/**
 * A frame URL for human output: shortened, and named when empty.
 *
 * @param url - Frame URL
 * @returns e.g. `https://pay.example/checkout?…`, or `(no URL)`
 */
export function frameUrlLabel(url: string): string {
  return url ? truncateByLength(url, FRAME_URL_MAX_LENGTH) : '(no URL)';
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
 * What an element without text holds, in `bdg dom get` output.
 *
 * @param children - First child elements, e.g. `iframe#app`
 * @param count - Number of child elements
 * @returns e.g. `No text; holds 1 element: iframe (see its HTML with --raw)`
 */
export function emptyElementLine(children: string[], count: number): string {
  if (count === 0) return 'No text and no child elements';
  const more = count > children.length ? `, … ${count - children.length} more` : '';
  return `No text; holds ${pluralize(count, 'element')}: ${children.join(', ')}${more} (see its HTML with --raw)`;
}

/**
 * Note on an element screenshot that captured more than the element's border
 * box, because content (floats, positioned children) overflows it.
 *
 * @param box - Border box
 * @param captured - Area captured
 * @returns e.g. `grown from 940×37 to 940×285 to include content overflowing the element`
 */
export function screenshotGrownNote(
  box: { width: number; height: number },
  captured: { width: number; height: number }
): string {
  return `grown from ${box.width}×${box.height} to ${captured.width}×${captured.height} to include content overflowing the element`;
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

/**
 * Header of `bdg dom eval --frame` output naming the frame the script ran in.
 *
 * @param url - Frame URL
 * @returns e.g. `Frame: https://pay.example/`
 */
export function evalFrameLine(url: string): string {
  return `Frame: ${frameUrlLabel(url)}`;
}

/**
 * Generate warning message.
 *
 * @param message - Warning text
 * @returns Formatted warning message
 */
export function warningMessage(message: string): string {
  return `Warning: ${message}`;
}

/**
 * Generate session files cleaned up message.
 *
 * @returns Formatted success message
 */
export function sessionFilesCleanedMessage(): string {
  return 'Session files cleaned up';
}

/**
 * Generate session output file removed message.
 *
 * @returns Formatted success message
 */
export function sessionOutputRemovedMessage(): string {
  return 'Session output file removed';
}

/**
 * Generate session directory clean message.
 *
 * @returns Formatted success message
 */
export function sessionDirectoryCleanMessage(): string {
  return 'Session directory is now clean';
}

/**
 * `bdg cleanup --purge` deleted a named session's directory.
 *
 * @param dir - Deleted directory
 * @returns Message
 */
export function sessionDirectoryPurgedMessage(dir: string): string {
  return `Session directory removed: ${dir}`;
}

/**
 * Generate no session files found message.
 *
 * @returns Formatted success message
 */
export function noSessionFilesMessage(): string {
  return 'No session files found. Session directory is already clean';
}

/**
 * Generate session still active error.
 *
 * @param pid - Active process ID
 * @returns Formatted error message
 */
export function sessionStillActiveError(pid: number): string {
  return `Session is still active (PID ${pid})`;
}

/**
 * How to clean up a session that is still running.
 *
 * @param session - Name of a named session, or null for the default session
 * @returns Suggestion lines
 */
export function sessionStillActiveSuggestion(session: string | null): string {
  return `Stop gracefully: ${sessionCommand('bdg stop', session)}\nForce cleanup: ${sessionCommand('bdg cleanup --force', session)}`;
}

/**
 * Generate help message when no URL is provided to start command.
 *
 * Displays comprehensive guidance optimized for agent discovery:
 * - Agent-specific resources (machine-readable schema, CDP discovery)
 * - Complete task workflow examples
 * - URL format guidance
 * - Session management commands
 *
 * Organized to prioritize agent needs (discovery first) while maintaining
 * human readability with clear task-oriented examples.
 *
 * @returns Multi-line help message with examples
 * */
export function startCommandHelpMessage(): string {
  return joinLines(
    '',
    buildAgentDiscoveryHelp(),
    '',
    buildCommonTaskExamples(),
    '',
    buildUrlExamples(),
    '',
    buildSessionManagementReminder(),
    '',
    'Not sure which command? Start a session to see all available commands:',
    '  bdg <url>',
    ''
  );
}
