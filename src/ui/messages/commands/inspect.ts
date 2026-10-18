/**
 * Inspect and listener messages.
 */

import type { InspectVisibility } from '@/ipc/protocol/inspectTypes.js';
import type { DelegationNote } from '@/runtime/dom/listenerSummary.js';

import { maskedText, shownByText } from './shared.js';

/** Help text explaining `bdg dom inspect`'s output notation */
export const INSPECT_OUTPUT_LEGEND = `
Output notation:
  WxH @x,y        rendered border box size and page position (CSS px, no unit)
  m / p / b       margin / padding / border widths, 1-4 values in CSS order (top right bottom left)
  in-parent       distances to the parent's content edges (l t r b); sib: gaps to the sibling on each side
  scroll WxH      the content (pseudo-elements too) is larger than the box
  16/24           font size / line height; 'webfont loaded' = drawn with a downloaded font;
                  (rendered "X") = drawn with another font than declared (a fallback);
                  (resolves to "X") = the font a generic family (sans-serif, system-ui) became
  contrast 4.47   WCAG ratio, rounded down, against the background behind the text
  text in X       the text is drawn by descendant X (the one with most of it): its font, color, contrast
  truncated       the text is cut off (overflow clip, ellipsis or line clamp); a "…" in the header is
                  only bdg shortening the text
  .a.b(+3)        the first two classes and how many more the element has
  sizing content-box  padding and border add to the CSS size (shown only then; border-box is not)
  (+N not rendered)  children with display: none (or not in the layout)
  hints           declarations on this element that have no effect, why, the fix and where they are
                  ('none': checked, nothing found)
  ← sel (file:N)  --rules: the declaration that sets the value (file:line, or file:line:column in
                  minified files); 'over X': rules it beats; '= v': the value of a var() expression
  ✓ / ✗           --why: the winning declaration / ones it beats, highest precedence first;
                  [0,2,0]: selector specificity (ids, classes, types); indented --name lines: where
                  the winner's custom properties are set
Sessions follow the system color scheme; start with --color-scheme light|dark to choose.`;

/**
 * What covers an element: a cover that paints nothing at that point (a
 * transparent box over it) does not hide it, but takes its clicks.
 *
 * @param cover - Description of the covering element
 * @param transparent - The cover paints nothing there
 * @returns e.g. `covered by div#modal`, `under transparent ul.filters (clicks land on it)`
 */
export function coverText(cover: string, transparent: boolean | undefined): string {
  return transparent ? `under transparent ${cover} (clicks land on it)` : `covered by ${cover}`;
}

/**
 * Note when `bdg dom inspect` could not read the element's matched rules, so
 * no hints, rules or why were computed.
 *
 * @param reason - `timeout` (very large stylesheets), `failed` (Chrome reported
 *   an error) or `skipped` (hints not read: an earlier read on this page timed out)
 * @returns Note
 */
export function inspectCascadeNote(reason: 'timeout' | 'failed' | 'skipped'): string {
  if (reason === 'skipped')
    return "hints skipped: this page's stylesheets are slow to read (--rules waits 5 s)";
  return reason === 'timeout'
    ? "CSS rules not read: the page's stylesheets took too long (hints wait 1 s; --rules and --why 5 s)"
    : 'CSS rules not read: Chrome could not report the rules matching this element';
}

/**
 * Note of `bdg dom inspect` when the selector named a pseudo-element: its
 * element is inspected and the pseudo-element is on the `pseudo` line.
 *
 * @param pseudo - `::before` or `::after`
 * @returns Note
 */
export function inspectPseudoOfNote(pseudo: string): string {
  return `Inspected the element of ${pseudo}: pseudo-elements cannot be selected; ${pseudo} is on the pseudo line (content, size, position, inset, colors)`;
}

/**
 * Header badge of `bdg dom inspect` when the page is shown in its dark theme
 * because the session follows the system's dark preference, or because
 * `page emulate` asked for dark: the colors are the dark theme's, not what a
 * light-mode visitor sees.
 *
 * @param emulated - The dark preference comes from `page emulate --color-scheme dark`
 * @returns Badge
 */
export function inspectDarkThemeBadge(emulated = false): string {
  return emulated
    ? '[dark theme, emulated; bdg page emulate --color-scheme light for light]'
    : '[dark theme from system; --color-scheme light for light]';
}

/**
 * Header badges of `bdg dom inspect` for what keeps an element from being seen.
 *
 * @param visibility - Not rendered, hidden, offscreen, covered
 * @returns e.g. `[not rendered: display: none]`, `[offscreen: below]`, `[covered by div#modal]`
 */
export function inspectVisibilityBadges(visibility: InspectVisibility): string[] {
  const reason = (text: string | undefined): string => (text ? `: ${text}` : '');
  if (visibility.notRendered) {
    return [`[not rendered${reason(visibility.hidden?.replace(/^not rendered \((.*)\)$/, '$1'))}]`];
  }
  return [
    visibility.hidden && `[hidden: ${visibility.hidden}]`,
    visibility.offscreen && `[offscreen: ${visibility.offscreen}]`,
    visibility.coveredBy && `[${coverText(visibility.coveredBy, visibility.coverTransparent)}]`,
    visibility.masked && `[${maskedText(visibility.masked)}]`,
    visibility.shownBy && `[${shownByText(visibility.shownBy)}]`,
  ].filter((badge): badge is string => Boolean(badge));
}

/**
 * What `bdg dom inspect` did when several elements matched and no --index was given.
 *
 * @param picked - How the match was chosen
 * @param index - Index of the inspected match
 * @returns e.g. "inspected the first visible one ([2])"
 */
export function inspectedMatchAction(picked: 'first-visible' | 'first', index: number): string {
  return picked === 'first-visible'
    ? `inspected the first visible one ([${index}])`
    : 'inspected the first';
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
 * Header badge of `bdg dom inspect` while CSS transitions or animations run
 * on the element: the values read are mid-way.
 *
 * @param animating - Transitioned properties and animation names
 * @returns e.g. `[animating: background-color; values are mid-way, inspect again]`
 */
export function inspectAnimatingBadge(animating: readonly string[]): string {
  return `[animating: ${animating.join(', ')}; values are mid-way, inspect again]`;
}

/**
 * `--why` note on a computed value read during its transition.
 *
 * @returns Note
 */
export function inspectMidTransitionNote(): string {
  return '(mid-transition: inspect again for the final value)';
}
